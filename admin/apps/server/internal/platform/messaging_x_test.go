package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

type messagingQuotaProbe struct {
	observationError   error
	denied             error
	reserved, observed int
}

func (q *messagingQuotaProbe) ReserveXMessagingRequest(_ context.Context, user, operation string) error {
	q.reserved++
	if user != "111" || operation != XMessagingSend {
		return errors.New("incorrect quota identity")
	}
	return q.denied
}
func (q *messagingQuotaProbe) ObserveXMessagingResponse(_ context.Context, _, _ string, _ int, _ http.Header) error {
	q.observed++
	return q.observationError
}

func TestXSendRequiresRemoteMessageIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = fmt.Fprint(w, `{"data":{}}`) }))
	defer server.Close()
	adapter := NewXAdapter("consumer", "secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL
	_, err := adapter.SendMessage(t.Context(), "access|secret", SendMessageRequest{AccountID: "111", RemoteConversationID: "111-222", Body: "hello"})
	require.Error(t, err, "a 2xx response without a message identity cannot confirm delivery")
}

func TestXMessagingOAuthVariantsShareQuotaAdmission(t *testing.T) {
	for _, variant := range []string{"oauth1", "oauth2"} {
		t.Run(variant, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				if variant == "oauth2" {
					require.Equal(t, "Bearer supplemental", r.Header.Get("Authorization"))
				} else {
					require.True(t, strings.HasPrefix(r.Header.Get("Authorization"), "OAuth "))
				}
				require.Equal(t, "/2/dm_conversations/111-222/messages", r.URL.Path)
				w.Header().Set("x-rate-limit-remaining", "14")
				_, _ = fmt.Fprint(w, `{"data":{"dm_event_id":"message"}}`)
			}))
			defer server.Close()
			original := httpClient
			httpClient = server.Client()
			defer func() { httpClient = original }()
			adapter := NewXAdapter("consumer", "secret", "")
			defer close(adapter.cleanupDone)
			adapter.apiBaseURL = server.URL
			quota := &messagingQuotaProbe{denied: errors.New("budget denied")}
			adapter.SetMessagingQuotaGate(quota)
			token := "access|secret"
			if variant == "oauth2" {
				token = XMessagingOAuth2Token("supplemental")
			}
			input := SendMessageRequest{AccountID: "111", RemoteConversationID: "111-222", Body: "hello"}
			_, err := adapter.SendMessage(t.Context(), token, input)
			require.Error(t, err)
			require.Zero(t, requests)
			quota.denied = nil
			result, err := adapter.SendMessage(t.Context(), token, input)
			require.NoError(t, err)
			require.Equal(t, "message", result.RemoteMessageID)
			require.Equal(t, 1, requests)
			require.Equal(t, 2, quota.reserved)
			require.Equal(t, 1, quota.observed)
		})
	}
}

func TestConfirmedXSendSurvivesQuotaObservationFailure(t *testing.T) {
	for _, variant := range []string{"oauth1", "oauth2"} {
		t.Run(variant, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests++
				w.Header().Set("x-rate-limit-remaining", "0")
				_, _ = fmt.Fprint(w, `{"data":{"dm_event_id":"confirmed"}}`)
			}))
			defer server.Close()
			original := httpClient
			httpClient = server.Client()
			defer func() { httpClient = original }()
			adapter := NewXAdapter("consumer", "secret", "")
			defer close(adapter.cleanupDone)
			adapter.apiBaseURL = server.URL
			quota := &messagingQuotaProbe{observationError: errors.New("quota storage unavailable")}
			adapter.SetMessagingQuotaGate(quota)
			token := "access|secret"
			if variant == "oauth2" {
				token = XMessagingOAuth2Token("supplemental")
			}
			input := SendMessageRequest{AccountID: "111", RemoteConversationID: "111-222", Body: "hello"}
			result, err := adapter.SendMessage(t.Context(), token, input)
			require.NoError(t, err)
			require.Equal(t, "confirmed", result.RemoteMessageID)
			_, err = adapter.SendMessage(t.Context(), token, input)
			require.Error(t, err)
			require.Equal(t, 1, requests, "no more upstream writes until the observation persists")
			quota.observationError = nil
			_, err = adapter.SendMessage(t.Context(), token, input)
			require.NoError(t, err)
			require.Equal(t, 2, requests)
		})
	}
}

type failingObservationGate struct {
	mu          sync.Mutex
	failed      bool
	latestReset int64
}

func (g *failingObservationGate) ReserveXMessagingRequest(context.Context, string, string) error {
	return nil
}
func (g *failingObservationGate) ObserveXMessagingResponse(_ context.Context, _, _ string, _ int, header http.Header) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.failed {
		return errors.New("quota offline")
	}
	reset, _ := strconv.ParseInt(header.Get("x-rate-limit-reset"), 10, 64)
	if reset > g.latestReset {
		g.latestReset = reset
	}
	return nil
}
func TestConcurrentXQuotaObservationsRetainLongestCooldown(t *testing.T) {
	secondArrived, longSent := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		switch body.Text {
		case "third":
			w.Header().Set("x-rate-limit-reset", "2000000000")
		case "long":
			<-secondArrived
			w.Header().Set("x-rate-limit-reset", "2000007200")
		default:
			close(secondArrived)
			<-longSent
			w.Header().Set("x-rate-limit-reset", "2000000900")
		}
		w.Header().Set("x-rate-limit-remaining", "0")
		_, _ = fmt.Fprint(w, `{"data":{"dm_event_id":"confirmed"}}`)
	}))
	defer server.Close()
	original := httpClient
	httpClient = server.Client()
	defer func() { httpClient = original }()
	adapter := NewXAdapter("consumer", "secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL
	gate := &failingObservationGate{failed: true}
	adapter.SetMessagingQuotaGate(gate)
	firstDone := make(chan error, 1)
	secondDone := make(chan error, 1)
	go func() {
		_, err := adapter.SendMessage(context.Background(), "access|secret", SendMessageRequest{AccountID: "111", RemoteConversationID: "111-222", Body: "long"})
		close(longSent)
		firstDone <- err
	}()
	go func() {
		_, err := adapter.SendMessage(context.Background(), "access|secret", SendMessageRequest{AccountID: "111", RemoteConversationID: "111-222", Body: "short"})
		secondDone <- err
	}()
	require.NoError(t, <-firstDone)
	require.NoError(t, <-secondDone)
	gate.mu.Lock()
	gate.failed = false
	gate.mu.Unlock()
	// Admission retry must replay both observations before another request. The
	// gate itself owns the monotonic durable maximum, not last-response order.
	gate.mu.Lock()
	gate.latestReset = 0
	gate.mu.Unlock()
	_, err := adapter.SendMessage(t.Context(), "access|secret", SendMessageRequest{AccountID: "111", RemoteConversationID: "111-222", Body: "third"})
	require.NoError(t, err)
	gate.mu.Lock()
	defer gate.mu.Unlock()
	require.Equal(t, int64(2000007200), gate.latestReset)
}
