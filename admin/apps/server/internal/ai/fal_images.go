package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	fal "github.com/valksor/fal-go"
)

var ErrImageRejected = errors.New("image request rejected")

const maxImageBytes = 32 * 1024 * 1024

type FalImages struct {
	key  string
	http *http.Client
	sdk  *fal.Client
}

func NewFalImages(key string) *FalImages {
	client := &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	return &FalImages{key: key, http: client, sdk: fal.New(fal.WithKey(key), fal.WithHTTPClient(client))}
}

// The SDK retries transport failures, including POST. Paid submission must be
// sent once: a lost response is ambiguous, not permission to buy another image.
func (f *FalImages) SubmitImage(ctx context.Context, input ImageRequest) (string, error) {
	payload := map[string]any{"prompt": input.Prompt, "image_size": input.Size, "quality": input.Quality, "background": input.Background, "num_images": 1, "output_format": "png", "enable_safety_checker": true, "sync_mode": false}
	if len(input.Source) > 0 {
		payload["image_urls"] = []string{imageDataURI(input.Source)}
	}
	if len(input.Mask) > 0 {
		payload["mask_url"] = imageDataURI(input.Mask)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://queue.fal.run/"+input.Endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Key "+f.key)
	req.Header.Set("Content-Type", "application/json")
	// Prevent net/http from replaying the body after a transport interruption.
	req.GetBody = nil
	resp, err := f.http.Do(req)
	if err != nil {
		return "", errors.New("fal submission receipt unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 408 {
		return "", ErrImageRejected
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", errors.New("fal submission receipt unavailable")
	}
	var receipt struct {
		RequestID string `json:"request_id"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&receipt) != nil || !validImageRequestID(receipt.RequestID) {
		return "", errors.New("fal submission receipt unavailable")
	}
	return receipt.RequestID, nil
}

func imageDataURI(data []byte) string {
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
}

func validImageRequestID(id string) bool {
	if len(id) < 1 || len(id) > 200 {
		return false
	}
	for _, char := range id {
		if char != '-' && char != '_' && (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') {
			return false
		}
	}
	return true
}

func (f *FalImages) ImageStatus(ctx context.Context, endpoint, id string) (ImageStatus, error) {
	if !validImageRequestID(id) {
		return ImageStatus{}, errors.New("invalid fal receipt")
	}
	status, err := f.sdk.Status(ctx, endpoint, id, false)
	if err != nil {
		return ImageStatus{}, errors.New("fal status unavailable")
	}
	switch value := status.(type) {
	case fal.Queued:
		return ImageStatus{State: "queued"}, nil
	case fal.InProgress:
		return ImageStatus{State: "generating"}, nil
	case fal.Completed:
		return ImageStatus{State: "completed", Failed: value.Error != ""}, nil
	default:
		return ImageStatus{}, errors.New("invalid fal status")
	}
}

func (f *FalImages) ImageResult(ctx context.Context, endpoint, id string) ([]byte, error) {
	if !validImageRequestID(id) {
		return nil, errors.New("invalid fal receipt")
	}
	result, err := f.sdk.Result(ctx, endpoint, id)
	if err != nil {
		return nil, errors.New("fal result unavailable")
	}
	location, err := imageResultLocation(result)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, location.String(), nil)
	if err != nil {
		return nil, err
	}
	// Never send the provider key to the media CDN.
	resp, err := f.http.Do(req)
	if err != nil {
		return nil, errors.New("fal image download unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("fal image download failed")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil || len(data) > maxImageBytes {
		return nil, errors.New("fal image exceeds download limit")
	}
	return data, nil
}

func imageResultLocation(result any) (*url.URL, error) {
	body, err := json.Marshal(result)
	if err != nil || len(body) > 1024*1024 {
		return nil, errors.New("invalid fal result")
	}
	var output struct {
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
	}
	if json.Unmarshal(body, &output) != nil || len(output.Images) != 1 {
		return nil, errors.New("invalid fal images")
	}
	location, err := url.Parse(output.Images[0].URL)
	if err != nil || location.Scheme != "https" || location.User != nil || location.Port() != "" || !strings.HasSuffix(location.Hostname(), ".fal.media") {
		return nil, errors.New("invalid fal image location")
	}
	return location, nil
}

// Billing is reconciled by request ID. Model list prices cannot substitute for
// the token-based charge, and missing billing events must never mean zero cost.
func (f *FalImages) ImageCost(ctx context.Context, endpoint, id string) (*int64, error) {
	query := url.Values{"request_id": {id}, "endpoint_id": {endpoint}, "limit": {"100"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.fal.ai/v1/models/billing-events?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Key "+f.key)
	resp, err := f.http.Do(req)
	if err != nil {
		return nil, errors.New("fal billing unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fal billing unavailable (%d)", resp.StatusCode)
	}
	var result struct {
		HasMore bool `json:"has_more"`
		Events  []struct {
			RequestID string `json:"request_id"`
			Endpoint  string `json:"endpoint_id"`
			NanoUSD   *int64 `json:"cost_estimate_nano_usd"`
		} `json:"billing_events"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1024*1024)).Decode(&result) != nil || result.HasMore {
		return nil, errors.New("invalid fal billing response")
	}
	var total int64
	matched := false
	for _, event := range result.Events {
		if event.RequestID != id || event.Endpoint != endpoint {
			continue
		}
		if event.NanoUSD == nil || *event.NanoUSD < 0 || *event.NanoUSD > 1_000_000_000_000_000-total {
			return nil, errors.New("invalid fal charge")
		}
		total += *event.NanoUSD
		matched = true
	}
	if !matched {
		return nil, nil
	}
	micros := (total + 500) / 1000
	return &micros, nil
}
