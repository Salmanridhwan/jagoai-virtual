package handlers

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/oauth2messaging"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

type XMessagingHandler struct {
	auth    middleware.Authenticator
	service *oauth2messaging.Service
}

func NewXMessagingHandler(auth middleware.Authenticator, service *oauth2messaging.Service) *XMessagingHandler {
	return &XMessagingHandler{auth: auth, service: service}
}

type XMessagingAccountInput struct {
	AccountID   string `path:"account_id"`
	WorkspaceID string `query:"workspace_id" required:"true"`
}
type XMessagingAuthorizeInput struct {
	AccountID string `path:"account_id"`
	Body      struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
	}
}
type XMessagingAuthorizeOutput struct {
	Body struct {
		URL string `json:"url"`
	}
}
type XMessagingReadinessOutput struct{ Body oauth2messaging.Readiness }
type XMessagingCompleteInput struct {
	Body struct {
		State string `json:"state" minLength:"1" maxLength:"100"`
		Code  string `json:"code" minLength:"1" maxLength:"4096"`
	}
}
type XMessagingCompleteOutput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id"`
	}
}
type XMessagingSubscribeInput struct {
	AccountID string `path:"account_id"`
	Body      struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
		EventType   string `json:"event_type" enum:"dm.received,dm.sent"`
		EventLimit  int    `json:"event_limit" minimum:"1" maximum:"100"`
	}
}
type XMessagingSubscribeOutput struct {
	Body oauth2messaging.SubscriptionResult
}
type XMessagingStopInput struct {
	SubscriptionID string `path:"subscription_id"`
	Body           struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
	}
}

func (h *XMessagingHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{OperationID: "get-x-messaging-readiness", Method: http.MethodGet, Path: "/accounts/{account_id}/messaging/x", Tags: []string{"Messaging"}, Summary: "Inspect supplemental X legacy messaging authorization", Middlewares: auth}, h.Readiness)
	huma.Register(api, huma.Operation{OperationID: "authorize-x-messaging", Method: http.MethodPost, Path: "/accounts/{account_id}/messaging/x/authorize", Tags: []string{"Messaging"}, Summary: "Authorize supplemental X messaging without changing publishing", MaxBodyBytes: 4096, Middlewares: auth}, h.Authorize)
	huma.Register(api, huma.Operation{OperationID: "complete-x-messaging", Method: http.MethodPost, Path: "/accounts/x/messaging/complete", Tags: []string{"Messaging"}, Summary: "Complete X messaging authorization as the initiating user", MaxBodyBytes: 8192, Middlewares: auth}, h.Complete)
	huma.Register(api, huma.Operation{OperationID: "subscribe-x-messaging", Method: http.MethodPost, Path: "/accounts/{account_id}/messaging/x/subscriptions", Tags: []string{"Messaging"}, Summary: "Explicitly activate an expiring X legacy DM subscription", MaxBodyBytes: 4096, Middlewares: auth}, h.Subscribe)
	huma.Register(api, huma.Operation{OperationID: "stop-x-messaging-subscription", Method: http.MethodDelete, Path: "/accounts/x/messaging/subscriptions/{subscription_id}", Tags: []string{"Messaging"}, Summary: "Stop a known X messaging subscription", MaxBodyBytes: 4096, Middlewares: auth}, h.Stop)
}
func xMessagingActor(ctx context.Context) workspaceaccess.ActorFacts {
	return workspaceaccess.ActorFacts{UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx), ClientID: middleware.GetClientID(ctx), CredentialWorkspaceID: middleware.GetWorkspaceID(ctx), ExternalInstallationID: middleware.GetInstallationID(ctx)}
}
func (h *XMessagingHandler) Readiness(ctx context.Context, input *XMessagingAccountInput) (*XMessagingReadinessOutput, error) {
	if err := h.service.Authorize(ctx, xMessagingActor(ctx), input.WorkspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, xMessagingError(err)
	}
	ready, err := h.service.Readiness(ctx, input.WorkspaceID, input.AccountID)
	if err != nil {
		return nil, xMessagingError(err)
	}
	return &XMessagingReadinessOutput{Body: ready}, nil
}
func (h *XMessagingHandler) Authorize(ctx context.Context, input *XMessagingAuthorizeInput) (*XMessagingAuthorizeOutput, error) {
	if err := h.service.Authorize(ctx, xMessagingActor(ctx), input.Body.WorkspaceID, workspaceaccess.LevelConnect); err != nil {
		return nil, xMessagingError(err)
	}
	url, err := h.service.Begin(ctx, xMessagingActor(ctx), input.Body.WorkspaceID, input.AccountID)
	if err != nil {
		return nil, xMessagingError(err)
	}
	out := new(XMessagingAuthorizeOutput)
	out.Body.URL = url
	return out, nil
}
func (h *XMessagingHandler) Complete(ctx context.Context, input *XMessagingCompleteInput) (*XMessagingCompleteOutput, error) {
	workspace, err := h.service.Complete(ctx, xMessagingActor(ctx), input.Body.State, input.Body.Code)
	if err != nil {
		return nil, xMessagingError(err)
	}
	out := new(XMessagingCompleteOutput)
	out.Body.WorkspaceID = workspace
	return out, nil
}
func (h *XMessagingHandler) Subscribe(ctx context.Context, input *XMessagingSubscribeInput) (*XMessagingSubscribeOutput, error) {
	if err := h.service.Authorize(ctx, xMessagingActor(ctx), input.Body.WorkspaceID, workspaceaccess.LevelAdminister); err != nil {
		return nil, xMessagingError(err)
	}
	result, err := h.service.StartSubscription(ctx, input.Body.WorkspaceID, input.AccountID, input.Body.EventType, input.Body.EventLimit)
	if err != nil {
		return nil, xMessagingError(err)
	}
	return &XMessagingSubscribeOutput{Body: result}, nil
}
func (h *XMessagingHandler) Stop(ctx context.Context, input *XMessagingStopInput) (*struct{}, error) {
	if err := h.service.Authorize(ctx, xMessagingActor(ctx), input.Body.WorkspaceID, workspaceaccess.LevelAdminister); err != nil {
		return nil, xMessagingError(err)
	}
	if err := h.service.StopSubscription(ctx, input.Body.WorkspaceID, input.SubscriptionID); err != nil {
		return nil, xMessagingError(err)
	}
	return &struct{}{}, nil
}

