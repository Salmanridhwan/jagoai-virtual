package handlers

import (
	"errors"
	"fmt"
	"log"
	"net/url"
	"regexp"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/platform"
)

var oauthDiagnosticCode = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,96}$`)

// Keep callback failures inspectable without putting provider response text,
// credential-bearing URLs, or arbitrary error wrappers into logs or redirects.
func (h *OAuthHandler) redirectWithOAuthFailure(provider, reason string, cause error, workspaceIDs ...string) (*huma.StreamResponse, error) {
	diagnostic := logAccountConnectionError(provider, reason, cause)
	return h.oauthFeedbackRedirect("failed", reason, diagnostic, workspaceIDs...)
}

func logAccountConnectionError(provider, reason string, cause error) string {
	diagnostic := oauthProviderDiagnostic(cause)
	var transportErr *platform.TransportError
	transport := ""
	if errors.As(cause, &transportErr) {
		transport = transportErr.Error()
	}
	root := cause
	for errors.Unwrap(root) != nil {
		root = errors.Unwrap(root)
	}
	log.Printf("[Account Connection] platform=%q reason=%s diagnostic=%q transport=%q error_type=%T", provider, reason, diagnostic, transport, root)
	return diagnostic
}

func oauthProviderDiagnostic(err error) string {
	switch {
	case errors.Is(err, platform.ErrInstagramLoginInvalidProfile):
		return "profile=invalid_response"
	case errors.Is(err, platform.ErrInstagramLoginInvalidUserID):
		return "profile=invalid_user_id"
	case errors.Is(err, platform.ErrInstagramLoginProfessionalAccount):
		return "profile=professional_account_required"
	}
	var providerErr *platform.HTTPError
	if !errors.As(err, &providerErr) || providerErr.StatusCode < 400 || providerErr.StatusCode > 599 {
		return ""
	}
	parts := []string{fmt.Sprintf("HTTP %d", providerErr.StatusCode)}
	for _, field := range []struct{ key, value string }{
		{"code", providerErr.Code}, {"subcode", providerErr.Subcode}, {"trace", providerErr.TraceID},
	} {
		if oauthDiagnosticCode.MatchString(field.value) {
			parts = append(parts, field.key+"="+field.value)
		}
	}
	return strings.Join(parts, "; ")
}

func (h *OAuthHandler) redirectWithOAuthFeedback(status, reason string, workspaceIDs ...string) (*huma.StreamResponse, error) {
	return h.oauthFeedbackRedirect(status, reason, "", workspaceIDs...)
}

func (h *OAuthHandler) oauthFeedbackRedirect(status, reason, diagnostic string, workspaceIDs ...string) (*huma.StreamResponse, error) {
	query := url.Values{"tab": {"accounts"}, "oauth_status": {status}}
	if reason != "" {
		query.Set("oauth_reason", reason)
	}
	if diagnostic != "" {
		query.Set("oauth_diagnostic", diagnostic)
	}
	if len(workspaceIDs) > 0 && strings.TrimSpace(workspaceIDs[0]) != "" {
		query.Set("workspace_id", workspaceIDs[0])
	}
	return redirectResponse(h.frontendURL + "/settings?" + query.Encode()), nil
}
