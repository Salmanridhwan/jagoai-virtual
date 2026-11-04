package medialifecycle

import (
	"context"
	"fmt"

	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

// RetireTextCards releases superseded generated files in the publication's
// transaction. Every current or historical owner, and library organization,
// takes precedence over this immediate cleanup policy.
func RetireTextCards(ctx context.Context, tx bun.Tx, workspaceID string, candidateIDs []string) error {
	if len(candidateIDs) == 0 {
		return nil
	}
	var media []models.MediaAttachment
	query := tx.NewSelect().Model(&media).
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(uniqueIDs(candidateIDs))).
		Where("source = ? AND retention_class = ? AND is_favorite = ? AND trashed_at IS NULL", "text_card", RetentionTemporary, false).
		Order("id ASC")
	if tx.Dialect().Name() == dialect.PG {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return err
	}
	if len(media) == 0 {
		return nil
	}
	pending, err := migrations.WorkspaceEditorRevisionMediaBackfillPending(ctx, tx, workspaceID)
	if err != nil {
		return err
	}
	if pending {
		return nil // Normal lifecycle cleanup resumes after indexing completes.
	}
	ids := make([]string, len(media))
	for i, item := range media {
		ids[i] = item.ID
	}
	snapshot, err := textCardProtection(ctx, tx, workspaceID, ids)
	if err != nil {
		return err
	}
	var retired []models.MediaAttachment
	for _, item := range media {
		if !snapshot.isReferenced(item.ID) && !snapshot.isOrganized(item.ID) {
			retired = append(retired, item)
		}
	}
	if len(retired) == 0 {
		return nil
	}
	if _, err := jobregistry.EnqueueStorageDeletes(ctx, tx, purgedObjectKeys(retired)); err != nil {
		return fmt.Errorf("enqueue replaced text card deletion: %w", err)
	}
	return purgeMediaBatch(ctx, tx, snapshot, retired)
}

func textCardProtection(ctx context.Context, tx bun.Tx, workspaceID string, ids []string) (*protectionSnapshot, error) {
	snapshot, err := loadProtectionSnapshot(ctx, tx, workspaceID, ids)
	if err != nil {
		return nil, err
	}
	// Normal expiry may rewrite historical references. Replacing an image must
	// preserve them, including JSON-only cover or thumbnail selections.
	for _, reference := range snapshot.legacyJSON {
		referenced, err := mediaIDsFromJSONReference(reference)
		if err != nil {
			return nil, err
		}
		for _, id := range referenced {
			snapshot.referenced[id] = struct{}{}
		}
	}
	var referenced []string
	err = tx.NewRaw(`WITH candidates(id) AS (SELECT id FROM media_attachments WHERE id IN (?))
		SELECT media_id FROM publication_assets WHERE media_id IN (SELECT id FROM candidates)
		UNION SELECT media_id FROM publication_segment_media WHERE media_id IN (SELECT id FROM candidates)
		UNION SELECT media_id FROM rendition_segment_media WHERE media_id IN (SELECT id FROM candidates)
		UNION SELECT media_id FROM rendition_media WHERE media_id IN (SELECT id FROM candidates)
		UNION SELECT media_id FROM rendition_media_deliveries WHERE media_id IN (SELECT id FROM candidates)
		UNION SELECT related_media_id FROM rendition_media_delivery_relations WHERE related_media_id IN (SELECT id FROM candidates)
		UNION SELECT media_id FROM design_media_references WHERE media_id IN (SELECT id FROM candidates)
		UNION SELECT media_id FROM design_revision_media_references WHERE media_id IN (SELECT id FROM candidates)
		UNION SELECT source_media_id FROM design_documents WHERE source_media_id IN (SELECT id FROM candidates)
		UNION SELECT cover_preview_media_id FROM design_documents WHERE cover_preview_media_id IN (SELECT id FROM candidates)
		UNION SELECT preview_media_id FROM design_pages WHERE preview_media_id IN (SELECT id FROM candidates)
		UNION SELECT latest_export_media_id FROM design_pages WHERE latest_export_media_id IN (SELECT id FROM candidates)`, bun.List(ids)).Scan(ctx, &referenced)
	if err != nil {
		return nil, err
	}
	for _, id := range referenced {
		snapshot.referenced[id] = struct{}{}
	}
	return snapshot, nil
}