// RegisterWebhook handles raw signed bytes outside Huma's JSON decoding. The
// receipt is durable before the 200 acknowledgment; no provider I/O is done.
func (h *XMessagingHandler) RegisterWebhook(e *echo.Echo) {
	const path = "/api/v1/webhooks/x/messaging"
	e.GET(path, func(c echo.Context) error {
		token, err := h.service.Challenge(c.QueryParam("crc_token"))
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "X webhook challenge unavailable")
		}
		return c.JSON(http.StatusOK, map[string]string{"response_token": token})
	})
	e.POST(path, func(c echo.Context) error {
		body, err := io.ReadAll(io.LimitReader(c.Request().Body, (1<<20)+1))
		if err != nil || len(body) > 1<<20 {
			return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "X webhook payload exceeds limit")
		}
		// OAuth2 signature is authoritative. Never fall back to another secret
		// when an OAuth2 signature is supplied but invalid.
		err = h.service.Receive(c.Request().Context(), c.Request().Header.Get("X-Twitter-Webhooks-Signature-OAuth2"), body)
		if errors.Is(err, oauth2messaging.ErrAccessDenied) {
			return echo.NewHTTPError(http.StatusUnauthorized, "invalid X webhook signature")
		}
		if err != nil {
			return echo.NewHTTPError(http.StatusServiceUnavailable, "X webhook receipt could not be committed")
		}
		return c.NoContent(http.StatusOK)
	})
}
func xMessagingError(err error) error {
	switch {
	case errors.Is(err, oauth2messaging.ErrAccessDenied):
		return huma.Error403Forbidden("workspace access denied")
	case errors.Is(err, sql.ErrNoRows):
		return huma.Error404NotFound("X messaging account or subscription not found")
	case errors.Is(err, oauth2messaging.ErrState):
		return huma.Error400BadRequest("X messaging authorization state is invalid or expired")
	case errors.Is(err, oauth2messaging.ErrBudget):
		return huma.Error409Conflict("X activity requires an explicit operator budget and provider spending controls")
	case errors.Is(err, oauth2messaging.ErrNotConnected), errors.Is(err, oauth2messaging.ErrReconnect):
		return huma.Error409Conflict("Authorize X messaging for this account")
	case errors.Is(err, oauth2messaging.ErrUnavailable):
		return huma.Error409Conflict("X messaging OAuth2 app is not configured")
	default:
		return huma.Error503ServiceUnavailable("X messaging operation could not complete")
	}
}
