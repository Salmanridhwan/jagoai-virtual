package platform

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

// oversizedProviderBody returns a body one byte over the shared provider
// response bound.
func oversizedProviderBody() io.Reader {
	return strings.NewReader(strings.Repeat("x", maxProviderResponseBytes+1))
}

func oversizedStubResponse(_ *http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(oversizedProviderBody()),
	}, nil
}

// withOversizedProviderClient swaps the shared provider client for a stub
// transport that serves a body over the bound.
func withOversizedProviderClient(t *testing.T) {
	t.Helper()
	original := httpClient
	httpClient = &http.Client{Transport: roundTripFunc(oversizedStubResponse)}
	t.Cleanup(func() { httpClient = original })
}

// countingInfiniteReader yields an unbounded stream while recording how many
// bytes were consumed.
type countingInfiniteReader struct {
	total *int64
}

func (r countingInfiniteReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	atomic.AddInt64(r.total, int64(len(p)))
	return len(p), nil
}

func TestReadProviderBodyTruncatesUnboundedStream(t *testing.T) {
	var total int64
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(countingInfiniteReader{total: &total}),
	}
	_, err := readProviderBody(resp)
	require.ErrorContains(t, err, "provider response exceeds 16777216 bytes")
	require.True(t, isResponseTooLarge(err))
	// The read stops at the bound instead of buffering the unbounded stream.
	require.Equal(t, int64(maxProviderResponseBytes+1), atomic.LoadInt64(&total))
}

func TestReadProviderBodyAcceptsSmallBody(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader(`{"ok":true}`)),
	}
	body, err := readProviderBody(resp)
	require.NoError(t, err)
	require.Equal(t, `{"ok":true}`, string(body))
}

func TestLinkedInRequestRejectsOversizedBody(t *testing.T) {
	withOversizedProviderClient(t)
	_, err := doRequestWithHeaders(context.Background(), http.MethodGet, "https://provider.example/api", nil, nil)
	require.ErrorContains(t, err, "provider response exceeds")
}

func TestLinkedInRequestAcceptsBodyUnderBound(t *testing.T) {
	original := httpClient
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"ok":true}`), nil
	})}
	t.Cleanup(func() { httpClient = original })
	header, err := doRequestWithHeaders(context.Background(), http.MethodGet, "https://provider.example/api", nil, nil)
	require.NoError(t, err)
	require.Equal(t, contentTypeJSON, header.Get("Content-Type"))
}

func TestXSignedRequestRejectsOversizedBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, oversizedProviderBody())
	}))
	defer server.Close()
	adapter := &XAdapter{consumerKey: "key", consumerSecret: "secret"}
	_, err := adapter.doSignedRequest(context.Background(), "token|secret", http.MethodGet, server.URL, nil, nil)
	require.ErrorContains(t, err, "provider response exceeds")
}

func TestXSignedRequestAcceptsBodyUnderBound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"id":"1"}}`))
	}))
	defer server.Close()
	adapter := &XAdapter{consumerKey: "key", consumerSecret: "secret"}
	body, err := adapter.doSignedRequest(context.Background(), "token|secret", http.MethodGet, server.URL, nil, nil)
	require.NoError(t, err)
	require.Equal(t, `{"data":{"id":"1"}}`, string(body))
}

func TestYouTubeRequestRejectsOversizedBody(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(oversizedStubResponse)}
	_, err := doYouTubeRequestWithClient(context.Background(), client, http.MethodGet, "https://provider.example/api", nil, nil)
	require.ErrorContains(t, err, "provider response exceeds")
}

func TestYouTubeRequestAcceptsBodyUnderBound(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"id":"video-id"}`), nil
	})}
	resp, err := doYouTubeRequestWithClient(context.Background(), client, http.MethodGet, "https://provider.example/api", nil, nil)
	require.NoError(t, err)
	require.Equal(t, `{"id":"video-id"}`, string(resp.body))
}

func TestPeerTubeRawRequestRejectsOversizedBody(t *testing.T) {
	withOversizedProviderClient(t)
	_, err := peertubeRawRequest(context.Background(), http.MethodGet, "https://provider.example/api", nil, nil)
	require.ErrorContains(t, err, "provider response exceeds")
	var uploadErr *MediaUploadError
	require.True(t, errors.As(err, &uploadErr))
	require.Equal(t, MediaRetrySafeResume, uploadErr.RetryClassification)
}

func TestPinterestVideoUploadRejectsOversizedResponse(t *testing.T) {
	withOversizedProviderClient(t)
	session := pinterestUploadSession{
		UploadURL:        "https://uploads.s3.amazonaws.com/bucket",
		UploadParameters: map[string]string{"key": "value"},
	}
	err := uploadPinterestVideo(context.Background(), session, UploadMediaRequest{}, strings.NewReader("video-bytes"))
	require.ErrorContains(t, err, "provider response exceeds")
}
