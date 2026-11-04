package handlers

import (
	"context"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/uptrace/bun"
)

// Canonical queue admission reserves monthly usage atomically with the job.
func (h *PublicationHandler) queueScheduledPublicationTx(ctx context.Context, tx bun.Tx, publicationID string, expectedRevision int, intent providerreadiness.ExecutionIntent) (publicationEnqueueResult, error) {
	return h.queuePublicationWithRunAtTx(ctx, tx, publicationID, expectedRevision, publicationauth.PolicyScheduled, intent, func(current *models.Publication, now time.Time) (time.Time, error) {
		if current.ScheduledAt.IsZero() {
			return time.Time{}, errPublicationScheduleRequired
		}
		if err := validateFuturePublicationSchedule(current.ScheduledAt, now); err != nil {
			return time.Time{}, err
		}
		return current.ScheduledAt, nil
	})
}
