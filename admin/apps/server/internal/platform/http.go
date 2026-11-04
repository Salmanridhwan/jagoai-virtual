package platform

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/openpost/backend/internal/netguard"
)

var httpClient = newDefaultHTTPClient()

type TransportFailureKind string

const (
	TransportFailureConnection TransportFailureKind = "connection"
	TransportFailureTimeout    TransportFailureKind = "timeout"
	TransportFailureCanceled   TransportFailureKind = "canceled"
)

// TransportError classifies a failed provider request without retaining the
// request URL, which may contain credentials in its query string.
type TransportError struct {
	Kind TransportFailureKind
}

func (e *TransportError) Error() string {
	switch e.Kind {
	case TransportFailureTimeout:
		return "provider request timed out"
	case TransportFailureCanceled:
		return "provider request was canceled"
	default:
		return "provider request transport failed"
	}
}

func sanitizeTransportError(err error) *TransportError {
	if errors.Is(err, context.Canceled) {
		return &TransportError{Kind: TransportFailureCanceled}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &TransportError{Kind: TransportFailureTimeout}
	}
	var networkErr net.Error
	if errors.As(err, &networkErr) && networkErr.Timeout() {
		return &TransportError{Kind: TransportFailureTimeout}
	}
	return &TransportError{Kind: TransportFailureConnection}
}

func newDefaultHTTPClient() *http.Client {
	policy := netguard.URLPolicy{Label: "provider URL", AllowedSchemes: []string{"https", "http"}, AllowCustomPorts: true}
	transport := netguard.NewTransport(policy)
	if certFile := strings.TrimSpace(os.Getenv("SSL_CERT_FILE")); certFile != "" {
		if certPEM, err := os.ReadFile(certFile); err == nil {
			roots, poolErr := x509.SystemCertPool()
			if poolErr != nil || roots == nil {
				roots = x509.NewCertPool()
			}
			if roots.AppendCertsFromPEM(certPEM) {
				tlsConfig := transport.TLSClientConfig
				if tlsConfig == nil {
					tlsConfig = &tls.Config{}
				} else {
					tlsConfig = tlsConfig.Clone()
				}
				tlsConfig.RootCAs = roots
				transport.TLSClientConfig = tlsConfig
			}
		}
	}
	return &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: providerRedirectPolicy(policy)}
}

func providerRedirectPolicy(policy netguard.URLPolicy) func(*http.Request, []*http.Request) error {
	return func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("provider redirect limit exceeded")
		}
		if len(via) > 0 {
			original := via[0]
			credentialed := len(original.Header) > 0 || original.URL.Query().Get("access_token") != "" || original.URL.User != nil || original.Body != nil
			if credentialed && (req.URL.Scheme != original.URL.Scheme || req.URL.Host != original.URL.Host) {
				return fmt.Errorf("credential-bearing provider redirect changed origin")
			}
		}
		return netguard.ValidateURL(req.Context(), req.URL, policy)
	}
}

// DoRequest executes an HTTP request and returns the response body.
// Non-2xx responses retain only status, stable provider code, and Retry-After.
func DoRequest(ctx context.Context, method, url string, body io.Reader, headers map[string]string) ([]byte, error) {
	return doRequestWithClient(ctx, httpClient, method, url, body, headers)
}

// DoRequestNoRedirect is for credential-bearing URLs whose redirect target
// must never receive the original request implicitly.
func DoRequestNoRedirect(ctx context.Context, method, url string, body io.Reader, headers map[string]string) ([]byte, error) {
	client := *httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return doRequestWithClient(ctx, &client, method, url, body, headers)
}

func doRequestWithClient(ctx context.Context, client *http.Client, method, url string, body io.Reader, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, sanitizeTransportError(err)
	}
	defer resp.Body.Close()

	respBody, err := readProviderBody(resp)
	if err != nil {
		if isResponseTooLarge(err) {
			return nil, err
		}
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, NewHTTPError(resp.StatusCode, resp.Header, respBody)
	}

	return respBody, nil
}

