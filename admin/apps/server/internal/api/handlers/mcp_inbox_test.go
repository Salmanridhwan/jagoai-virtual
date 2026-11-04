package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/engagement"
	"github.com/stretchr/testify/require"
)

func TestMCPInboxReadsOrphansAndEnforcesScopeBeforeMutations(t *testing.T) {
	srv := newMCPTestServer(t)
	db, err := database.InitDBWithDriver("sqlite", "file:mcp-inbox-"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	for _, row := range []any{
		&models.User{ID: "user-1", Email: "inbox@example.test"},
		&models.Organization{ID: "organization-1", Name: "Inbox", CreatedByID: "user-1"},
		&models.Workspace{ID: "ws-1", Name: "Inbox", OrganizationID: "organization-1"},
		&models.Workspace{ID: "ws-2", Name: "Other", OrganizationID: "organization-1"},
		&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		&models.SocialAccount{ID: "account-1", WorkspaceID: "ws-1", Platform: "x", AccountID: "native-account", Slug: "inbox", AccessTokenEnc: []byte("synthetic"), IsActive: true},
	} {
		_, err = db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	srv.db, srv.handler.db = db, db
	srv.handler.SetEngagementService(engagement.NewService(srv.db, nil, nil))
	srv.handler.auth = mcpScopeAuthenticator{
		"read":  {UserID: "user-1", Scope: "mcp:read", WorkspaceID: "ws-1"},
		"write": {UserID: "user-1", Scope: "mcp:full", WorkspaceID: "ws-1"},
	}
	items := []models.EngagementItem{
		{ID: "mention", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "x", Kind: "mention", RemoteID: "native-post", Body: "Incoming mention", SubjectJSON: `{"kind":"post","remote_id":"native-post"}`, LastSeenAt: time.Now().UTC()},
		{ID: "review", WorkspaceID: "ws-1", SocialAccountID: "account-1", Platform: "x", Kind: "review", RemoteID: "native-review", Body: "", SubjectJSON: `{"kind":"review","remote_id":"native-review","review":{"anonymous":true,"stars":5}}`, LastSeenAt: time.Now().UTC()},
	}
	_, err = srv.db.NewInsert().Model(&items).Exec(t.Context())
	require.NoError(t, err)
	call := func(token, tool string, args map[string]any) map[string]any {
		response := srv.request(t, token, map[string]any{"jsonrpc": "2.0", "id": tool, "method": "tools/call", "params": map[string]any{"name": tool, "arguments": args}})
		var output map[string]any
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output), response.Body.String())
		return output
	}
	listed := call("read", mcpToolInboxList, map[string]any{"workspace_id": "ws-1", "kind": "mention"})
	require.NotContains(t, listed, "error")
	data := listed["result"].(map[string]any)["structuredContent"].(map[string]any)
	require.Len(t, data["items"], 1)
	mention := data["items"].([]any)[0].(map[string]any)
	require.Equal(t, "mention", mention["id"])
	require.NotContains(t, mention, "rendition_id")
	denied := call("read", mcpToolInboxRead, map[string]any{"workspace_id": "ws-1", "kind": "mention"})
	require.Contains(t, denied, "error")
	denied = call("write", mcpToolInboxGet, map[string]any{"workspace_id": "ws-2", "item_id": "review"})
	require.Contains(t, denied, "error")
	updated := call("write", mcpToolInboxRead, map[string]any{"workspace_id": "ws-1", "kind": "mention"})
	require.NotContains(t, updated, "error")
	var review models.EngagementItem
	require.NoError(t, srv.db.NewSelect().Model(&review).Where("id='review'").Scan(t.Context()))
	require.True(t, review.ReadAt.IsZero(), "MCP bulk read uses the requested activity filter")
}
