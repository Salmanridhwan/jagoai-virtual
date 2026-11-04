package engagement

import (
	"context"
	"database/sql"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

// MarkAllRead marks every matching inbound item, including unloaded pages.
// The same filters own listing and mutation. Read state and journal events commit
// together, so other Workspace clients observe the entire action.
func (s *Service) MarkAllRead(ctx context.Context, actor Actor, input Query) (int, error) {
	if err := s.authorize(ctx, input.WorkspaceID, actor, workspaceaccess.LevelEdit); err != nil {
		return 0, err
	}
	var changed []models.EngagementItem
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, input.WorkspaceID); err != nil {
			return err
		}
		decision, err := workspaceaccess.NewAuthorizer(tx).Authorize(ctx, input.WorkspaceID, actor, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		if !decision.Allowed {
			return ErrAccessDenied
		}
		matching := tx.NewSelect().Model((*models.EngagementItem)(nil)).Column("id").Where("workspace_id = ?", input.WorkspaceID)
		matching = engagementFilters(matching, input.Platform, input.AccountID, input.PublicationID, input.Kind, true, input.Archived)
		if err := tx.NewUpdate().Model((*models.EngagementItem)(nil)).
			Set("read_at = ?", s.now()).Where("workspace_id = ? AND read_at IS NULL", input.WorkspaceID).
			Where("id IN (?)", matching).Returning("id, deleted_at").Scan(ctx, &changed); err != nil {
			return err
		}
		events := make([]inboxchanges.Change, len(changed))
		for i, item := range changed {
			events[i] = inboxchanges.Change{Kind: "engagement", EngagementID: item.ID, Deleted: !item.DeletedAt.IsZero()}
		}
		return inboxchanges.Append(ctx, tx, input.WorkspaceID, events...)
	})
	return len(changed), err
}
