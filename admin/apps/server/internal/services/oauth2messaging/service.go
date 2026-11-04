// Package oauth2messaging owns supplemental X OAuth2 user grants. Publishing
// remains on the account's existing OAuth1 grant and token manager.
package oauth2messaging

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

var (
	ErrNotConnected = errors.New("x messaging OAuth2 authorization is not connected")
	ErrReconnect    = errors.New("x messaging authorization requires reconnecting")
	ErrState        = errors.New("invalid or expired X messaging authorization state")
	ErrAccessDenied = errors.New("x messaging workspace access denied")
	ErrUnavailable  = errors.New("x messaging OAuth2 app is not configured")
	ErrRefreshBusy  = errors.New("x messaging authorization refresh is in progress")
	ErrBudget       = errors.New("x activity requires explicit operator budget and provider spending controls")
)

const messagingScopes = "tweet.read users.read dm.read dm.write offline.access"

type Config struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	WebhookID    string
	// Zero closes paid activation. This must be explicitly configured even when
	// the existing general X publishing budget has a nonzero default.
	MonthlyBudgetMicrousd          int64
	ProviderSpendingLimitConfirmed bool
}

type Service struct {
	db               *bun.DB
	encryptor        *servicecrypto.TokenEncryptor
	config           Config
	costs            *usage.Service
	apiBase          string
	authBase         string
	now              func() time.Time
	httpClient       *http.Client
	receiptScheduler func(context.Context) error
}

func NewService(db *bun.DB, encryptor *servicecrypto.TokenEncryptor, config Config, costs *usage.Service) *Service {
	client := netguard.NewHTTPClient(30*time.Second, netguard.URLPolicy{Label: "X OAuth2 URL", AllowedSchemes: []string{"https"}})
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Service{httpClient: client, db: db, encryptor: encryptor, config: config, costs: costs, apiBase: "https://api.x.com", authBase: "https://x.com/i/oauth2/authorize", now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) account(ctx context.Context, workspaceID, accountID string) (models.SocialAccount, error) {
	var account models.SocialAccount
	err := s.db.NewSelect().Model(&account).Where("id = ? AND workspace_id = ? AND platform = ? AND is_active = ?", accountID, workspaceID, "x", true).Scan(ctx)
	return account, err
}

func (s *Service) Authorize(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID string, level workspaceaccess.Level) error {
	decision, err := workspaceaccess.NewAuthorizer(s.db).Authorize(ctx, workspaceID, actor, level)
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return ErrAccessDenied
	}
	return nil
}

// Begin authorizes the complete actor and binds callback state to the
// initiating user, workspace, account and app.
func (s *Service) Begin(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, accountID string) (string, error) {
	if s.config.ClientID == "" || s.config.RedirectURI == "" {
		return "", ErrUnavailable
	}
	if err := s.Authorize(ctx, actor, workspaceID, workspaceaccess.LevelConnect); err != nil {
		return "", err
	}
	if _, err := s.account(ctx, workspaceID, accountID); err != nil {
		return "", err
	}
	state, verifier := randomToken(), randomToken()
	encrypted, err := s.encryptor.Encrypt(verifier)
	if err != nil {
		return "", err
	}
	row := authRequest{State: state, UserID: actor.UserID, WorkspaceID: workspaceID, SocialAccountID: accountID, ClientID: s.config.ClientID, VerifierEncrypted: encrypted, ExpiresAt: s.now().Add(10 * time.Minute)}
	if _, err = s.db.NewInsert().Model(&row).Exec(ctx); err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(verifier))
	query := url.Values{"response_type": {"code"}, "client_id": {s.config.ClientID}, "redirect_uri": {s.config.RedirectURI}, "scope": {messagingScopes}, "state": {state}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}}
	return s.authBase + "?" + query.Encode(), nil
}
func randomToken() string {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes[:])
}

