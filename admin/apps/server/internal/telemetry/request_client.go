package telemetry

import (
	"context"
	"net/http"
	"strings"
)

type requestClientKey struct{}

// RequestClient is a low-cardinality operational hint, never authorization.
// Unknown headers and complete User-Agent values are not retained.
func RequestClient(ctx context.Context) string {
	if client, ok := ctx.Value(requestClientKey{}).(string); ok {
		return client
	}
	return "server"
}

func requestClient(request *http.Request) string {
	if request.Header.Get("X-OpenPost-Client") == "native" {
		return "native"
	}
	if request.URL.Path == "/mcp" || request.URL.Path == "/api/v1/mcp" {
		return "mcp"
	}
	ua := strings.ToLower(strings.TrimSpace(request.UserAgent()))
	switch {
	case strings.HasPrefix(ua, "openpost-cli/"):
		return "cli"
	case strings.HasPrefix(ua, "openpost-mcp/") || strings.HasPrefix(ua, "openpost-mcp-media/"):
		return "mcp"
	case strings.HasPrefix(ua, "n8n-nodes-openpost/"):
		return "n8n"
	case strings.Contains(ua, "mozilla/"):
		return "web"
	default:
		return "api"
	}
}
