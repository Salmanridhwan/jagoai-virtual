package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/config"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type PublicationReviewInput struct {
	PathID string `path:"id"`
	Body   struct {
		ExpectedRevision int    `json:"expected_revision" minimum:"1"`
		ReviewerID       string `json:"reviewer_id" minLength:"1"`
		Note             string `json:"note" maxLength:"4000"`
	}
}
type PublicationReviewDecisionInput struct {
	PathID   string `path:"id"`
	ReviewID string `path:"review_id"`
	Body     struct {
		ExpectedEpoch int    `json:"expected_epoch" minimum:"1"`
		Decision      string `json:"decision" enum:"approved,changes_requested"`
		Feedback      string `json:"feedback" maxLength:"4000"`
	}
}
type PublicationReviewResponse struct {
	models.PublicationReview
	Snapshot PublicationResponse `json:"snapshot"`
	Current  bool                `json:"current"`
}
type PublicationReviewOutput struct{ Body PublicationReviewResponse }
type PublicationReviewsOutput struct{ Body []PublicationReviewResponse }

func reviewResponse(review models.PublicationReview, post *models.Publication) (PublicationReviewResponse, error) {
	response := PublicationReviewResponse{PublicationReview: review, Current: post.ReviewID == review.ID && post.ReviewEpoch == review.Epoch}
	err := json.Unmarshal([]byte(review.SnapshotJSON), &response.Snapshot)
	return response, err
}

func (h *PublicationHandler) registerPublicationReviews(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "request-publication-review", Method: http.MethodPost, Path: "/publications/{id}/reviews", Summary: "Send this version to a client for required approval", Tags: []string{tagPublications}, MaxBodyBytes: 16384, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{403, 404, 409}}, h.requestPublicationReview)
	huma.Register(api, huma.Operation{OperationID: "decide-publication-review", Method: http.MethodPut, Path: "/publications/{id}/reviews/{review_id}", Summary: "Approve a submitted version or request changes", Tags: []string{tagPublications}, MaxBodyBytes: 16384, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{403, 404, 409}}, h.decidePublicationReview)
	huma.Register(api, huma.Operation{OperationID: "list-publication-reviews", Method: http.MethodGet, Path: "/publications/{id}/reviews", Summary: "Read the last 50 review requests and submitted versions", Tags: []string{tagPublications}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}}, h.listPublicationReviews)
}

func (h *PublicationHandler) requestPublicationReview(ctx context.Context, input *PublicationReviewInput) (*PublicationReviewOutput, error) {
	if !config.ClientReviewsEnabled() {
		return nil, huma.Error503ServiceUnavailable("client review admission is not enabled on this deployment")
	}
	userID := middleware.GetUserID(ctx)
	var response PublicationReviewResponse
	err := h.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		post, err := h.loadPublicationForMutationTx(ctx, tx, input.PathID)
		if err != nil {
			return err
		}
		decision, err := workspaceDecision(ctx, tx, post.WorkspaceID, userID, workspaceaccess.LevelEdit)
		if err != nil {
			return err
		}
		if !decision.Allowed {
			return huma.Error403Forbidden("workspace edit access required")
		}
		prior, err := replayPublicationReviewTx(ctx, tx, post, userID, input)
		if err != nil {
			return err
		}
		if prior != nil {
			response = *prior
			return nil
		}
		review, err := h.preparePublicationReviewTx(ctx, tx, post, userID, input)
		if err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(&review).Exec(ctx); err != nil {
			return err
		}
		post.ReviewID = review.ID
		post.ReviewEpoch = review.Epoch
		post.ReviewState = "pending"
		post.Revision++
		post.UpdatedAt = review.CreatedAt
		if _, err := tx.NewUpdate().Model(post).WherePK().Exec(ctx); err != nil {
			return err
		}
		if err := h.notifyPublicationReview(ctx, tx, review, review.ReviewerID, "pending"); err != nil {
			return err
		}
		response, err = reviewResponse(review, post)
		return err
	})
	if err != nil {
		return nil, publicationMutationHTTPError(err, "request post review")
	}
	return &PublicationReviewOutput{Body: response}, nil
}

