package platform

import (
	"context"
	"time"

	"github.com/openpost/backend/internal/inboxactivity"
)

type AccountActivitySupport struct {
	Feed           string
	RequiredScopes []string
}

type AccountActivityRequest struct {
	Feed   string
	Cursor string
	Since  time.Time
}

type AccountActivityItem struct {
	Comment
	Kind       string
	Subject    inboxactivity.EngagementSubject
	ObservedAt time.Time
}

type AccountActivityPage struct {
	Items      []AccountActivityItem
	NextCursor string
}

// AccountActivityAdapter reads exactly one bounded page. Continuations are
// opaque provider tokens, never arbitrary URLs or raw response bodies.
type AccountActivityAdapter interface {
	AccountActivitySupport() []AccountActivitySupport
	ListAccountActivity(context.Context, string, string, AccountActivityRequest) (AccountActivityPage, error)
}

// ReviewAdapter owns a location's one replaceable owner reply. It never deletes
// customer reviews. Reads also reconcile an ambiguous write or moderation.
type ReviewAdapter interface {
	GetReview(context.Context, string, string, string) (AccountActivityItem, error)
	SetReviewReply(context.Context, string, string, string, string) (inboxactivity.ReviewReply, error)
	DeleteReviewReply(context.Context, string, string, string) error
}

// AccountActivityReplyAdapter preserves provider-specific context, including
// Mastodon visibility, when replying to a post outside OpenPost's inventory.
type AccountActivityReplyAdapter interface {
	ReplyToAccountActivity(context.Context, string, string, string, inboxactivity.EngagementSubject, string) (string, error)
}
