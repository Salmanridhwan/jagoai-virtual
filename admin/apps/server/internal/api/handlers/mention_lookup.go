package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

type MentionLookupInput struct {
	AccountID string `path:"account_id" doc:"Connected destination account"`
	Query     string `query:"query" minLength:"2" maxLength:"100" doc:"Account search, or exact LinkedIn company vanity name"`
}
type MentionLookupOutput struct {
	Body struct {
		Candidates []platform.MentionCandidate `json:"candidates"`
		Mode       string                      `json:"mode" enum:"accounts,exact_company"`
	}
}

func (h *DestinationOptionsHandler) registerMentionLookup(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "lookup-account-mentions", Method: http.MethodGet, Path: "/accounts/{account_id}/mentions", Summary: "Find native mention targets for one destination", Tags: []string{tagAccounts}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{400, 403, 404, 429, 502}}, func(ctx context.Context, input *MentionLookupInput) (*MentionLookupOutput, error) {
		return h.lookupAccountMentions(ctx, input, middleware.GetUserID(ctx))
	})
}
func (h *DestinationOptionsHandler) lookupAccountMentions(ctx context.Context, input *MentionLookupInput, userID string) (*MentionLookupOutput, error) {
	input.Query = strings.TrimSpace(input.Query)
	if utf8.RuneCountInString(input.Query) < 2 || utf8.RuneCountInString(input.Query) > 100 {
		return nil, huma.Error400BadRequest("Mention search requires 2 to 100 characters")
	}
	var account models.SocialAccount
	if err := h.db.NewSelect().Model(&account).Where("id = ? AND is_active = ?", input.AccountID, true).Scan(ctx); err != nil {
		return nil, huma.Error404NotFound("connected account not found")
	}
	if err := h.authorizeMentionLookupAccount(ctx, account, userID); err != nil {
		return nil, err
	}
	adapter, ok := h.adapterForDestinationAccount(account).(platform.MentionLookupAdapter)
	if !ok {
		return nil, huma.Error400BadRequest("This destination does not support account mention lookup")
	}
	if h.tokenSource == nil {
		return nil, huma.Error502BadGateway("Mention lookup is unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	token, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return nil, huma.Error403Forbidden("Reconnect this account to search mentions")
	}
	candidates, err := adapter.LookupMentions(ctx, token, strings.TrimSpace(input.Query))
	if err != nil {
		var upstream *platform.HTTPError
		if errors.As(err, &upstream) {
			if upstream.StatusCode == 401 || upstream.StatusCode == 403 {
				return nil, huma.Error403Forbidden("The provider has not granted mention lookup access for this account")
			}
			if upstream.StatusCode == 429 {
				return nil, huma.Error429TooManyRequests("Mention search is temporarily rate limited. Try again later")
			}
		}
		return nil, huma.Error502BadGateway("Could not search mentions. Try again")
	}
	output := &MentionLookupOutput{}
	output.Body.Mode = "accounts"
	if account.Platform == "linkedin" {
		output.Body.Mode = "exact_company"
	}
	output.Body.Candidates = candidates
	if candidates == nil {
		output.Body.Candidates = []platform.MentionCandidate{}
	}
	return output, nil
}

func (h *DestinationOptionsHandler) authorizeMentionLookupAccount(ctx context.Context, account models.SocialAccount, userID string) error {
	if err := providerReadinessWorkspaceAccess(ctx, h.db, account.WorkspaceID, userID); err != nil {
		return err
	}
	installationID := middleware.GetInstallationID(ctx)
	if installationID == "" {
		return nil
	}
	allowed, err := filterExternalAppAccounts(ctx, h.db, installationID, account.WorkspaceID, []models.SocialAccount{account})
	if err != nil {
		return huma.Error500InternalServerError("Could not validate account grants")
	}
	if len(allowed) != 1 {
		return huma.Error403Forbidden("external application is not granted this social account")
	}
	return nil
}
