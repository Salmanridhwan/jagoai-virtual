package notifications

import (
	"net/url"

	"github.com/openpost/backend/internal/models"
)

const TypePostReview = "post_review"

type PostReviewFacts struct {
	RecipientUserID, WorkspaceID, PublicationID, ReviewID, State string
}

func NewPostReviewOutcome(facts PostReviewFacts) (Outcome, error) {
	switch facts.State {
	case "pending", "approved", "changes_requested":
	default:
		return nil, ErrInvalidOutcome
	}
	return newOutcome(semanticOutcome{recipientID: facts.RecipientUserID, workspaceID: facts.WorkspaceID, topic: TypePostReview, eventID: facts.ReviewID + ":" + facts.State, payload: map[string]any{"publication_id": facts.PublicationID, "review_id": facts.ReviewID, "state": facts.State}})
}

func materializePostReview(value semanticOutcome) (createInput, error) {
	input := baseOutcomeInput(value)
	id, _ := value.payload["publication_id"].(string)
	state, _ := value.payload["state"].(string)
	input.Title = "Post ready for your review"
	input.Body = "Review the submitted version and approve it or request changes."
	if state == "approved" {
		input.Title = "Post approved"
		input.Body = "The client approved this version. You can now schedule or publish it."
	}
	if state == "changes_requested" {
		input.Title = "Client requested changes"
		input.Body = "Read the feedback and send a revised version for review."
	}
	input.Href = "/publications/" + url.PathEscape(id) + "?workspace_id=" + url.QueryEscape(value.workspaceID)
	input.Actions = []models.NotificationAction{{Label: "Review post", Href: input.Href, Kind: "primary"}}
	return input, nil
}
