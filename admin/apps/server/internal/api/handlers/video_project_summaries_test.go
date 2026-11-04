package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCloudVideoProjectSummaries(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		server := newVideoProjectTestServer(t)
		t.Cleanup(func() { require.NoError(t, server.db.Close()) })
		testCloudVideoProjectSummaries(t, server)
	})
	t.Run("postgres", func(t *testing.T) {
		testCloudVideoProjectSummaries(t, newPostgresVideoProjectTestServer(t))
	})
}

func newPostgresVideoProjectTestServer(t testing.TB) *videoProjectTestServer {
	t.Helper()
	db := createHandlerPostgresTestDB(t,
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil), (*models.VideoProject)(nil),
	)
	return videoProjectTestServerWithDB(t, db)
}

func testCloudVideoProjectSummaries(t *testing.T, server *videoProjectTestServer) {
	t.Helper()
	now := time.Date(2026, 10, 13, 20, 0, 0, 0, time.UTC)
	document := `{"schemaFamily":"quick-cut","timeline":{"content":"` + strings.Repeat("large authored content ", 50_000) + `"}}`
	projects := []models.VideoProject{
		{ID: "quick", WorkspaceID: "ws-1", Name: "Quick Cut", HeadRevision: 7, DocumentJSON: document, UpdatedAt: now, SyncStatus: models.VideoProjectSyncNeedsAttention, AttentionReason: "Missing media", PreviewObjectKey: "preview/quick", CreatedByUserID: "user-editor", UpdatedByUserID: "user-editor"},
		{ID: "old", WorkspaceID: "ws-1", Name: "Legacy", DocumentJSON: `{"timeline":{}}`, UpdatedAt: now.Add(-time.Hour)},
		{ID: "trash", WorkspaceID: "ws-1", Name: "Deleted", DocumentJSON: `{"schemaFamily":"openpost"}`, UpdatedAt: now.Add(time.Hour), TrashedAt: now, RetentionExpiresAt: now.Add(24 * time.Hour)},
		{ID: "other", WorkspaceID: "ws-2", Name: "Private", DocumentJSON: `{"schemaFamily":"quick-cut"}`, UpdatedAt: now},
	}
	_, err := server.db.NewInsert().Model(&projects).Exec(t.Context())
	require.NoError(t, err)
	path := "/api/v1/video-project-summaries?workspace_id=ws-1"
	response := server.request(t, "viewer-token", http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Less(t, response.Body.Len(), 2_000, "Browsing must not transfer editing documents")
	var summaries []map[string]any
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &summaries))
	require.Len(t, summaries, 2)
	require.Equal(t, "quick", summaries[0]["id"])
	require.Equal(t, "quick-cut", summaries[0]["schema_family"])
	require.Equal(t, float64(7), summaries[0]["head_revision"])
	require.Equal(t, "needs_attention", summaries[0]["sync_status"])
	require.Equal(t, "Missing media", summaries[0]["attention_reason"])
	require.Equal(t, "preview/quick", summaries[0]["preview_object_key"])
	require.Equal(t, "Legacy", summaries[1]["name"])
	require.Equal(t, "", summaries[1]["schema_family"])
	for _, summary := range summaries {
		require.NotContains(t, summary, "document")
	}
	response = server.request(t, "viewer-token", http.MethodGet, path+"&include_trash=true", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &summaries))
	require.Len(t, summaries, 3)
	require.Equal(t, "trash", summaries[0]["id"])
	require.Equal(t, "2026-10-13T20:00:00Z", summaries[0]["trashed_at"])
	require.Equal(t, "2026-10-14T20:00:00Z", summaries[0]["retention_expires_at"])
	require.Equal(t, http.StatusForbidden, server.request(t, "viewer-token", http.MethodGet, "/api/v1/video-project-summaries?workspace_id=ws-2", nil).Code)
	require.Equal(t, http.StatusUnauthorized, server.request(t, "invalid", http.MethodGet, path, nil).Code)
	// The separate detail read retains the entire authored document.
	response = server.request(t, "viewer-token", http.MethodGet, "/api/v1/video-projects/quick?workspace_id=ws-1", nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var detail struct {
		Document json.RawMessage `json:"document"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &detail))
	require.JSONEq(t, document, string(detail.Document))

	for _, family := range []string{`null`, `123`, `false`, `{}`, `[]`, `"future-editor"`} {
		_, err = server.db.NewUpdate().Model((*models.VideoProject)(nil)).Set("document_json = ?", `{"schemaFamily":`+family+`}`).Where("id = ?", "quick").Exec(t.Context())
		require.NoError(t, err)
		response = server.request(t, "viewer-token", http.MethodGet, path, nil)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &summaries))
		expected := ""
		if family == `"future-editor"` {
			expected = "future-editor"
		}
		require.Equal(t, expected, summaries[0]["schema_family"], family)
	}

	for _, testCase := range []struct{ document, family string }{
		{`{"schemaFamily":"quick-cut","timeline":{"text":"a\u0000b"}}`, "quick-cut"},
		{`{"schemaFamily":"quick-cut","timeline":{"value":1e1000000}}`, "quick-cut"},
		{`{"schemaFamily":"quick-cut","timeline":{"text":"\ud800"}}`, "quick-cut"},
		{`{"schemaFamily":"quick\u0000cut"}`, "quick\x00cut"},
		{`{"schemafamily":"quick-cut","timeline":{"text":"a\u0000b"}}`, ""},
	} {
		_, err = server.db.NewUpdate().Model((*models.VideoProject)(nil)).Set("document_json = ?", testCase.document).Where("id = ?", "quick").Exec(t.Context())
		require.NoError(t, err)
		response = server.request(t, "viewer-token", http.MethodGet, path, nil)
		require.Equal(t, http.StatusOK, response.Code, "%s: %s", testCase.document, response.Body.String())
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &summaries))
		require.Equal(t, testCase.family, summaries[0]["schema_family"], testCase.document)
	}
	_, err = server.db.NewUpdate().Model((*models.VideoProject)(nil)).Set("document_json = ?", `{invalid`).Where("id = ?", "quick").Exec(t.Context())
	require.NoError(t, err)
	require.Equal(t, http.StatusInternalServerError, server.request(t, "viewer-token", http.MethodGet, path, nil).Code)
}
