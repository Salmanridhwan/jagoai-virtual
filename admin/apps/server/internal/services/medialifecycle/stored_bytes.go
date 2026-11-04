package medialifecycle

import (
	"context"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// StoredBytes uses the billable library size. Internal design and template
// previews are excluded consistently for uploads and generated publishing media.
func StoredBytes(ctx context.Context, db bun.IDB, workspaceID, excludeMediaID string) (int64, error) {
	var stored int64
	query := db.NewSelect().Model((*models.MediaAttachment)(nil)).
		ColumnExpr("COALESCE(SUM(size), 0)").Where("workspace_id = ?", workspaceID).
		Where("(asset_kind NOT IN (?, ?) OR asset_kind = '' OR asset_kind IS NULL)", "design_preview", "template_preview")
	if excludeMediaID != "" {
		query = query.Where("id != ?", excludeMediaID)
	}
	err := query.Scan(ctx, &stored)
	return stored, err
}
