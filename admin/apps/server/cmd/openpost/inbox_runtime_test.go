package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/providerinbox"
	"github.com/stretchr/testify/require"
)

func TestMetaInboxRoutesExactConfiguredAppIDs(t *testing.T) {
	e := echo.New()
	// Verification is local. A nil database also prevents this test from
	// accidentally depending on receipt intake or provider account discovery.
	ingress := providerinbox.NewService(nil, servicecrypto.NewTokenEncryptor("test-key"))
	registerMetaInbox(e, ingress, []platform.AppConfig{
		{Provider: "facebook", ClientID: "client-a", ClientSecret: "secret-a", WebhookSecret: "verify-a"},
		{Provider: "facebook", ClientID: "client-b", ClientSecret: "secret-b", WebhookSecret: "verify-b"},
		{Provider: "instagram", ConnectionMode: "facebook_login", ClientID: "client-a", ClientSecret: "secret-a", WebhookSecret: "verify-page"},
		{Provider: "instagram", ConnectionMode: "instagram_login", ClientID: "client-a", ClientSecret: "secret-native", WebhookSecret: "verify-native"},
		{Provider: "facebook", ClientID: "unconfigured", ClientSecret: "missing-webhook-secret"},
	})
	for _, tc := range []struct {
		name, appID, token, mode string
		status                   int
	}{
		{name: "first Facebook app", appID: "facebook:client-a", token: "verify-a", mode: "subscribe", status: http.StatusOK},
		{name: "second Facebook app", appID: "facebook:client-b", token: "verify-b", mode: "subscribe", status: http.StatusOK},
		{name: "Instagram Page login", appID: "instagram:client-a", token: "verify-page", mode: "subscribe", status: http.StatusOK},
		{name: "Instagram native login", appID: "instagram:instagram_login:client-a", token: "verify-native", mode: "subscribe", status: http.StatusOK},
		{name: "other app token", appID: "facebook:client-a", token: "verify-b", mode: "subscribe", status: http.StatusForbidden},
		{name: "other login mode token", appID: "instagram:instagram_login:client-a", token: "verify-page", mode: "subscribe", status: http.StatusForbidden},
		{name: "invalid subscription mode", appID: "facebook:client-a", token: "verify-a", mode: "unsubscribe", status: http.StatusForbidden},
		{name: "unknown app sharing prefix", appID: "facebook:client-unknown", token: "verify-b", mode: "subscribe", status: http.StatusNotFound},
		{name: "configured ID suffix", appID: "facebook:client-a:extra", token: "verify-a", mode: "subscribe", status: http.StatusNotFound},
		{name: "unknown login mode", appID: "instagram:unknown:client-a", token: "verify-native", mode: "subscribe", status: http.StatusNotFound},
		{name: "incomplete configuration", appID: "facebook:unconfigured", token: "verify-b", mode: "subscribe", status: http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{"hub.mode": {tc.mode}, "hub.verify_token": {tc.token}, "hub.challenge": {"challenge-123"}}
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/provider-inbox/meta/"+tc.appID+"?"+query.Encode(), nil)
			response := httptest.NewRecorder()
			e.ServeHTTP(response, request)
			require.Equal(t, tc.status, response.Code, response.Body.String())
			if tc.status == http.StatusOK {
				require.Equal(t, "challenge-123", response.Body.String())
			}
		})
	}
	t.Run("unknown POST app", func(t *testing.T) {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/provider-inbox/meta/facebook:client-unknown", nil)
		response := httptest.NewRecorder()
		e.ServeHTTP(response, request)
		require.Equal(t, http.StatusNotFound, response.Code)
	})
}
