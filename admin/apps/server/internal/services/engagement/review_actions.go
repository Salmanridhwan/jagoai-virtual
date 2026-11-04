package engagement

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

var ErrReviewReplyBusy = errors.New("a reply operation is still in progress for this review; inspect its job before replacing it")

func validateReviewAction(item models.EngagementItem, action, message string) (string, error) {
	decodeEngagementSubject(&item)
	if !item.CanReply || !item.DeletedAt.IsZero() {
		return "", fmt.Errorf("this review cannot receive owner reply changes")
	}
	switch action {
	case "reply":
		if !utf8.ValidString(message) || strings.TrimSpace(message) == "" || len(message) > 4096 {
			return "", fmt.Errorf("review replies must contain between 1 and 4096 UTF-8 bytes")
		}
	case "delete_reply":
		if !item.CanDeleteReply {
			return "", fmt.Errorf("this review has no owner reply to remove")
		}
		if message != "" {
			return "", fmt.Errorf("removing an owner reply cannot include a message")
		}
	default:
		return "", fmt.Errorf("customer reviews cannot be moderated or deleted")
	}
	return message, nil
}

func requireReviewActionAvailable(ctx context.Context, db bun.IDB, itemID string) error {
	var operation models.EngagementReviewOperation
	err := db.NewSelect().Model(&operation).Where("item_id=?", itemID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if operation.State == "active" {
		return ErrReviewReplyBusy
	}
	return nil
}

type reviewActionResult struct {
	reply *inboxactivity.ReviewReply
	known bool
}

func (s *Service) performReviewAction(ctx context.Context, item models.EngagementItem, input engagementActionJob) (resultErr error) {
	defer func() {
		if resultErr != nil {
			resultErr = errors.Join(resultErr, s.releaseRejectedReviewOperation(ctx, item, input.ReviewJobID))
		}
	}()
	authority, reviews, err := s.reviewActionAuthority(ctx, item, input)
	if err != nil {
		return err
	}
	replay, err := s.reviewActionCompleted(ctx, item.ID, input.ReviewJobID)
	if err != nil || replay {
		return err
	}
	token, err := s.tokenSource.GetValidAccessToken(ctx, item.SocialAccountID)
	if err != nil {
		return err
	}
	fingerprint, err := providerwrite.Fingerprint("engagement-review-v1", map[string]string{"item_id": item.ID, "remote_id": item.RemoteID, "action": input.Action, "message": input.Message})
	if err != nil {
		return err
	}
	var result reviewActionResult
	_, writeErr := providerwrite.New(s.db).Execute(ctx, providerwrite.Input{
		OperationID: "engagement-review:" + input.ReviewJobID, JobID: input.ReviewJobID,
		WorkspaceID: item.WorkspaceID, SocialAccountID: item.SocialAccountID,
		TargetKey: engagementProviderKey(authority.Account), Provider: authority.Account.Platform,
		Operation: "review_" + input.Action, PayloadFingerprint: fingerprint,
	}, func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		return s.sendReviewAction(sendCtx, control, reviews, token, item, input, authority, &result)
	}, func(readCtx context.Context, reference string) (platform.PublishResult, error) {
		return reconcileReviewAction(readCtx, reviews, token, authority.Account.AccountID, reference, input, &result)
	})
	if writeErr != nil {
		return writeErr
	}

	if !result.known {
		// The durable fence may have accepted the write before a crash prevented
		// the local Inbox update. Read its current truth; never resend it.
		remote, err := reviews.GetReview(ctx, token, authority.Account.AccountID, item.RemoteID)
		if err != nil {
			return acceptedReviewContinuation(err)
		}
		if remote.Subject.Review == nil {
			return acceptedReviewContinuation(fmt.Errorf("review reply context is missing"))
		}
		result.reply, result.known = remote.Subject.Review.OwnerReply, true
	}
	if err := s.commitReviewReply(ctx, item, input.ReviewJobID, result.reply); err != nil {
		return acceptedReviewContinuation(err)
	}
	return nil
}

