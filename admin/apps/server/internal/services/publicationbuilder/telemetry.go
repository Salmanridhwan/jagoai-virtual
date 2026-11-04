package publicationbuilder

import (
	"context"
	"log"
	"strconv"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/telemetry"
)

func (application *Application) captureTelemetry(ctx context.Context, name string, record *BuildRecord, properties map[string]any) {
	if application.telemetry == nil {
		return
	}
	properties["build_id"] = record.ID
	if err := application.telemetry.Capture(ctx, telemetry.Event{
		Name: name, DistinctID: record.CreatedByID, WorkspaceID: record.WorkspaceID, Properties: properties,
		UUID: uuid.NewSHA1(uuid.NameSpaceOID, []byte(name+":"+record.ID+":"+strconv.Itoa(record.Revision))).String(),
	}); err != nil {
		log.Printf("Failed to enqueue publication build telemetry: %v", err)
	}
}

// ObserveTerminalJobFailure runs only after the queue's job/domain transaction commits.
func (application *Application) ObserveTerminalJobFailure(ctx context.Context, payload string) {
	if application.telemetry == nil {
		return
	}
	decoded, err := jobregistry.DecodePublicationBuildPayload(payload)
	if err != nil {
		return
	}
	var record BuildRecord
	if err := application.db.NewSelect().Model(&record).Where("id = ?", decoded.BuildID).Scan(ctx); err != nil {
		log.Printf("Failed to inspect terminal publication build telemetry: %v", err)
		return
	}
	if record.State == BuildStateFailed && record.ErrorCode == "job_failed" {
		application.captureTelemetry(ctx, telemetry.EventPublicationBuildFailed, &record, map[string]any{"error_code": "job_failed", "http_status": 0})
	}
}
