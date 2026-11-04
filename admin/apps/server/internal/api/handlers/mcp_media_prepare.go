package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

const mcpToolPrepareImage = "prepare_media_image"

func mcpPrepareMediaImageTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolPrepareImage, "title": "Fit image to destination",
		"description": "Create a separate ready image derivative fitted to a connected account and destination format. Retains the original. Explicitly use the returned media ID to attach the fitted copy; it never replaces an attachment or publishes a post. Animated images are rejected rather than flattened.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{
			"media_id": map[string]any{"type": "string"}, "account_id": map[string]any{"type": "string"}, "output_profile": map[string]any{"type": "string", "description": "Explicit format from resolve-capabilities, for example instagram.feed."}, "alt_text": map[string]any{"type": "string", "maxLength": 2000}, "settings": map[string]any{"type": "object", "description": "Destination settings used when resolving limits."},
		}, "required": []string{"media_id", "account_id", "output_profile"}, "additionalProperties": false},
	}, mcpOperationExecute, false, false)
}

func (h *MCPHandler) prepareMediaImage(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		MediaID string `json:"media_id"`
		PrepareMediaImageBody
	}
	if err := decodeMCPArguments(args, &input); err != nil || strings.TrimSpace(input.MediaID) == "" || strings.TrimSpace(input.AccountID) == "" || strings.TrimSpace(input.OutputProfile) == "" {
		return nil, &mcpError{Code: -32602, Message: "media_id, account_id, and output_profile are required"}
	}
	media, rpcErr := h.loadMCPMedia(ctx, userID, input.MediaID)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if rpcErr := h.ensureWorkspaceEditAccess(ctx, userID, media.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	if h.mediaHandler == nil {
		return nil, &mcpError{Code: -32603, Message: "media preparation is unavailable"}
	}
	result, err := h.mediaHandler.prepareImage(ctx, userID, input.MediaID, input.PrepareMediaImageBody)
	if err != nil {
		var statusErr huma.StatusError
		if errors.As(err, &statusErr) && statusErr.GetStatus() < http.StatusInternalServerError {
			return nil, &mcpError{Code: -32602, Message: statusErr.Error()}
		}
		return nil, &mcpError{Code: -32603, Message: "Could not prepare image"}
	}
	body, _ := json.Marshal(result.Body)
	return map[string]any{"content": []mcpContent{{Type: "text", Text: string(body)}}, "structuredContent": result.Body}, nil
}
