package aiusage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func RecordImageDispatch(ctx context.Context, db bun.IDB, identity EditorIdentity, organizationID, model, operation string) error {
	call := EditorCall{ID: uuid.NewString(), OrganizationID: organizationID, WorkspaceID: identity.WorkspaceID, UserID: identity.UserID, ProjectID: identity.ProjectID, RunID: identity.RunID, Step: 1, RequestedModel: model, Model: model, Provider: "fal", Operation: operation, State: "dispatched", CreatedAt: time.Now().UTC()}
	_, err := db.NewInsert().Model(&call).On("CONFLICT (run_id, step) DO NOTHING").Exec(ctx)
	return err
}

func SetImageOutcome(ctx context.Context, db bun.IDB, runID, receipt, state string, cost *int64) error {
	query := db.NewUpdate().Model((*EditorCall)(nil)).Set("provider_request_id = ?", receipt).Set("state = ?", state).Set("cost_microusd = ?", cost).Where("run_id = ? AND step = 1 AND provider = 'fal'", runID)
	if state == "completed" || state == "failed" || state == "unknown" {
		query = query.Set("finished_at = ?", time.Now().UTC())
	}
	_, err := query.Exec(ctx)
	return err
}
