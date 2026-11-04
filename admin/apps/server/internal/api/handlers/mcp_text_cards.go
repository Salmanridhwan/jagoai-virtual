package handlers

import (
	"context"
	"strings"
)

const mcpToolPreviewTextCard = "preview_text_card"

func mcpPreviewTextCardTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name":        mcpToolPreviewTextCard,
		"title":       "Preview text as image",
		"description": "Preview Instagram or Pixelfed text cards with the publishing renderer. Returns JPEG images without saving or publishing. The same settings belong in variant settings or Social Set default_settings: text_card (text_only, always, off), text_card_appearance (light, dark), text_card_background (solid, gradient, mesh), text_card_color and text_card_color_end (hex colors), text_card_rounded and text_card_shadow (booleans). Use instagram.story for vertical Stories. With always, generated text images precede attachments; all images count toward the destination limit. get_post includes the saved delivery order in segments.output_media.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"social_account_id": map[string]any{"type": "string", "description": "Connected Instagram or Pixelfed account."},
				"text":              map[string]any{"type": "string", "maxLength": 2200},
				"output_profile":    map[string]any{"type": "string", "description": "Optional destination format, such as instagram.feed or instagram.story."},
				"attachment_count":  map[string]any{"type": "integer", "minimum": 0, "maximum": 35},
				"settings":          map[string]any{"type": "object", "additionalProperties": true},
			},
			"required": []string{"social_account_id", "text"}, "additionalProperties": false,
		},
	}, mcpOperationQuery, false, false)
}

func (h *MCPHandler) previewTextCard(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input PreviewTextCardInput
	if err := decodeMCPArguments(args, &input.Body); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid preview_text_card arguments"}
	}
	output, err := h.publicationHandler().previewTextCardForUser(ctx, userID, &input)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}
	content := make([]mcpContent, 0, len(output.Body.Images))
	for _, image := range output.Body.Images {
		content = append(content, mcpContent{Type: "image", MimeType: "image/jpeg", Data: strings.TrimPrefix(image.DataURL, "data:image/jpeg;base64,")})
	}
	return map[string]any{"content": content, "structuredContent": map[string]any{"image_count": len(content)}}, nil
}