// Complete consumes the state once, verifies current actor authority and the
// provider identity, then stores separate encrypted credentials.
func (s *Service) Complete(ctx context.Context, actor workspaceaccess.ActorFacts, state, code string) (string, error) {
	var request authRequest
	err := s.db.NewDelete().Model(&request).Where("state = ? AND user_id = ?", state, actor.UserID).Returning("*").Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrState
	}
	if err != nil {
		return "", err
	}
	if !request.ExpiresAt.After(s.now()) || request.ClientID != s.config.ClientID || code == "" {
		return "", ErrState
	}
	if err = s.Authorize(ctx, actor, request.WorkspaceID, workspaceaccess.LevelConnect); err != nil {
		return "", err
	}
	account, err := s.account(ctx, request.WorkspaceID, request.SocialAccountID)
	if err != nil {
		return "", err
	}
	verifier, err := s.encryptor.Decrypt(request.VerifierEncrypted)
	if err != nil {
		return "", err
	}
	token, err := s.exchange(ctx, url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {s.config.RedirectURI}, "code_verifier": {verifier}})
	if err != nil {
		return "", err
	}
	if !hasScopes(token.Scope) {
		return "", ErrReconnect
	}
	if err = s.verifyIdentity(ctx, token.AccessToken, account.AccountID); err != nil {
		return "", err
	}
	g := grant{SocialAccountID: account.ID, WorkspaceID: account.WorkspaceID, RemoteUserID: account.AccountID, ClientID: s.config.ClientID}
	if err = s.protect(&g, token); err != nil {
		return "", err
	}
	return account.WorkspaceID, s.saveGrant(ctx, actor, account, g)
}

func (s *Service) verifyIdentity(ctx context.Context, accessToken, accountID string) error {
	body, err := s.request(ctx, http.MethodGet, s.apiBase+"/2/users/me", nil, map[string]string{"Authorization": "Bearer " + accessToken})
	if err != nil {
		return err
	}
	var identity struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &identity) != nil || identity.Data.ID != accountID || identity.Data.ID == "" {
		return ErrReconnect
	}
	return nil
}
func (s *Service) saveGrant(ctx context.Context, actor workspaceaccess.ActorFacts, account models.SocialAccount, g grant) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(ctx, account.WorkspaceID, actor, workspaceaccess.LevelConnect)
		if err != nil {
			return err
		}
		if !decision.Allowed {
			return ErrAccessDenied
		}
		var current models.SocialAccount
		query := tx.NewSelect().Model(&current).Where("id = ? AND workspace_id = ? AND platform = ? AND is_active = ?", account.ID, account.WorkspaceID, "x", true)
		if tx.Dialect().Name().String() == "pg" {
			query.For("UPDATE")
		}
		if err = query.Scan(ctx); err != nil {
			return err
		}
		if current.AccountID != g.RemoteUserID {
			return ErrReconnect
		}
		_, err = tx.NewInsert().Model(&g).On("CONFLICT (social_account_id) DO UPDATE").Set("access_token_encrypted = EXCLUDED.access_token_encrypted").Set("refresh_token_encrypted = EXCLUDED.refresh_token_encrypted").Set("scopes = EXCLUDED.scopes").Set("expires_at = EXCLUDED.expires_at").Set("client_id = EXCLUDED.client_id").Set("remote_user_id = EXCLUDED.remote_user_id").Set("invalid = FALSE").Set("refresh_lease_until = NULL").Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
		return err
	})
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int64  `json:"expires_in"`
}

