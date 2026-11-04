package middleware

import (
	"net"
	"net/netip"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/netguard"
)

// TrustedProxyMiddleware removes network assertions from direct clients and
// resolves forwarded clients from right to left through explicitly trusted hops.
func TrustedProxyMiddleware(cidrs []string) echo.MiddlewareFunc {
	prefixes := make([]netip.Prefix, 0, len(cidrs))
	for _, cidr := range cidrs {
		if prefix, err := netguard.ParseTrustedProxyPrefix(cidr); err == nil {
			prefixes = append(prefixes, prefix)
		}
	}
	trusted := func(addr netip.Addr) bool {
		for _, prefix := range prefixes {
			if prefix.Contains(addr.Unmap()) {
				return true
			}
		}
		return false
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			peerHost, _, err := net.SplitHostPort(req.RemoteAddr)
			if err != nil {
				peerHost = req.RemoteAddr
			}
			peer, err := netip.ParseAddr(peerHost)
			client := peer
			if err == nil && trusted(peer) {
				hops := strings.Split(req.Header.Get("X-Forwarded-For"), ",")
				for i := len(hops) - 1; i >= 0 && trusted(client); i-- {
					hop, parseErr := netip.ParseAddr(strings.TrimSpace(hops[i]))
					if parseErr != nil {
						break
					}
					client = hop
				}
				proto := strings.ToLower(strings.TrimSpace(req.Header.Get("X-Forwarded-Proto")))
				if proto != "https" && proto != "http" {
					req.Header.Del("X-Forwarded-Proto")
				} else {
					req.Header.Set("X-Forwarded-Proto", proto)
				}
			} else {
				req.Header.Del("X-Forwarded-Proto")
			}
			req.Header.Del("X-Forwarded-For")
			req.Header.Del("X-Real-Ip")
			req.Header.Del("Forwarded")
			req.Header.Del("X-Forwarded-Host")
			req.Header.Del(echo.HeaderXForwardedProtocol)
			req.Header.Del(echo.HeaderXForwardedSsl)
			req.Header.Del(echo.HeaderXUrlScheme)
			if client.IsValid() {
				req.Header.Set("X-Forwarded-For", client.Unmap().String())
			}
			return next(c)
		}
	}
}