func (h *PublicationHandler) decidePublicationReview(ctx context.Context, input *PublicationReviewDecisionInput) (*PublicationReviewOutput, error) {
	var response PublicationReviewResponse
	err := h.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		post, review, err := h.loadAssignedPublicationReviewTx(ctx, tx, input)
		if err != nil {
			return err
		}
		feedback := strings.TrimSpace(input.Body.Feedback)
		if review.Decision != "" {
			if review.Decision == input.Body.Decision && review.Feedback == feedback {
				response, err = reviewResponse(review, post)
				return err
			}
			return huma.Error409Conflict("this review already has a decision")
		}
		if post.ReviewState != "pending" {
			return huma.Error409Conflict("this post needs a new review")
		}
		if input.Body.Decision == "changes_requested" && feedback == "" {
			return huma.Error400BadRequest("describe the changes you need")
		}
		review.Decision = input.Body.Decision
		review.Feedback = feedback
		review.DecidedAt = time.Now().UTC()
		if _, err := tx.NewUpdate().Model(&review).Column("decision", "feedback", "decided_at").WherePK().Exec(ctx); err != nil {
			return err
		}
		post.ReviewState = review.Decision
		post.Revision++
		post.UpdatedAt = review.DecidedAt
		if _, err := tx.NewUpdate().Model(post).WherePK().Exec(ctx); err != nil {
			return err
		}
		if err := h.notifyPublicationReview(ctx, tx, review, review.RequestedBy, review.Decision); err != nil {
			return err
		}
		response, err = reviewResponse(review, post)
		return err
	})
	if err != nil {
		return nil, publicationMutationHTTPError(err, "decide post review")
	}
	return &PublicationReviewOutput{Body: response}, nil
}

type PublicationReviewsInput struct {
	PathID string `path:"id"`
}

func (h *PublicationHandler) listPublicationReviews(ctx context.Context, input *PublicationReviewsInput) (*PublicationReviewsOutput, error) {
	post, err := h.loadPublication(ctx, input.PathID, middleware.GetUserID(ctx))
	if err != nil {
		return nil, err
	}
	var reviews []models.PublicationReview
	if err := h.db.NewSelect().Model(&reviews).Where("publication_id = ?", post.ID).Order("created_at DESC").Limit(50).Scan(ctx); err != nil {
		return nil, err
	}
	response := make([]PublicationReviewResponse, 0, len(reviews))
	for _, review := range reviews {
		item, err := reviewResponse(review, post)
		if err != nil {
			return nil, err
		}
		response = append(response, item)
	}
	return &PublicationReviewsOutput{Body: response}, nil
}

// Invalidate after authored changes, in the same transaction that owns the
// Publication lock. Schedule changes matter only when timing was submitted.
func (h *PublicationHandler) invalidatePublicationReviewTx(ctx context.Context, tx bun.Tx, post *models.Publication, domains []string) (bool, error) {
	if post.ReviewID == "" || len(domains) == 0 {
		return false, nil
	}
	var review models.PublicationReview
	if err := tx.NewSelect().Model(&review).Where("id = ?", post.ReviewID).Scan(ctx); err != nil {
		return false, err
	}
	changed := false
	for _, domain := range domains {
		if domain != "schedule" || review.IncludesSchedule {
			changed = true
		}
	}
	if !changed {
		return false, nil
	}
	// Keep authored times visible for the next review; remove only delivery jobs.
	if err := h.deletePendingPrimaryPublicationJobsTx(ctx, tx, post.ID); err != nil {
		return false, err
	}
	if _, err := tx.NewUpdate().Model((*models.Rendition)(nil)).Set("status = ?", models.RenditionStatusDraft).Where("publication_id = ? AND status = ?", post.ID, models.RenditionStatusScheduled).Exec(ctx); err != nil {
		return false, err
	}
	post.ReviewEpoch++
	post.ReviewState = "needs_review"
	post.Status = models.PublicationStatusDraft
	post.ActualRunAt = time.Time{}
	_, err := tx.NewUpdate().Model(post).Column("review_epoch", "review_state", "status", "actual_run_at").WherePK().Exec(ctx)
	return true, err
}

func (h *PublicationHandler) notifyPublicationReview(ctx context.Context, tx bun.Tx, review models.PublicationReview, recipientID, state string) error {
	if h.notifications == nil {
		return nil
	}
	outcome, err := notifications.NewPostReviewOutcome(notifications.PostReviewFacts{RecipientUserID: recipientID, WorkspaceID: review.WorkspaceID, PublicationID: review.PublicationID, ReviewID: review.ID, State: state})
	if err != nil {
		return err
	}
	return h.notifications.RecordWithDB(ctx, tx, outcome)
}