func (s *Service) sendReviewAction(ctx context.Context, control *providerwrite.Control, reviews platform.ReviewAdapter, token string, item models.EngagementItem, input engagementActionJob, authority activityAuthority, result *reviewActionResult) (platform.PublishResult, error) {
	if err := s.authorize(ctx, item.WorkspaceID, Actor{UserID: input.UserID}, workspaceaccess.LevelEdit); err != nil {
		return platform.PublishResult{}, err
	}
	if _, err := validateReviewAction(item, input.Action, input.Message); err != nil {
		return platform.PublishResult{}, err
	}
	current, err := s.loadActivityAuthority(ctx, s.db, item.SocialAccountID)
	if err != nil {
		return platform.PublishResult{}, err
	}
	if current.Account.OAuthGrantID != authority.Account.OAuthGrantID || !current.GrantConsentedAt.Equal(authority.GrantConsentedAt) || !current.FeatureDecidedAt.Equal(authority.FeatureDecidedAt) || current.Account.GrantedScopes != authority.Account.GrantedScopes {
		return platform.PublishResult{}, errActivityChanged
	}
	pending := reviewPendingResult(item.RemoteID)
	if err := control.Begin(pending); err != nil {
		return platform.PublishResult{}, err
	}
	if input.Action == "delete_reply" {
		err = reviews.DeleteReviewReply(ctx, token, authority.Account.AccountID, item.RemoteID)
		result.reply = nil
	} else {
		reply, writeErr := reviews.SetReviewReply(ctx, token, authority.Account.AccountID, item.RemoteID, input.Message)
		err, result.reply = writeErr, &reply
	}
	if err != nil {
		if reviewWriteDefinitelyRejected(err) {
			pending.SubmissionState, pending.RetrySafety = platform.PublishSubmissionRejected, platform.PublishRetryNever
		}
		return pending, err
	}
	result.known = true
	return platform.AcceptedPublishResult(item.RemoteID), nil
}

func reviewPendingResult(reference string) platform.PublishResult {
	return platform.PublishResult{ProviderReference: reference, ProviderState: "review_reply", SubmissionState: platform.PublishSubmissionPending, RetrySafety: platform.PublishRetryReconcileOnly, ReconcileAfter: time.Minute}
}

func reconcileReviewAction(ctx context.Context, reviews platform.ReviewAdapter, token, accountID, reference string, input engagementActionJob, result *reviewActionResult) (platform.PublishResult, error) {
	remote, err := reviews.GetReview(ctx, token, accountID, reference)
	if err != nil {
		return reviewPendingResult(reference), err
	}
	if remote.ID != reference || remote.Subject.Review == nil {
		return reviewPendingResult(reference), fmt.Errorf("review reconciliation identity changed")
	}
	reply := remote.Subject.Review.OwnerReply
	if (input.Action == "delete_reply" && reply == nil) || (input.Action == "reply" && reply != nil && reply.Text == input.Message) {
		result.reply, result.known = reply, true
		return platform.AcceptedPublishResult(reference), nil
	}
	return reviewPendingResult(reference), nil
}

func reviewWriteDefinitelyRejected(err error) bool {
	var failure *platform.HTTPError
	if !errors.As(err, &failure) {
		return false
	}
	switch failure.StatusCode {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity, http.StatusTooManyRequests:
		return true
	default:
		return false
	}
}

func (s *Service) commitReviewReply(ctx context.Context, item models.EngagementItem, jobID string, reply *inboxactivity.ReviewReply) error {
	return s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, item.WorkspaceID); err != nil {
			return err
		}
		if err := providerwrite.RequireCurrentJobExecution(ctx, tx, jobID); err != nil {
			return err
		}
		var operation models.EngagementReviewOperation
		if err := tx.NewSelect().Model(&operation).Where("item_id=?", item.ID).Scan(ctx); err != nil {
			return err
		}
		if operation.JobID != jobID {
			return ErrReviewReplyBusy
		}
		if err := tx.NewSelect().Model(&item).WherePK().Scan(ctx); err != nil {
			return err
		}
		decodeEngagementSubject(&item)
		if item.Subject == nil || item.Subject.Review == nil {
			return fmt.Errorf("review reply context is missing")
		}
		item.Subject.Review.OwnerReply = reply
		item.ReviewReplyCheckAt = time.Time{}
		if reply != nil && reply.State != "APPROVED" && reply.State != "REJECTED" {
			item.ReviewReplyCheckAt = s.now().Add(5 * time.Minute)
		}
		subject, err := json.Marshal(item.Subject)
		if err != nil {
			return err
		}
		_, err = tx.NewUpdate().Model(&item).Set("subject_json=?", string(subject)).Set("review_reply_check_at=?", nullableActivityTime(item.ReviewReplyCheckAt)).Set("review_reply_written_at=?", s.now()).Set("updated_at=?", s.now()).WherePK().Exec(ctx)
		if err != nil {
			return err
		}
		if err := appendEngagementChange(ctx, tx, item); err != nil {
			return err
		}
		_, err = tx.NewUpdate().Model(&operation).Set("state='complete'").Set("updated_at=?", s.now()).WherePK().Exec(ctx)
		return err
	})
}

