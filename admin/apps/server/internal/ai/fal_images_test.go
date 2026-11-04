package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	fal "github.com/valksor/fal-go"
)

type imageTransport func(*http.Request) (*http.Response, error)

func (f imageTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func imageResponse(body string) *http.Response {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func TestFalImageSubmissionSendsMaskAndNeverReplaysAmbiguousPurchase(t *testing.T) {
	provider := NewFalImages("test-key")
	calls := 0
	provider.http.Transport = imageTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, "https://queue.fal.run/openai/gpt-image-2.5/flare/edit", r.URL.String())
		require.Equal(t, "Key test-key", r.Header.Get("Authorization"))
		require.Nil(t, r.GetBody)
		var payload map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		require.Equal(t, []any{"data:image/png;base64,c291cmNl"}, payload["image_urls"])
		require.Equal(t, "data:image/png;base64,bWFzaw==", payload["mask_url"])
		require.Equal(t, float64(1), payload["num_images"])
		require.Equal(t, true, payload["enable_safety_checker"])
		return nil, errors.New("connection lost after accepting request")
	})
	_, err := provider.SubmitImage(t.Context(), ImageRequest{Endpoint: "openai/gpt-image-2.5/flare/edit", Prompt: "Replace the sky", Size: "auto", Quality: "high", Background: "auto", Source: []byte("source"), Mask: []byte("mask")})
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrImageRejected)
	require.Equal(t, 1, calls)
}

func TestFalImageReceiptDownloadKeepsCredentialsOffMediaAndRejectsOtherHosts(t *testing.T) {
	for _, location := range []string{"https://v3.fal.media/files/image.png", "https://example.test/image.png", "http://v3.fal.media/image.png"} {
		t.Run(location, func(t *testing.T) {
			provider := NewFalImages("test-key")
			downloads := 0
			provider.http.Transport = imageTransport(func(r *http.Request) (*http.Response, error) {
				switch r.URL.Hostname() {
				case "queue.fal.run":
					require.Equal(t, "Key test-key", r.Header.Get("Authorization"))
					if strings.HasSuffix(r.URL.Path, "/status") {
						return imageResponse(`{"status":"COMPLETED"}`), nil
					}
					return imageResponse(`{"images":[{"url":"` + location + `"}]}`), nil
				default:
					downloads++
					require.Empty(t, r.Header.Get("Authorization"))
					return imageResponse("image-bytes"), nil
				}
			})
			provider.sdk = fal.New(fal.WithKey("test-key"), fal.WithHTTPClient(provider.http))
			data, err := provider.ImageResult(context.Background(), "openai/gpt-image-2.5/flare/edit", "receipt")
			if strings.HasPrefix(location, "https://v3.fal.media/") {
				require.NoError(t, err)
				require.Equal(t, "image-bytes", string(data))
				require.Equal(t, 1, downloads)
			} else {
				require.Error(t, err)
				require.Zero(t, downloads)
			}
		})
	}
}

func TestFalImageBillingMatchesReceiptAndNeverTreatsMissingEventsAsFree(t *testing.T) {
	provider := NewFalImages("test-key")
	for _, test := range []struct {
		name, body string
		expected   *int64
		invalid    bool
	}{
		{"delayed", `{"billing_events":[],"has_more":false}`, nil, false},
		{"exact receipt", `{"billing_events":[{"request_id":"receipt","endpoint_id":"endpoint","cost_estimate_nano_usd":12345678},{"request_id":"other","endpoint_id":"endpoint","cost_estimate_nano_usd":9000000},{"request_id":"receipt","endpoint_id":"other","cost_estimate_nano_usd":9000000}],"has_more":false}`, new(int64(12346)), false},
		{"incomplete page", `{"billing_events":[],"has_more":true}`, nil, true},
		{"missing amount", `{"billing_events":[{"request_id":"receipt","endpoint_id":"endpoint"}]}`, nil, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider.http.Transport = imageTransport(func(r *http.Request) (*http.Response, error) {
				require.Equal(t, "Key test-key", r.Header.Get("Authorization"))
				require.Equal(t, "receipt", r.URL.Query().Get("request_id"))
				return imageResponse(test.body), nil
			})
			cost, err := provider.ImageCost(t.Context(), "endpoint", "receipt")
			if test.invalid {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				require.Equal(t, test.expected, cost)
			}
		})
	}
}
