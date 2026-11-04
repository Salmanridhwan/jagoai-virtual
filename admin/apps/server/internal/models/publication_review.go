package models

import (
	"time"

	"github.com/uptrace/bun"
)

// PublicationReview keeps the submitted version immutable. A later edit changes
// the Publication epoch, never the evidence the reviewer originally saw.
type PublicationReview struct {
	bun.BaseModel    `bun:"table:publication_reviews"`
	ID               string    `bun:",pk" json:"id"`
	PublicationID    string    `bun:",notnull" json:"publication_id"`
	WorkspaceID      string    `bun:",notnull" json:"workspace_id"`
	RequestedBy      string    `bun:",notnull" json:"requested_by"`
	ReviewerID       string    `bun:",notnull" json:"reviewer_id"`
	Epoch            int       `bun:",notnull" json:"epoch"`
	IncludesSchedule bool      `bun:",notnull" json:"includes_schedule"`
	FingerprintsJSON string    `bun:",notnull" json:"-"`
	SnapshotJSON     string    `bun:",notnull" json:"-"`
	Note             string    `bun:",notnull" json:"note"`
	Decision         string    `bun:",notnull,default:''" json:"decision,omitempty"`
	Feedback         string    `bun:",notnull,default:''" json:"feedback,omitempty"`
	CreatedAt        time.Time `bun:",notnull" json:"created_at"`
	DecidedAt        time.Time `bun:",nullzero" json:"decided_at,omitempty"`
}
