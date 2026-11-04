package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// WorkflowRunSummary retains the immutable diagram and execution status needed
// by run lists. Source data and step inputs/outputs remain in the full run read.
type WorkflowRunSummary struct {
	ID               string                `json:"id"`
	WorkflowID       string                `json:"workflow_id"`
	WorkspaceID      string                `json:"workspace_id"`
	WorkflowName     string                `json:"workflow_name"`
	WorkflowRevision int                   `json:"workflow_revision"`
	Mode             string                `json:"mode"`
	State            string                `json:"state"`
	Revision         int                   `json:"revision"`
	Definition       Definition            `json:"definition"`
	Steps            []WorkflowStepSummary `json:"steps"`
	CurrentStepID    string                `json:"current_step_id,omitempty"`
	Error            string                `json:"error,omitempty"`
	WakeAt           *time.Time            `json:"wake_at,omitempty"`
	CreatedAt        time.Time             `json:"created_at"`
	UpdatedAt        time.Time             `json:"updated_at"`
}

type WorkflowStepSummary struct {
	StepID string `json:"step_id"`
	State  string `json:"state"`
}

func (s *Service) RunSummaries(ctx context.Context, actor workspaceaccess.ActorFacts, workspaceID, workflowID string) ([]WorkflowRunSummary, error) {
	if _, err := s.authorize(ctx, actor, workspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	records := []runRecord{}
	query := s.db.NewSelect().Model(&records).
		Column("id", "workflow_id", "workspace_id", "workflow_name", "workflow_revision", "mode", "state", "revision", "definition_json", "current_step_id", "error", "wake_at", "created_at", "updated_at").
		Where("workspace_id = ?", workspaceID).Order("created_at DESC").Limit(50)
	if workflowID != "" {
		query = query.Where("workflow_id = ?", workflowID)
	}
	// Extract only the status fields before crossing the database boundary. Keep
	// result order and JSON value types, including legacy null result lists.
	fullResultsQuery := query.Clone().Column("results_json")
	if s.db.Dialect().Name() == dialect.PG {
		query = query.ColumnExpr(`(SELECT COALESCE(json_agg(CASE WHEN json_typeof(value) = 'object'
   THEN json_build_object('step_id', value->'step_id', 'state', value->'state') ELSE value END ORDER BY position), '[]'::json)
   FROM json_array_elements(CASE WHEN json_typeof(results_json::json) = 'null' THEN '[]'::json ELSE results_json::json END) WITH ORDINALITY AS result(value, position)) AS results_json`)
	} else {
		// Both bundled SQLite drivers provide the binary iterator, avoiding a
		// text serialization and reparse of each potentially large step result.
		query = query.ColumnExpr(`(SELECT json_group_array(CASE WHEN type = 'object'
   THEN json_object('step_id', json_extract(value, '$.step_id'), 'state', json_extract(value, '$.state')) ELSE value END ORDER BY key)
   FROM jsonb_each(CASE json_type(results_json) WHEN 'array' THEN results_json WHEN 'null' THEN '[]' ELSE json('invalid workflow run results') END)) AS results_json`)
	}
	if err := query.Scan(ctx); err != nil {
		var postgresError pgdriver.Error
		if !errors.As(err, &postgresError) {
			return nil, err
		}
		switch postgresError.Field('C') {
		case "22P05", "22003", "22P02":
			// Go accepts authored JSON values such as escaped NUL that PostgreSQL
			// cannot project. Decode only the summary fields in that rare case.
			records = nil
			if err := fullResultsQuery.Scan(ctx); err != nil {
				return nil, err
			}
		default:
			return nil, err
		}
	}
	result := make([]WorkflowRunSummary, 0, len(records))
	for _, record := range records {
		run := WorkflowRunSummary{ID: record.ID, WorkflowID: record.WorkflowID, WorkspaceID: record.WorkspaceID, WorkflowName: record.WorkflowName, WorkflowRevision: record.WorkflowRevision, Mode: record.Mode, State: record.State, Revision: record.Revision, CurrentStepID: record.CurrentStepID, Error: record.Error, WakeAt: record.WakeAt, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt}
		if err := json.Unmarshal([]byte(record.DefinitionJSON), &run.Definition); err != nil {
			return nil, fmt.Errorf("decode workflow run definition: %w", err)
		}
		if err := json.Unmarshal([]byte(record.ResultsJSON), &run.Steps); err != nil {
			return nil, fmt.Errorf("decode workflow run summary: %w", err)
		}
		if run.Steps == nil {
			run.Steps = []WorkflowStepSummary{}
		}
		result = append(result, run)
	}
	return result, nil
}
