// Package discordwebhook posts payloads to Discord webhook URLs.
//
// Webhook URLs carry a token, so they never appear in returned errors:
// transport and request-building failures map to fixed messages.
package discordwebhook

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// MaxDrainBytes bounds how much of a webhook response body is discarded
// before the status check. Discord answers are tiny; the bound only keeps a
// misbehaving endpoint from holding the connection open.
const MaxDrainBytes = 4096

// DefaultTimeout matches the 8s timeout every Discord caller used before the
// shared sender existed.
const DefaultTimeout = 8 * time.Second

// NewClient returns a client with the shared Discord webhook timeout for
// callers that hold their own client.
func NewClient() *http.Client {
	return &http.Client{Timeout: DefaultTimeout}
}

// Send marshals payload as JSON and POSTs it to webhookURL with client's
// timeout. Success is any 2xx status.
func Send(ctx context.Context, client *http.Client, webhookURL string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encoding discord webhook payload: %w", err)
	}
	return SendBody(ctx, client, webhookURL, bytes.NewReader(body), "application/json")
}

// SendBody POSTs body to webhookURL for callers whose payload is already
// encoded (multipart uploads, pre-rendered JSON). It performs the same
// bounded drain and status check as Send.
func SendBody(ctx context.Context, client *http.Client, webhookURL string, body io.Reader, contentType string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, body)
	if err != nil {
		return errors.New("discord webhook URL is invalid")
	}
	request.Header.Set("Content-Type", contentType)
	response, err := client.Do(request)
	if err != nil {
		// Transport errors can quote the webhook token. Keep it out of errors.
		return errors.New("discord webhook is unavailable")
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, MaxDrainBytes))
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("discord webhook returned HTTP %d", response.StatusCode)
	}
	return nil
}
