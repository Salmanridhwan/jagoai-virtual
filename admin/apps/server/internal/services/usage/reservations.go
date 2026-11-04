package usage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

// ReserveMonthlyInTransaction charges a logical operation once. The caller
// holds the Workspace mutation lock and commits alongside dispatch admission.
func ReserveMonthlyInTransaction(ctx context.Context, db bun.IDB, key, workspaceID string, metric entitlements.LimitKey, at time.Time, decision entitlements.Decision) error {
	var receipt models.MonthlyUsageReservation
	err := db.NewSelect().Model(&receipt).Where("operation_key = ?", key).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		if receipt.WorkspaceID != workspaceID || receipt.Metric != string(metric) {
			return fmt.Errorf("usage reservation ownership changed")
		}
		if receipt.State != "released" {
			return nil
		}
	}
	if _, err := IncrementMonthlyLimitedInTransaction(ctx, db, workspaceID, metric, 1, at, decision); err != nil {
		return err
	}
	receipt = models.MonthlyUsageReservation{OperationKey: key, WorkspaceID: workspaceID, Metric: string(metric), PeriodStart: MonthStart(at), State: "held", CreatedAt: at, UpdatedAt: at}
	_, err = db.NewInsert().Model(&receipt).On("CONFLICT (operation_key) DO UPDATE").Set("period_start = EXCLUDED.period_start, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at").Exec(ctx)
	return err
}

// SettleMonthlyReservationInTransaction retains uncertain outcomes. Confirmed
// acceptance commits the receipt; a definite failure returns its held quota.
func SettleMonthlyReservationInTransaction(ctx context.Context, db bun.IDB, key, workspaceID string, accepted bool) error {
	var receipt models.MonthlyUsageReservation
	err := db.NewSelect().Model(&receipt).Where("operation_key = ? AND workspace_id = ?", key, workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if receipt.State != "held" {
		return nil
	}
	state := "committed"
	if !accepted {
		state = "released"
		result, err := db.NewUpdate().Model((*models.UsageCounter)(nil)).Set("value = value - 1, updated_at = ?", time.Now().UTC()).Where("workspace_id = ? AND metric = ? AND period_start = ? AND value > 0", workspaceID, receipt.Metric, receipt.PeriodStart).Exec(ctx)
		if err != nil {
			return err
		}
		if rows, _ := result.RowsAffected(); rows != 1 {
			return fmt.Errorf("usage reservation counter is unavailable")
		}
	}
	_, err = db.NewUpdate().Model(&receipt).Set("state = ?, updated_at = ?", state, time.Now().UTC()).WherePK().Exec(ctx)
	return err
}