// maxProviderResponseBytes is the default bound for provider response bodies.
// Provider API responses are small JSON or metadata payloads; anything larger
// indicates a misbehaving or compromised endpoint, so it is rejected before
// it can exhaust memory.
const maxProviderResponseBytes = 16 * 1024 * 1024

// responseTooLargeError reports a provider body over the bound. Its message
// keeps the historical "provider response exceeds N bytes" shape so every
// provider surfaces the same failure.
type responseTooLargeError struct {
	limit int
}

func (e *responseTooLargeError) Error() string {
	return fmt.Sprintf("provider response exceeds %d bytes", e.limit)
}

func isResponseTooLarge(err error) bool {
	var tooLarge *responseTooLargeError
	return errors.As(err, &tooLarge)
}

// readProviderBody reads a provider response body bounded by
// maxProviderResponseBytes. I/O failures are returned unwrapped so callers
// keep their existing error prefixes; oversized bodies return a
// *responseTooLargeError that callers must pass through unchanged to preserve
// the shared error shape.
func readProviderBody(resp *http.Response) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxProviderResponseBytes {
		return nil, &responseTooLargeError{limit: maxProviderResponseBytes}
	}
	return body, nil
}

// DoJSON marshals payload to JSON, sets Content-Type, and calls DoRequest.
func DoJSON(ctx context.Context, method, url string, payload any, headers map[string]string) ([]byte, error) {
	var bodyReader io.Reader
	if payload != nil {
		data, err := jsonMarshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshaling JSON: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	if headers == nil {
		headers = make(map[string]string)
	}
	if _, ok := headers[headerContentType]; !ok {
		headers[headerContentType] = contentTypeJSON
	}

	return DoRequest(ctx, method, url, bodyReader, headers)
}

// DoBearerJSON executes a JSON request with bearer auth and decodes the response.
func DoBearerJSON[T any](ctx context.Context, method, url, accessToken string, payload any, label string) (*T, error) {
	respBody, err := DoJSON(ctx, method, url, payload, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, err
	}

	var result T
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}

	return &result, nil
}

// DoMultipart builds a multipart/form-data body with a single file field and calls DoRequest.
func DoMultipart(ctx context.Context, url string, fieldName string, reader io.Reader, filename string, extraFields map[string]string, headers map[string]string) ([]byte, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Write extra text fields first
	for k, v := range extraFields {
		if err := writer.WriteField(k, v); err != nil {
			return nil, fmt.Errorf("writing field %s: %w", k, err)
		}
	}

	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		return nil, fmt.Errorf("creating form file: %w", err)
	}
	if _, err := io.Copy(part, reader); err != nil {
		return nil, fmt.Errorf("copying file data: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("closing multipart writer: %w", err)
	}

	if headers == nil {
		headers = make(map[string]string)
	}
	headers[headerContentType] = writer.FormDataContentType()

	return DoRequest(ctx, "POST", url, &buf, headers)
}

// DoFormURLEncoded encodes values as application/x-www-form-urlencoded and calls DoRequest.
func DoFormURLEncoded(ctx context.Context, method, url string, values map[string]string, headers map[string]string) ([]byte, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	if _, ok := headers[headerContentType]; !ok {
		headers[headerContentType] = contentTypeForm
	}

	body := encodeFormValues(values)
	return DoRequest(ctx, method, url, bytes.NewReader(body), headers)
}

// DoFormURLEncodedValues encodes url.Values (supports duplicate keys) and calls DoRequest.
func DoFormURLEncodedValues(ctx context.Context, method, url string, values url.Values, headers map[string]string) ([]byte, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	if _, ok := headers[headerContentType]; !ok {
		headers[headerContentType] = contentTypeForm
	}

	return DoRequest(ctx, method, url, strings.NewReader(values.Encode()), headers)
}

func encodeFormValues(values map[string]string) []byte {
	v := url.Values{}
	for k, val := range values {
		v.Set(k, val)
	}
	return []byte(v.Encode())
}

// jsonMarshal is a thin wrapper to allow overriding in tests if needed.
var jsonMarshal = json.Marshal