func (s *Service) reviewActionAuthority(ctx context.Context, item models.EngagementItem, input engagementActionJob) (activityAuthority, platform.ReviewAdapter, error) {
	if input.ReviewJobID == "" {
		return activityAuthority{}, nil, fmt.Errorf("review reply job identity is missing")
	}
	if execution, ok := providerwrite.JobExecutionFromContext(ctx); !ok || execution.ID != input.ReviewJobID {
		return activityAuthority{}, nil, fmt.Errorf("review reply job identity changed")
	}
	if err := providerwrite.RequireCurrentJobExecution(ctx, s.db, input.ReviewJobID); err != nil {
		return activityAuthority{}, nil, err
	}
	authority, err := s.loadActivityAuthority(ctx, s.db, item.SocialAccountID)
	if err != nil {
		return activityAuthority{}, nil, err
	}
	adapter := s.activityAdapter(authority.Account)
	support, found := activityFeed(adapter, "reviews")
	if !found || len(platform.MissingAnalyticsScopes(authority.Account.GrantedScopes, support.RequiredScopes)) > 0 {
		return activityAuthority{}, nil, fmt.Errorf("review reply permission is missing")
	}
	reviews, ok := adapter.(platform.ReviewAdapter)
	if !ok || s.tokenSource == nil {
		return activityAuthority{}, nil, fmt.Errorf("review replies are unavailable")
	}

	return authority, reviews, nil
}

func (s *Service) reviewActionCompleted(ctx context.Context, itemID, jobID string) (bool, error) {
	var operation models.EngagementReviewOperation
	if err := s.db.NewSelect().Model(&operation).Where("item_id=?", itemID).Scan(ctx); err != nil {
		return false, err
	}
	if operation.JobID != jobID {
		// An older completed job may replay after a newer intentional replacement.
		// It must not restore the previous reply or enter another provider write.
		accepted, err := s.db.NewSelect().Model((*models.ProviderWriteAttempt)(nil)).Where("operation_id=? AND status=?", "engagement-review:"+jobID, providerwrite.StatusAccepted).Exists(ctx)
		if err != nil {
			return false, err
		}
		if accepted {
			return true, nil
		}
		return false, ErrReviewReplyBusy
	}
	if operation.State == "rejected" {
		return false, fmt.Errorf("this reply was rejected; start a new reply operation")
	}
	return false, nil
}

// Lock the job's current lease before releasing a definitively unsent/rejected
// operation. A stale worker cannot release another worker's active write.
func (s *Service) releaseRejectedReviewOperation(ctx context.Context, item models.EngagementItem, jobID string) error {
	execution, ok := providerwrite.JobExecutionFromContext(ctx)
	if !ok || execution.ID != jobID {
		return nil
	}
	recordCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return s.db.RunInTx(recordCtx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := organizationguard.LockWorkspace(ctx, tx, item.WorkspaceID); err != nil {
			return err
		}
		if err := providerwrite.RequireCurrentJobExecution(ctx, tx, jobID); err != nil {
			if errors.Is(err, providerwrite.ErrWriteInProgress) {
				return nil
			}
			return err
		}
		var attempt models.ProviderWriteAttempt
		err := tx.NewSelect().Model(&attempt).Where("operation_id=?", "engagement-review:"+jobID).Order("attempt_number DESC").Limit(1).Scan(ctx)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil && attempt.Status != providerwrite.StatusDefiniteFailure && attempt.Status != providerwrite.StatusPrepared {
			return nil
		}
		_, err = tx.NewUpdate().Model((*models.EngagementReviewOperation)(nil)).Set("state='rejected'").Set("updated_at=?", s.now()).Where("item_id=? AND job_id=? AND state='active'", item.ID, jobID).Exec(ctx)
		return err
	})
}

func acceptedReviewContinuation(cause error) error {
	return &providerwrite.OutcomeError{Kind: string(platform.PublishSubmissionPending), ProviderState: "review_reply", RetryAfter: time.Minute, Err: cause}
}

// Prerequisites can fail before Execute reloads an earlier provider receipt.
// Keep recovering accepted or uncertain sends, including while tokens refresh.
func (s *Service) continueReviewOperation(ctx context.Context, input engagementActionJob, failure error) error {
	jobID := input.ReviewJobID
	if _, pending := providerwrite.IsPending(failure); pending || errors.Is(failure, providerwrite.ErrReconciliationExpired) || errors.Is(failure, sql.ErrNoRows) || jobID == "" {
		return failure
	}
	recordCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	var attempt models.ProviderWriteAttempt
	err := s.db.NewSelect().Model(&attempt).Where("operation_id=?", "engagement-review:"+jobID).Order("attempt_number DESC").Limit(1).Scan(recordCtx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return acceptedReviewContinuation(errors.Join(failure, err))
	}
	if attempt.Status == providerwrite.StatusAccepted || (attempt.RetrySafety == string(platform.PublishRetryReconcileOnly) && attempt.ProviderReference != "") {
		return acceptedReviewContinuation(failure)
	}
	// An early dispatch failure can precede the inner release defer. Keep an
	// admitted, still-active intent recoverable even when no send was attempted.
	// Definitively rejected or unsent failures released by the action stay terminal.
	var operation models.EngagementReviewOperation
	err = s.db.NewSelect().Model(&operation).Where("item_id=?", input.ItemID).Where("job_id=?", jobID).Scan(recordCtx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return acceptedReviewContinuation(errors.Join(failure, err))
	}
	if err == nil && operation.State == "active" {
		return acceptedReviewContinuation(failure)
	}
	return failure
}
