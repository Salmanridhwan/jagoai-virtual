package platform

import (
	"net/http"
	"testing"
	"time"
)

func TestYouTubePublicationWaitsForProcessingAndReconciles(t *testing.T) {
	original := httpClient
	defer func() { httpClient = original }()
	for _, test := range []struct {
		name  string
		body  string
		state PublishSubmissionState
	}{
		{name: "processed", body: `{"items":[{"id":"video-1","status":{"uploadStatus":"processed"}}]}`, state: PublishSubmissionAccepted},
		{name: "succeeded", body: `{"items":[{"id":"video-1","processingDetails":{"processingStatus":"succeeded"}}]}`, state: PublishSubmissionAccepted},
		{name: "failed", body: `{"items":[{"id":"video-1","processingDetails":{"processingStatus":"failed"}}]}`, state: PublishSubmissionRejected},
		{name: "deleted", body: `{"items":[{"id":"video-1","status":{"uploadStatus":"deleted"}}]}`, state: PublishSubmissionRejected},
		{name: "missing", body: `{"items":[]}`, state: PublishSubmissionPending},
		{name: "terminated", body: `{"items":[{"id":"video-1","status":{"uploadStatus":"uploaded"},"processingDetails":{"processingStatus":"terminated"}}]}`, state: PublishSubmissionPending},
		{name: "mismatched identity", body: `{"items":[{"id":"other-video","status":{"uploadStatus":"processed"}}]}`, state: PublishSubmissionPending},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := `{"items":[{"id":"video-1","status":{"uploadStatus":"uploaded"},"processingDetails":{"processingStatus":"processing"}}]}`
			reads := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet || r.URL.Query().Get("id") != "video-1" {
					t.Fatal("processing reconciliation must only read the uploaded video")
				}
				reads++
				return jsonResponse(r, body), nil
			})}
			adapter := NewYouTubeAdapter("", "", "")
			req := &PublishRequest{PlatformMediaIDs: []string{"video-1"}, Media: []MediaItem{{MimeType: "video/mp4"}}}
			result, err := adapter.Publish(t.Context(), "token", "channel", req)
			if err != nil || result.SubmissionState != PublishSubmissionPending || result.ExternalID != "" || result.ProviderReference != "yt1:video-1" {
				t.Fatalf("uploaded video must await positive processing confirmation: %+v %v", result, err)
			}
			reconciler, ok := any(adapter).(PublishRequestReconciler)
			if !ok {
				t.Fatal("pending YouTube videos require read-only reconciliation")
			}
			body = test.body
			result, err = reconciler.ReconcilePublishRequest(t.Context(), "token", "channel", req, result.ProviderReference)
			if result.SubmissionState != test.state || reads != 2 {
				t.Fatalf("incorrect processing outcome: %+v %v reads=%d", result, err, reads)
			}
			if test.state == PublishSubmissionAccepted && (err != nil || result.ExternalID != "video-1") {
				t.Fatalf("confirmed video identity was lost: %+v %v", result, err)
			}
			if test.state == PublishSubmissionRejected && err == nil {
				t.Fatal("confirmed rejection must return an actionable failure")
			}
		})
	}
}

func TestYouTubeProcessedScheduledVideoRetainsProviderSchedule(t *testing.T) {
	original := httpClient
	defer func() { httpClient = original }()
	httpClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return jsonResponse(r, `{"items":[{"id":"scheduled-video","status":{"uploadStatus":"processed"}}]}`), nil
	})}
	result, err := NewYouTubeAdapter("", "", "").Publish(t.Context(), "token", "channel", &PublishRequest{
		PlatformMediaIDs: []string{"scheduled-video"}, Media: []MediaItem{{MimeType: "video/mp4"}},
		Settings: map[string]any{"privacy": "private", "publish_at": time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)},
	})
	if err != nil || result.SubmissionState != PublishSubmissionAccepted || result.ProviderState != "scheduled" {
		t.Fatalf("accepted schedule must stay distinct from a live video: %+v %v", result, err)
	}
}
