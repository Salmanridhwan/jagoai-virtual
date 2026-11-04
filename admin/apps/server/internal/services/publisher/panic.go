package publisher

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/openpost/backend/internal/diagnostics"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/uptrace/bun"
)

type renditionRecoveryError struct{ cause error }

func (e *renditionRecoveryError) Error() string {
	return "recovering interrupted publication: " + e.cause.Error()
}
func (e *renditionRecoveryError) Unwrap() error { return e.cause }

func (s *Service) recoverRenditionPanic(ctx context.Context, renditionID string, authorization *models.PublicationAuthorization, failure *diagnostics.PanicError) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	var outcome error = failure
	if authorization != nil {
		// A saved write must resume under this exact authorization. Accepted
		// results are projected locally; pending and unknown results go through
		// providerwrite, which prevents a fresh send across the durable fence.
		protected, err := s.db.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).
			Where("authorization_id = ? AND rendition_id = ?", authorization.ID, renditionID).
			Where("status IN (?)", bun.List([]string{providerwrite.StatusSending, providerwrite.StatusAccepted, providerwrite.StatusAmbiguous})).Exists(ctx)
		if err != nil || protected {
			outcome = &renditionRecoveryError{cause: errors.Join(failure, err)}
		}
	}
	var segments []models.RenditionSegment
	if err := s.db.NewSelect().Model(&segments).Where("rendition_id = ?", renditionID).
		Where("status != ?", models.RenditionStatusPublished).Scan(ctx); err != nil {
		log.Printf("[Publisher] Failed to load interrupted rendition segments: %v", err)
		return outcome
	}
	for i := range segments {
		_ = s.persistRenditionSegmentOutcome(ctx, &segments[i], outcome)
	}
	return outcome
}
