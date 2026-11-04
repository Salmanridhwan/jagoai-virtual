package oauth2messaging

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/openpost/backend/internal/platform"
)

func (s *Service) refreshGrant(ctx context.Context, g *grant) error {
	if len(g.RefreshTokenEncrypted) == 0 {
		return ErrReconnect
	}
	lease := s.now().Add(time.Minute)
	result, err := s.db.NewUpdate().Model((*grant)(nil)).Set("refresh_lease_until = ?", lease).Where("social_account_id = ? AND updated_at = ? AND (refresh_lease_until IS NULL OR refresh_lease_until < ?)", g.SocialAccountID, g.UpdatedAt, s.now()).Exec(ctx)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrRefreshBusy
	}
	token, err := s.refreshToken(ctx, *g, lease)
	if err != nil {
		return err
	}
	if err = s.protect(g, token); err != nil {
		return err
	}
	result, err = s.db.NewUpdate().Model(g).Column("access_token_encrypted", "refresh_token_encrypted", "scopes", "expires_at", "updated_at", "refresh_lease_until").Where("social_account_id = ? AND refresh_lease_until = ?", g.SocialAccountID, lease).Exec(ctx)
	if err != nil {
		return err
	}
	n, err = result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrRefreshBusy
	}
	return nil
}
func (s *Service) refreshToken(ctx context.Context, g grant, lease time.Time) (tokenResponse, error) {
	refresh, err := s.encryptor.Decrypt(g.RefreshTokenEncrypted)
	if err != nil {
		return tokenResponse{}, err
	}
	token, err := s.exchange(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}})
	if err != nil {
		var httpErr *platform.HTTPError
		if errors.As(err, &httpErr) && (httpErr.StatusCode == 400 || httpErr.StatusCode == 401) {
			_, _ = s.db.NewUpdate().Model((*grant)(nil)).Set("invalid = TRUE").Where("social_account_id = ? AND refresh_lease_until = ?", g.SocialAccountID, lease).Exec(ctx)
		}
		return tokenResponse{}, err
	}
	if token.Scope == "" {
		token.Scope = g.Scopes
	}
	if !hasScopes(token.Scope) {
		return tokenResponse{}, ErrReconnect
	}
	return token, nil
}
