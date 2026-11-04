package handlers

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/engagement"
)

type MarkEngagementReadInput struct {
	Body struct {
		WorkspaceID   string `json:"workspace_id" required:"true"`
		Platform      string `json:"platform,omitempty"`
		AccountID     string `json:"account_id,omitempty"`
		PublicationID string `json:"publication_id,omitempty"`
		Kind          string `json:"kind,omitempty" enum:"comment,mention,review"`
		Archived      bool   `json:"archived,omitempty"`
	}
}

type MarkEngagementReadOutput struct {
	Body struct {
		UpdatedCount int `json:"updated_count" doc:"Number of matching unread items marked read across all pages. Read state is shared by the Workspace."`
	}
}

func (h *EngagementMessagingHandler) registerBulkEngagementRead(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "mark-engagement-read", Method: http.MethodPost, Path: "/engagement/read",
		Summary: "Mark all matching engagement read across every page",
		Tags:    []string{tagEngagement}, MaxBodyBytes: 8 * 1024,
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{403, 500, 503},
	}, h.markEngagementRead)
}

func (h *EngagementMessagingHandler) markEngagementRead(ctx context.Context, input *MarkEngagementReadInput) (*MarkEngagementReadOutput, error) {
	if h.engagement == nil {
		return nil, huma.Error503ServiceUnavailable("engagement service is unavailable")
	}
	count, err := h.engagement.MarkAllRead(ctx, engagementActor(ctx), engagement.Query{
		WorkspaceID: input.Body.WorkspaceID, Platform: input.Body.Platform, AccountID: input.Body.AccountID,
		PublicationID: input.Body.PublicationID, Kind: input.Body.Kind, Archived: input.Body.Archived,
	})
	if err != nil {
		return nil, engagementHTTPError(err, "failed to mark matching engagement read")
	}
	output := &MarkEngagementReadOutput{}
	output.Body.UpdatedCount = count
	return output, nil
}
