package workflows

import (
	"context"
	"encoding/json"
	"log"

	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/openpost/backend/internal/telemetry"
)

func (s *Service) captureFinishedRun(ctx context.Context, record runRecord, outcome string, stepCount int) {
	if s.telemetry == nil || (outcome != StateSucceeded && outcome != StateFailed) {
		return
	}
	var authority workspaceaccess.StoredAuthority
	if json.Unmarshal([]byte(record.AuthorityJSON), &authority) != nil {
		return
	}
	if err := s.telemetry.Capture(ctx, telemetry.Event{
		Name: telemetry.EventWorkflowRunFinished, DistinctID: authority.UserID, WorkspaceID: record.WorkspaceID,
		UUID:       record.ID,
		Properties: map[string]any{"workflow_id": record.WorkflowID, "run_id": record.ID, "mode": record.Mode, "outcome": outcome, "step_count": stepCount},
	}); err != nil {
		log.Printf("Failed to enqueue workflow telemetry: %v", err)
	}
}
