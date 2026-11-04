package netguard

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func redirectTestRequest(t testing.TB, raw string) *http.Request {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, raw, nil)
	require.NoError(t, err)
	return req
}

func TestSameHostHTTPSRedirectPolicy(t *testing.T) {
	t.Parallel()

	const maxRedirects = 5

	buildVia := func(t *testing.T, count int) []*http.Request {
		t.Helper()
		via := make([]*http.Request, 0, count)
		for range count {
			via = append(via, redirectTestRequest(t, "https://api.github.com/repos/getopenpost/openpost"))
		}
		return via
	}

	t.Run("credentialed redirect to another host is refused", func(t *testing.T) {
		t.Parallel()
		err := SameHostHTTPSRedirectPolicy(
			redirectTestRequest(t, "https://9.9.9.9/other"),
			buildVia(t, 1),
			maxRedirects,
			true,
		)
		require.ErrorIs(t, err, ErrCredentialedCrossHostRedirect)
	})

	t.Run("credentialed downgrade to HTTP is refused", func(t *testing.T) {
		t.Parallel()
		err := SameHostHTTPSRedirectPolicy(
			redirectTestRequest(t, "http://api.github.com/other"),
			buildVia(t, 1),
			maxRedirects,
			true,
		)
		require.ErrorIs(t, err, ErrCredentialedCrossHostRedirect)
	})

	t.Run("sixth redirect is refused", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, SameHostHTTPSRedirectPolicy(
			redirectTestRequest(t, "https://api.github.com/other"),
			buildVia(t, maxRedirects),
			maxRedirects,
			true,
		))
		err := SameHostHTTPSRedirectPolicy(
			redirectTestRequest(t, "https://api.github.com/other"),
			buildVia(t, maxRedirects+1),
			maxRedirects,
			true,
		)
		require.ErrorIs(t, err, ErrTooManyRedirects)
	})

	t.Run("credentialed redirect on the same HTTPS host is allowed", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, SameHostHTTPSRedirectPolicy(
			redirectTestRequest(t, "https://api.github.com/other"),
			buildVia(t, 1),
			maxRedirects,
			true,
		))
	})

	t.Run("uncredentialed redirect is not pinned to the host", func(t *testing.T) {
		t.Parallel()
		require.NoError(t, SameHostHTTPSRedirectPolicy(
			redirectTestRequest(t, "https://9.9.9.9/other"),
			buildVia(t, 1),
			maxRedirects,
			false,
		))
	})

	t.Run("sentinels are distinct", func(t *testing.T) {
		t.Parallel()
		require.False(t, errors.Is(ErrTooManyRedirects, ErrCredentialedCrossHostRedirect))
	})
}