func replayPublicationReviewTx(ctx context.Context, tx bun.Tx, post *models.Publication, userID string, input *PublicationReviewInput) (*PublicationReviewResponse, error) {
	// Replay a lost submission response only for this exact submitted
	// version, author, reviewer and note. A later edit cannot reuse it.
	if post.ReviewID != "" && post.Revision == input.Body.ExpectedRevision+1 && post.ReviewState == "pending" {
		var previous models.PublicationReview
		if err := tx.NewSelect().Model(&previous).Where("id = ?", post.ReviewID).Scan(ctx); err != nil {
			return nil, err
		}
		prior, err := reviewResponse(previous, post)
		if err != nil {
			return nil, err
		}
		if previous.RequestedBy == userID && previous.ReviewerID == strings.TrimSpace(input.Body.ReviewerID) && previous.Note == strings.TrimSpace(input.Body.Note) && prior.Snapshot.Revision == input.Body.ExpectedRevision && prior.Current {
			return &prior, nil
		}
	}
	return nil, nil
}

func (h *PublicationHandler) preparePublicationReviewTx(ctx context.Context, tx bun.Tx, post *models.Publication, userID string, input *PublicationReviewInput) (models.PublicationReview, error) {
	if post.Revision != input.Body.ExpectedRevision {
		return models.PublicationReview{}, h.publicationRevisionConflict(ctx, tx, post, input.Body.ExpectedRevision)
	}
	if post.Status != models.PublicationStatusDraft {
		return models.PublicationReview{}, huma.Error409Conflict("cancel the schedule before sending this post for review")
	}
	reviewer := strings.TrimSpace(input.Body.ReviewerID)
	valid, err := tx.NewSelect().Model((*models.WorkspaceMember)(nil)).Where("workspace_id = ? AND user_id = ? AND role = ? AND status = ?", post.WorkspaceID, reviewer, models.WorkspaceRoleClient, models.WorkspaceMemberStatusActive).Exists(ctx)
	if err != nil {
		return models.PublicationReview{}, err
	}
	if !valid {
		return models.PublicationReview{}, huma.Error400BadRequest("choose an active client in this workspace")
	}
	snapshot, err := h.loadPublicationRevisionResponseTx(ctx, tx, post)
	if err != nil {
		return models.PublicationReview{}, err
	}
	encoded, err := json.Marshal(snapshot.response)
	if err != nil {
		return models.PublicationReview{}, err
	}
	includesSchedule := !post.ScheduledAt.IsZero()
	for _, rendition := range snapshot.response.Renditions {
		includesSchedule = includesSchedule || rendition.ScheduleOverride != ""
	}
	fingerprints, err := publicationauth.ReviewFingerprints(ctx, tx, post.ID)
	if err != nil {
		return models.PublicationReview{}, err
	}
	review := models.PublicationReview{FingerprintsJSON: fingerprints, ID: uuid.NewString(), PublicationID: post.ID, WorkspaceID: post.WorkspaceID, RequestedBy: userID, ReviewerID: reviewer, Epoch: post.ReviewEpoch + 1, IncludesSchedule: includesSchedule, SnapshotJSON: string(encoded), Note: strings.TrimSpace(input.Body.Note), CreatedAt: time.Now().UTC()}
	return review, nil
}

func (h *PublicationHandler) loadAssignedPublicationReviewTx(ctx context.Context, tx bun.Tx, input *PublicationReviewDecisionInput) (*models.Publication, models.PublicationReview, error) {
	post, err := h.loadPublicationForMutationTx(ctx, tx, input.PathID)
	if err != nil {
		return nil, models.PublicationReview{}, err
	}
	userID := middleware.GetUserID(ctx)
	decision, err := workspaceDecision(ctx, tx, post.WorkspaceID, userID, workspaceaccess.LevelApprove)
	if err != nil {
		return nil, models.PublicationReview{}, err
	}
	if !decision.Allowed {
		return nil, models.PublicationReview{}, huma.Error403Forbidden("client approval access required")
	}
	if post.ReviewID != input.ReviewID || post.ReviewEpoch != input.Body.ExpectedEpoch {
		return nil, models.PublicationReview{}, huma.Error409Conflict("this post changed; ask the author to send a new review")
	}
	var review models.PublicationReview
	if err := tx.NewSelect().Model(&review).Where("id = ? AND publication_id = ?", input.ReviewID, post.ID).Scan(ctx); err != nil {
		return nil, models.PublicationReview{}, err
	}
	if review.ReviewerID != userID || decision.Role != models.WorkspaceRoleClient {
		return nil, models.PublicationReview{}, huma.Error403Forbidden("only the assigned client can decide this review")
	}
	return post, review, nil
}
