package oauth2messaging

import (
	"time"

	"github.com/uptrace/bun"
)

type grant struct {
	bun.BaseModel         `bun:"table:x_messaging_grants"`
	SocialAccountID       string `bun:",pk"`
	WorkspaceID           string
	RemoteUserID          string
	ClientID              string
	AccessTokenEncrypted  []byte
	RefreshTokenEncrypted []byte
	Scopes                string
	ExpiresAt             time.Time
	RefreshLeaseUntil     time.Time `bun:",nullzero"`
	Invalid               bool
	UpdatedAt             time.Time
}
type authRequest struct {
	bun.BaseModel     `bun:"table:x_messaging_auth_requests"`
	State             string `bun:",pk"`
	UserID            string
	WorkspaceID       string
	SocialAccountID   string
	ClientID          string
	VerifierEncrypted []byte
	ExpiresAt         time.Time
}
type subscription struct {
	LastStopAttemptAt    time.Time `bun:",nullzero"`
	bun.BaseModel        `bun:"table:x_messaging_subscriptions"`
	ID                   string `bun:",pk"`
	SocialAccountID      string
	WorkspaceID          string
	RemoteUserID         string
	RemoteSubscriptionID string
	EventType            string
	EventLimit           int
	Received             int
	State                string
	ExpiresAt            time.Time
	CreatedAt            time.Time
}
type receipt struct {
	Attempts         int
	NextAttemptAt    time.Time `bun:",nullzero"`
	bun.BaseModel    `bun:"table:x_messaging_receipts"`
	EventUUID        string `bun:",pk"`
	SubscriptionID   string
	SocialAccountID  string
	PayloadEncrypted []byte
	CostOperationKey string
	Processed        bool
	CreatedAt        time.Time
}
