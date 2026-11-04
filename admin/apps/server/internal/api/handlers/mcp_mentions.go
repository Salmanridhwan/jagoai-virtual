package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/openpost/backend/internal/models"
)

const mcpToolLookupMentions = "lookup_mentions"

func mcpLookupMentionsTool() mcpOperationDefinition {
	return mcpOperationDescriptor(map[string]any{
		"name": mcpToolLookupMentions, "title": "Find mention targets", "description": "Search people on Bluesky or Mastodon, or look up the exact LinkedIn company page vanity name. Use returned provider identity and visible label in settings.mentions, with version 1 and UTF-8 byte ranges in the exact segment body. Never guess identities across providers. Permission and rate-limit failures require recovery, not a different person.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{"workspace_id": map[string]any{"type": "string"}, "account_id": map[string]any{"type": "string"}, "query": map[string]any{"type": "string", "minLength": 2, "maxLength": 100}}, "required": []string{"workspace_id", "account_id", "query"}, "additionalProperties": false},
	}, mcpOperationQuery, false, false)
}
func (h *MCPHandler) lookupMCPMentions(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
		AccountID   string `json:"account_id"`
		Query       string `json:"query"`
	}
	if err := decodeMCPArguments(args, &input); err != nil || utf8.RuneCountInString(strings.TrimSpace(input.Query)) < 2 || utf8.RuneCountInString(input.Query) > 100 {
		return nil, &mcpError{Code: -32602, Message: "workspace_id, account_id and a query of 2 to 100 characters are required"}
	}
	if err := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); err != nil {
		return nil, err
	}
	var account models.SocialAccount
	if err := h.db.NewSelect().Model(&account).Where("id = ? AND workspace_id = ?", input.AccountID, input.WorkspaceID).Scan(ctx); err != nil {
		return nil, &mcpError{Code: -32602, Message: "connected account not found in this workspace"}
	}
	h.providersMu.RLock()
	providers := cloneProviderAdapters(h.providers)
	h.providersMu.RUnlock()
	handler := NewDestinationOptionsHandler(h.db, h.auth, providers, h.tokenSource)
	output, err := handler.lookupAccountMentions(ctx, &MentionLookupInput{AccountID: input.AccountID, Query: input.Query}, userID)
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}
	encoded, _ := json.Marshal(output.Body)
	return map[string]any{"content": []mcpContent{{Type: "text", Text: string(encoded)}}, "structuredContent": output.Body}, nil
}
