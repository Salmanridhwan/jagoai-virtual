package migrations

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestLegacyPublicationJobRewriteAcceptsNullPayload(t *testing.T) {
	for _, payload := range []string{"null", "{}", `{"post_id":"legacy-post","custom":"preserved"}`} {
		t.Run(payload, func(t *testing.T) {
			db := newMigrationsTestDB(t)
			createLegacyPublicationTestTables(t, db)
			_, err := db.NewInsert().Model(&models.Post{ID: "legacy-post", WorkspaceID: "workspace", Status: models.PostStatusScheduled}).Exec(t.Context())
			require.NoError(t, err)
			runAt := time.Now().UTC().Truncate(time.Second)
			_, err = db.NewInsert().Model(&models.Job{ID: "legacy-job", Type: jobregistry.TypePublishPost, ScopeID: "legacy-post", Status: jobregistry.StatusPending, Payload: payload, RunAt: runAt, MaxAttempts: 3}).Exec(t.Context())
			require.NoError(t, err)
			require.NotPanics(t, func() {
				require.NoError(t, rewriteLegacyPublicationJobs(t.Context(), db, "legacy-post", "publication"))
			})
			var job models.Job
			require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", "legacy-job").Scan(t.Context()))
			require.Equal(t, jobregistry.TypePublishPublication, job.Type)
			require.Equal(t, "publication", job.ScopeID)
			require.Equal(t, jobregistry.StatusPending, job.Status)
			require.True(t, runAt.Equal(job.RunAt))
			var saved map[string]any
			require.NoError(t, json.Unmarshal([]byte(job.Payload), &saved))
			require.Equal(t, "publication", saved["publication_id"])
			require.NotContains(t, saved, "post_id")
			if payload != "null" && payload != "{}" {
				require.Equal(t, "preserved", saved["custom"])
			}
		})
	}
}
