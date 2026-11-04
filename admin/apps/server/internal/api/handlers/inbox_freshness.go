package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/messaging"
)

type InboxChangesInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Cursor      string `query:"cursor" maxLength:"1024"`
	WaitSeconds int    `query:"wait_seconds" default:"25" minimum:"0" maximum:"25"`
}
type InboxChangesOutput struct{ Body messaging.InboxChangePage }
type InboxActivityInput struct {
	Body struct {
		WorkspaceID    string `json:"workspace_id" required:"true"`
		ClientID       string `json:"client_id" minLength:"1" maxLength:"128" required:"true"`
		View           string `json:"view" enum:"chats,comments,conversation,away" required:"true"`
		ConversationID string `json:"conversation_id,omitempty"`
	}
}

func (h *EngagementMessagingHandler) registerInboxFreshnessRoutes(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "get-engagement-item", Method: http.MethodGet, Path: "/engagement/{item_id}", Summary: "Read a stored comment and its known parent chain", Tags: []string{tagEngagement}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.engagementDetail)
	huma.Register(api, huma.Operation{OperationID: "inbox-summary", Method: http.MethodGet, Path: "/inbox/summary", Summary: "Read Workspace unread conversation and comment counts", Tags: []string{tagMessaging}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.inboxSummary)
	huma.Register(api, huma.Operation{OperationID: "retry-conversation-message", Method: http.MethodPost, Path: "/messages/{conversation_id}/retry", Summary: "Retry a definitely rejected message", Tags: []string{tagMessaging}, MaxBodyBytes: 4096, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.retryMessage)
	huma.Register(api, huma.Operation{OperationID: "collect-conversation-history", Method: http.MethodPost, Path: "/messages/{conversation_id}/history", Summary: "Collect an older page of conversation history", Tags: []string{tagMessaging}, MaxBodyBytes: 4096, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.messageHistory)

	huma.Register(api, huma.Operation{OperationID: "inbox-changes", Method: http.MethodGet, Path: "/inbox/changes", Summary: "Wait for stored inbox changes", Tags: []string{tagMessaging}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.inboxChanges)
	huma.Register(api, huma.Operation{OperationID: "inbox-activity", Method: http.MethodPost, Path: "/inbox/activity", Summary: "Keep an inbox view fresh while it is open", Tags: []string{tagMessaging}, MaxBodyBytes: 4096, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.inboxActivity)
}
func (h *EngagementMessagingHandler) inboxChanges(ctx context.Context, input *InboxChangesInput) (*InboxChangesOutput, error) {
	if h.messaging == nil {
		return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
	}
	page, err := h.messaging.Changes(ctx, messagingActor(ctx), input.WorkspaceID, input.Cursor, time.Duration(input.WaitSeconds)*time.Second)
	if errors.Is(err, inboxchanges.ErrInvalidCursor) {
		return nil, huma.Error400BadRequest("invalid inbox cursor")
	}
	if err != nil {
		return nil, messagingHTTPError(err, "could not read inbox updates")
	}
	return &InboxChangesOutput{Body: page}, nil
}
func (h *EngagementMessagingHandler) inboxActivity(ctx context.Context, input *InboxActivityInput) (*struct{}, error) {
	if h.messaging == nil {
		return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
	}
	err := h.messaging.Heartbeat(ctx, messagingActor(ctx), messaging.Activity{WorkspaceID: input.Body.WorkspaceID, ClientID: input.Body.ClientID, View: input.Body.View, ConversationID: input.Body.ConversationID})
	if err != nil {
		return nil, messagingHTTPError(err, "could not update inbox activity")
	}
	return nil, nil
}

type RetryMessageInput struct {
	ConversationID string `path:"conversation_id"`
	Body           struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
		MessageID   string `json:"message_id" required:"true"`
	}
}
type MessageHistoryInput struct {
	ConversationID string `path:"conversation_id"`
	Body           struct {
		WorkspaceID string `json:"workspace_id" required:"true"`
	}
}

func (h *EngagementMessagingHandler) retryMessage(ctx context.Context, input *RetryMessageInput) (*SendMessageOutput, error) {
	if h.messaging == nil {
		return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
	}
	message, err := h.messaging.RetryMessage(ctx, messagingActor(ctx), input.Body.WorkspaceID, input.ConversationID, input.Body.MessageID)
	if errors.Is(err, messaging.ErrRetryUnsafe) {
		return nil, huma.Error409Conflict(err.Error())
	}
	if err != nil {
		return nil, messagingHTTPError(err, "could not retry message")
	}
	return &SendMessageOutput{Body: *message}, nil
}
func (h *EngagementMessagingHandler) messageHistory(ctx context.Context, input *MessageHistoryInput) (*struct{}, error) {
	if h.messaging == nil {
		return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
	}
	if err := h.messaging.QueueHistory(ctx, messagingActor(ctx), input.Body.WorkspaceID, input.ConversationID); err != nil {
		return nil, messagingHTTPError(err, "could not collect older messages")
	}
	return nil, nil
}

type InboxSummaryInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
}
type InboxSummaryOutput struct{ Body messaging.InboxSummary }

func (h *EngagementMessagingHandler) inboxSummary(ctx context.Context, input *InboxSummaryInput) (*InboxSummaryOutput, error) {
	if h.messaging == nil {
		return nil, huma.Error503ServiceUnavailable("messaging service is unavailable")
	}
	summary, err := h.messaging.Summary(ctx, messagingActor(ctx), input.WorkspaceID)
	if err != nil {
		return nil, messagingHTTPError(err, "could not load unread totals")
	}
	return &InboxSummaryOutput{Body: summary}, nil
}

type EngagementDetailInput struct {
	ItemID      string `path:"item_id"`
	WorkspaceID string `query:"workspace_id" required:"true"`
}
type EngagementDetailOutput struct{ Body engagement.EngagementDetail }

func (h *EngagementMessagingHandler) engagementDetail(ctx context.Context, input *EngagementDetailInput) (*EngagementDetailOutput, error) {
	if h.engagement == nil {
		return nil, huma.Error503ServiceUnavailable("engagement service is unavailable")
	}
	detail, err := h.engagement.GetEngagement(ctx, engagementActor(ctx), input.WorkspaceID, input.ItemID)
	if err != nil {
		return nil, engagementHTTPError(err, "could not load comment")
	}
	return &EngagementDetailOutput{Body: detail}, nil
}
