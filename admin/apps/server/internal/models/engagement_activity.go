package models

import (
	"time"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/uptrace/bun"
)

type EngagementSubject = inboxactivity.EngagementSubject

type EngagementReviewOperation struct {
	bun.BaseModel `bun:"table:engagement_review_operations"`
	ItemID        string    `bun:"item_id,pk"`
	JobID         string    `bun:"job_id,notnull"`
	State         string    `bun:",notnull"`
	UpdatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp"`
}

// EngagementAccountSyncState keeps interrupted pages separate from completed
// feed coverage. Generation and feature/grant facts fence stale workers.
type EngagementAccountSyncState struct {
	bun.BaseModel    `bun:"table:engagement_account_sync_states"`
	SocialAccountID  string    `bun:"social_account_id,pk" json:"social_account_id"`
	Feed             string    `bun:"feed,pk" json:"feed"`
	WorkspaceID      string    `bun:"workspace_id,notnull" json:"workspace_id"`
	Platform         string    `bun:",notnull" json:"platform"`
	Generation       string    `bun:",notnull" json:"-"`
	GrantID          string    `bun:"grant_id,notnull,default:''" json:"-"`
	GrantConsentedAt time.Time `bun:"grant_consented_at,nullzero" json:"-"`
	FeatureDecidedAt time.Time `bun:"feature_decided_at,nullzero" json:"-"`
	Cursor           string    `bun:",notnull,default:''" json:"-"`
	CycleStartedAt   time.Time `bun:"cycle_started_at,nullzero" json:"-"`
	Watermark        time.Time `bun:",nullzero" json:"-"`
	PendingWatermark time.Time `bun:"pending_watermark,nullzero" json:"-"`
	Status           string    `bun:",notnull,default:'pending'" json:"status"`
	ErrorCode        string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorMessage     string    `bun:"error_message,notnull,default:''" json:"error_message"`
	LastAttemptedAt  time.Time `bun:"last_attempted_at,nullzero" json:"last_attempted_at,omitempty,omitzero"`
	LastSuccessAt    time.Time `bun:"last_success_at,nullzero" json:"last_success_at,omitempty,omitzero"`
	NextSyncAt       time.Time `bun:"next_sync_at,nullzero" json:"next_sync_at,omitempty,omitzero"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"-"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"-"`
}
