package usage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

type Service struct {
	db                   *bun.DB
	providerCostPolicyMu sync.RWMutex
	providerCostPolicy   ProviderCostPolicy
}

func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

func MonthStart(t time.Time) time.Time {
	utc := t.UTC()
	return time.Date(utc.Year(), utc.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func (s *Service) IncrementMonthly(ctx context.Context, workspaceID string, metric entitlements.LimitKey, amount int64, at time.Time) (int64, error) {
	var value int64
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		var err error
		value, err = IncrementMonthlyInTransaction(ctx, tx, workspaceID, metric, amount, at)
		return err
	})
	return value, err
}

// IncrementMonthlyInTransaction lets durable imports commit their receipt and
// upload accounting together. The caller owns the transaction.
func IncrementMonthlyInTransaction(ctx context.Context, db bun.IDB, workspaceID string, metric entitlements.LimitKey, amount int64, at time.Time) (int64, error) {
	if amount <= 0 {
		return 0, fmt.Errorf("usage increment amount must be positive")
	}
	if workspaceID == "" {
		return 0, fmt.Errorf("workspace id is required")
	}
	if metric == "" {
		return 0, fmt.Errorf("usage metric is required")
	}

	now := time.Now().UTC()
	counter := models.UsageCounter{WorkspaceID: workspaceID, Metric: string(metric), PeriodStart: MonthStart(at), Value: amount, CreatedAt: now, UpdatedAt: now}
	var value int64
	err := db.NewInsert().Model(&counter).
		On("CONFLICT (workspace_id, metric, period_start) DO UPDATE").
		Set("value = usage_counter.value + EXCLUDED.value").
		Set("updated_at = EXCLUDED.updated_at").
		Returning("value").Scan(ctx, &value)
	return value, err
}

func (s *Service) CurrentMonthly(ctx context.Context, workspaceID string, metric entitlements.LimitKey, at time.Time) (int64, error) {
	var counter models.UsageCounter
	err := s.db.NewSelect().
		Model(&counter).
		Where("workspace_id = ?", workspaceID).
		Where("metric = ?", string(metric)).
		Where("period_start = ?", MonthStart(at)).
		Scan(ctx)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return counter.Value, nil
}

func (s *Service) SnapshotMonthly(ctx context.Context, workspaceID string, at time.Time) (map[entitlements.LimitKey]int64, error) {
	var counters []models.UsageCounter
	err := s.db.NewSelect().
		Model(&counters).
		Where("workspace_id = ?", workspaceID).
		Where("period_start = ?", MonthStart(at)).
		Scan(ctx)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[entitlements.LimitKey]int64, len(counters))
	for _, counter := range counters {
		snapshot[entitlements.LimitKey(counter.Metric)] = counter.Value
	}
	return snapshot, nil
}

func (s *Service) SnapshotOrganizationMonthly(ctx context.Context, organizationID string, at time.Time) (map[entitlements.LimitKey]int64, error) {
	var rows []struct {
		Metric string `bun:"metric"`
		Value  int64  `bun:"value"`
	}
	err := s.db.NewSelect().
		TableExpr("usage_counters AS uc").
		ColumnExpr("uc.metric").
		ColumnExpr("SUM(uc.value) AS value").
		Join("JOIN workspaces AS w ON w.id = uc.workspace_id").
		Where("w.organization_id = ?", organizationID).
		Where("uc.period_start = ?", MonthStart(at)).
		Group("uc.metric").
		Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[entitlements.LimitKey]int64, len(rows))
	for _, row := range rows {
		snapshot[entitlements.LimitKey(row.Metric)] = row.Value
	}
	return snapshot, nil
}

var ErrQuotaExceeded = errors.New("monthly usage limit exceeded")

// IncrementMonthlyLimitedInTransaction admits and accounts for usage in one
// conditional database write. The caller commits it with the owning mutation.
func IncrementMonthlyLimitedInTransaction(ctx context.Context, db bun.IDB, workspaceID string, metric entitlements.LimitKey, amount int64, at time.Time, decision entitlements.Decision) (int64, error) {
	if amount <= 0 || workspaceID == "" || metric == "" {
		return 0, fmt.Errorf("positive usage amount, workspace and metric are required")
	}
	if !decision.Allowed || (!decision.Unlimited && amount > decision.Limit) {
		return 0, ErrQuotaExceeded
	}
	if decision.Unlimited {
		return IncrementMonthlyInTransaction(ctx, db, workspaceID, metric, amount, at)
	}
	now := time.Now().UTC()
	counter := models.UsageCounter{WorkspaceID: workspaceID, Metric: string(metric), PeriodStart: MonthStart(at), Value: amount, CreatedAt: now, UpdatedAt: now}
	var value int64
	err := db.NewInsert().Model(&counter).
		On("CONFLICT (workspace_id, metric, period_start) DO UPDATE").
		Set("value = usage_counter.value + EXCLUDED.value").
		Set("updated_at = EXCLUDED.updated_at").
		Where("usage_counter.value <= ? - EXCLUDED.value", decision.Limit).
		Returning("value").Scan(ctx, &value)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrQuotaExceeded
	}
	return value, err
}
