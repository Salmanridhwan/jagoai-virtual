package models

import (
	"time"

	"github.com/uptrace/bun"
)

// MonthlyUsageReservation keeps one logical provider write charged across
// process restarts, reconciliation and safe retries. Uncertain sends stay held.
type MonthlyUsageReservation struct {
	bun.BaseModel `bun:"table:monthly_usage_reservations"`
	OperationKey  string `bun:",pk"`
	WorkspaceID   string
	Metric        string
	PeriodStart   time.Time
	State         string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}
