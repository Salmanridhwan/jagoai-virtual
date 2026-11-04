package platform

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
)

const (
	xMessagingOAuth2Prefix = "openpost-x-oauth2:"
	XMessagingRead         = "dm_read"
	XMessagingSend         = "dm_send"
	XMessagingUsers        = "dm_users"
)

// XMessagingOAuth2Token tags a supplemental token for the messaging adapter.
// Publishing never interprets this marker and retains its OAuth1 grant.
func XMessagingOAuth2Token(token string) string { return xMessagingOAuth2Prefix + token }

// XMessagingOAuth2Bearer unwraps only explicitly tagged supplemental tokens.
func XMessagingOAuth2Bearer(token string) (string, bool) {
	if !strings.HasPrefix(token, xMessagingOAuth2Prefix) {
		return "", false
	}
	return strings.TrimPrefix(token, xMessagingOAuth2Prefix), true
}

type XMessagingQuotaGate interface {
	ReserveXMessagingRequest(context.Context, string, string) error
	ObserveXMessagingResponse(context.Context, string, string, int, http.Header) error
}

// SetMessagingQuotaGate is configured at startup, before concurrent use.
func (x *XAdapter) SetMessagingQuotaGate(gate XMessagingQuotaGate) { x.messagingQuota = gate }

func (x *XAdapter) doMessagingRequest(ctx context.Context, token, accountID, operation, method, endpoint string, body io.Reader, headers map[string]string) ([]byte, error) {
	if err := x.reserveMessagingRequest(ctx, accountID, operation); err != nil {
		return nil, err
	}
	observe := func(status int, header http.Header) error {
		if x.messagingQuota == nil {
			return nil
		}
		if err := x.messagingQuota.ObserveXMessagingResponse(ctx, accountID, operation, status, header); err != nil {
			// Keep a confirmed provider result. Future requests must persist this
			// observation before admission, preventing a transient DB fault from
			// discarding a sent message identity or bypassing the provider cooldown.
			safe := http.Header{}
			for _, key := range []string{"X-Rate-Limit-Limit", "X-Rate-Limit-Remaining", "X-Rate-Limit-Reset", "Retry-After"} {
				if value := header.Get(key); len(value) <= 128 {
					safe.Set(key, value)
				}
			}
			x.storeQuotaObservation(accountID+":"+operation, xQuotaObservation{status: status, headers: safe})
		}
		return nil
	}

	bearer, supplemental := XMessagingOAuth2Bearer(token)
	if !supplemental {
		return x.doSignedRequestObserved(ctx, token, method, endpoint, body, headers, observe)
	}
	if bearer == "" {
		return nil, errors.New("x messaging OAuth2 token is empty")
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	request.Header.Set("Authorization", "Bearer "+bearer)
	client := *httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return nil, sanitizeTransportError(err)
	}
	defer response.Body.Close()
	if err = observe(response.StatusCode, response.Header); err != nil {
		return nil, err
	}
	responseBody, err := readProviderBody(response)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, NewHTTPError(response.StatusCode, response.Header, responseBody)
	}
	return responseBody, nil
}

type xQuotaObservation struct {
	status  int
	headers http.Header
}

type xQuotaObservations struct{ items []xQuotaObservation }

// Keep each in-flight observation until the monotonic durable owner accepts it.
// The pre-request quota bounds concurrent observations for each user/operation.
func (x *XAdapter) storeQuotaObservation(key string, observation xQuotaObservation) {
	for {
		previous, exists := x.messagingQuotaPending.Load(key)
		if !exists {
			if _, loaded := x.messagingQuotaPending.LoadOrStore(key, &xQuotaObservations{items: []xQuotaObservation{observation}}); !loaded {
				return
			}
			continue
		}
		prior := previous.(*xQuotaObservations)
		items := make([]xQuotaObservation, 0, len(prior.items)+1)
		items = append(items, prior.items...)
		items = append(items, observation)
		if x.messagingQuotaPending.CompareAndSwap(key, previous, &xQuotaObservations{items: items}) {
			return
		}
	}
}
func (x *XAdapter) reserveMessagingRequest(ctx context.Context, accountID, operation string) error {
	if x.messagingQuota == nil {
		return nil
	}
	key := accountID + ":" + operation
	for {
		pending, exists := x.messagingQuotaPending.Load(key)
		if !exists {
			break
		}
		for _, observation := range pending.(*xQuotaObservations).items {
			if err := x.messagingQuota.ObserveXMessagingResponse(ctx, accountID, operation, observation.status, observation.headers); err != nil {
				return err
			}
		}
		if x.messagingQuotaPending.CompareAndDelete(key, pending) {
			break
		}
	}
	return x.messagingQuota.ReserveXMessagingRequest(ctx, accountID, operation)
}
