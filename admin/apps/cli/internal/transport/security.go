package transport

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// ValidateURL permits plaintext only for local development. Credentials and
// upload headers must never travel to a remote server over plaintext HTTP.
func ValidateURL(u *url.URL) error {
	if u.User != nil || u.Hostname() == "" {
		return fmt.Errorf("server URL must have a host and no credentials")
	}
	if u.Scheme == "https" {
		return nil
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if u.Scheme == "http" && (strings.EqualFold(host, "localhost") || ip != nil && ip.IsLoopback()) {
		return nil
	}
	return fmt.Errorf("remote server connections require HTTPS")
}

func NoRedirect(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