func (s *Service) exchange(ctx context.Context, values url.Values) (tokenResponse, error) {
	values.Set("client_id", s.config.ClientID)
	headers := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	if s.config.ClientSecret != "" {
		headers["Authorization"] = "Basic " + base64.StdEncoding.EncodeToString([]byte(url.QueryEscape(s.config.ClientID)+":"+url.QueryEscape(s.config.ClientSecret)))
	}
	body, err := s.request(ctx, http.MethodPost, s.apiBase+"/2/oauth2/token", strings.NewReader(values.Encode()), headers)
	if err != nil {
		return tokenResponse{}, err
	}
	var token tokenResponse
	if json.Unmarshal(body, &token) != nil || token.AccessToken == "" || !strings.EqualFold(token.TokenType, "bearer") || token.ExpiresIn <= 0 || token.ExpiresIn > 365*24*3600 {
		return tokenResponse{}, ErrReconnect
	}
	return token, nil
}
func hasScopes(scopes string) bool {
	have := map[string]bool{}
	for _, scope := range strings.Fields(scopes) {
		have[scope] = true
	}
	for _, scope := range strings.Fields(messagingScopes) {
		if !have[scope] {
			return false
		}
	}
	return true
}
func (s *Service) protect(g *grant, token tokenResponse) error {
	var err error
	g.AccessTokenEncrypted, err = s.encryptor.Encrypt(token.AccessToken)
	if err != nil {
		return err
	}
	if token.RefreshToken != "" {
		g.RefreshTokenEncrypted, err = s.encryptor.Encrypt(token.RefreshToken)
		if err != nil {
			return err
		}
	}
	g.Scopes = token.Scope
	g.ExpiresAt = s.now().Add(time.Duration(token.ExpiresIn) * time.Second)
	g.UpdatedAt = s.now()
	g.RefreshLeaseUntil = time.Time{}
	return nil
}

// AccessToken returns an adapter-tagged token. Only ErrNotConnected permits
// OAuth1 fallback. Refresh failures, missing scopes and app changes do not.
func (s *Service) AccessToken(ctx context.Context, workspaceID, accountID string) (string, error) {
	account, err := s.account(ctx, workspaceID, accountID)
	if err != nil {
		return "", err
	}
	var g grant
	err = s.db.NewSelect().Model(&g).Where("social_account_id = ? AND workspace_id = ?", accountID, workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotConnected
	}
	if err != nil {
		return "", err
	}
	if g.Invalid || g.RemoteUserID != account.AccountID || g.ClientID != s.config.ClientID || !hasScopes(g.Scopes) {
		return "", ErrReconnect
	}
	if !g.ExpiresAt.After(s.now().Add(time.Minute)) {
		if err = s.refreshGrant(ctx, &g); err != nil {
			return "", err
		}
	}
	token, err := s.encryptor.Decrypt(g.AccessTokenEncrypted)
	if err != nil {
		return "", err
	}
	return platform.XMessagingOAuth2Token(token), nil
}

type Readiness struct {
	Authorized    bool   `json:"authorized"`
	CanSend       bool   `json:"can_send"`
	CanSubscribe  bool   `json:"can_subscribe"`
	EncryptedChat bool   `json:"encrypted_chat"`
	Reason        string `json:"reason,omitempty"`
}

func (s *Service) Readiness(ctx context.Context, workspaceID, accountID string) (Readiness, error) {
	account, err := s.account(ctx, workspaceID, accountID)
	if err != nil {
		return Readiness{}, err
	}
	if s.config.ClientID == "" {
		return Readiness{Reason: "oauth2_app_required"}, nil
	}
	var g grant
	err = s.db.NewSelect().Model(&g).Where("social_account_id = ? AND workspace_id = ?", accountID, workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Readiness{Reason: "oauth2_authorization_required"}, nil
	}
	if err != nil {
		return Readiness{}, err
	}
	if g.Invalid || g.RemoteUserID != account.AccountID || g.ClientID != s.config.ClientID || !hasScopes(g.Scopes) || (!g.ExpiresAt.After(s.now()) && len(g.RefreshTokenEncrypted) == 0) {
		return Readiness{Reason: "reconnect_required"}, nil
	}
	ready := Readiness{Authorized: true, CanSend: true}
	if !s.paidEnabled() {
		ready.Reason = "operator_budget_required"
		return ready, nil
	}
	ready.CanSubscribe = true
	return ready, nil
}
func (s *Service) paidEnabled() bool {
	return s.config.MonthlyBudgetMicrousd > 0 && s.config.ProviderSpendingLimitConfirmed && s.config.WebhookID != "" && s.config.ClientSecret != "" && s.costs != nil
}

func (s *Service) request(ctx context.Context, method, endpoint string, body io.Reader, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	response, err := s.httpClient.Do(req)
	if err != nil {
		return nil, &platform.TransportError{Kind: platform.TransportFailureConnection}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, errors.New("x OAuth2 response exceeds limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, platform.NewHTTPError(response.StatusCode, response.Header, raw)
	}
	return raw, nil
}
