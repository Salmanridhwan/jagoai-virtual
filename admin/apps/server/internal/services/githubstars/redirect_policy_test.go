package githubstars

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func redirectRequest(t testing.TB, raw string) *http.Request {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, raw, nil)
	require.NoError(t, err)
	return req
}

// The star lookup client pins redirects to the initial HTTPS host through the
// shared netguard policy; this locks that wiring in place.
func TestRedirectPolicyRefusesCredentialedCrossHostRedirect(t *testing.T) {
	t.Parallel()

	service := NewService(Options{})
	via := make([]*http.Request, 0, 4)
	via = append(via, redirectRequest(t, repositoryAPIURL))

	require.ErrorContains(t,
		service.client.CheckRedirect(redirectRequest(t, "https://9.9.9.9/other"), via),
		"cross-host")
	require.ErrorContains(t,
		service.client.CheckRedirect(redirectRequest(t, "http://api.github.com/other"), via),
		"cross-host")
	require.ErrorContains(t,
		service.client.CheckRedirect(
			redirectRequest(t, "https://api.github.com/other"),
			append(via, via[0], via[0], via[0]),
		),
		"stopped after three redirects")
	require.NoError(t,
		service.client.CheckRedirect(redirectRequest(t, "https://api.github.com/other"), via))
}
