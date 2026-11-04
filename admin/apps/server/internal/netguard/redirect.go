package netguard

import (
	"errors"
	"net/http"
)

// ErrTooManyRedirects reports a redirect chain longer than the caller's bound.
var ErrTooManyRedirects = errors.New("too many redirects")

// ErrCredentialedCrossHostRedirect reports a credentialed redirect that leaves
// the initial request's HTTPS host.
var ErrCredentialedCrossHostRedirect = errors.New("credentialed redirect must stay on the same HTTPS host")

// SameHostHTTPSRedirectPolicy is the single credentialed-redirect policy shared
// by outbound clients that attach secrets to requests. It allows at most
// maxRedirects redirects and, when credentialed is true, pins every redirect
// to the initial request's exact host over HTTPS. Callers map the sentinel
// errors to their own wording with errors.Is so user-facing text is unchanged.
//
// The bound keeps the http.Client convention where len(via) is the number of
// requests already made: len(via) > maxRedirects rejects the redirect that
// would exceed the allowance. The host comparison is deliberately exact
// (including port and case): every credentialed caller starts from a fixed
// portless host, so any difference means the credential would leave its host.
func SameHostHTTPSRedirectPolicy(next *http.Request, via []*http.Request, maxRedirects int, credentialed bool) error {
	if len(via) > maxRedirects {
		return ErrTooManyRedirects
	}
	if !credentialed {
		return nil
	}
	if next == nil || next.URL == nil || next.URL.Scheme != "https" {
		return ErrCredentialedCrossHostRedirect
	}
	if len(via) == 0 {
		return nil
	}
	if next.URL.Host != via[0].URL.Host {
		return ErrCredentialedCrossHostRedirect
	}
	return nil
}
