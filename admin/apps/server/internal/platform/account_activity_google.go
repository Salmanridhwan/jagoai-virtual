package platform

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/openpost/backend/internal/inboxactivity"
)

var googleBusinessReviewResource = regexp.MustCompile(`^accounts/[a-zA-Z0-9_-]+/locations/[a-zA-Z0-9_-]+/reviews/[a-zA-Z0-9_-]+$`)

type googleBusinessReviewReply struct {
	Comment          string    `json:"comment"`
	UpdateTime       time.Time `json:"updateTime"`
	ReviewReplyState string    `json:"reviewReplyState"`
	PolicyViolation  string    `json:"policyViolation"`
}

type googleBusinessReview struct {
	Name           string    `json:"name"`
	ReviewID       string    `json:"reviewId"`
	Comment        string    `json:"comment"`
	StarRating     string    `json:"starRating"`
	CreateTime     string    `json:"createTime"`
	UpdateTime     time.Time `json:"updateTime"`
	ReviewReplyURL string    `json:"reviewReplyUrl"`
	Reviewer       struct {
		DisplayName     string `json:"displayName"`
		ProfilePhotoURL string `json:"profilePhotoUrl"`
		IsAnonymous     bool   `json:"isAnonymous"`
	} `json:"reviewer"`
	ReviewReply *googleBusinessReviewReply `json:"reviewReply"`
}

func (g *GoogleBusinessAdapter) AccountActivitySupport() []AccountActivitySupport {
	return []AccountActivitySupport{{Feed: "reviews", RequiredScopes: []string{"https://www.googleapis.com/auth/business.manage"}}}
}

func (g *GoogleBusinessAdapter) ListAccountActivity(ctx context.Context, token, location string, input AccountActivityRequest) (AccountActivityPage, error) {
	if err := validateActivityRequest(input, "reviews"); err != nil {
		return AccountActivityPage{}, err
	}
	if !googleBusinessReviewResource.MatchString(location + "/reviews/example") {
		return AccountActivityPage{}, fmt.Errorf("invalid Google Business location")
	}
	query := url.Values{"pageSize": {"50"}, "orderBy": {"updateTime desc"}}
	if input.Cursor != "" {
		query.Set("pageToken", input.Cursor)
	}
	response, err := DoBearerJSON[struct {
		Reviews       []googleBusinessReview `json:"reviews"`
		NextPageToken string                 `json:"nextPageToken"`
	}](ctx, http.MethodGet, googleBusinessPostsBaseURL+"/"+location+"/reviews?"+query.Encode(), token, nil, "Google Business reviews")
	if err != nil {
		return AccountActivityPage{}, err
	}
	if response == nil || len(response.Reviews) > 50 {
		return AccountActivityPage{}, fmt.Errorf("invalid Google Business review page")
	}
	page := AccountActivityPage{NextCursor: response.NextPageToken}
	for _, review := range response.Reviews {
		if review.Name == "" {
			review.Name = location + "/reviews/" + review.ReviewID
		}
		if !googleBusinessReviewResource.MatchString(review.Name) || !strings.HasPrefix(review.Name, location+"/reviews/") {
			return AccountActivityPage{}, fmt.Errorf("google business returned a review outside the selected location")
		}
		page.Items = append(page.Items, normalizeGoogleBusinessReview(review))
	}
	return page, validateActivityCursor(page.NextCursor)
}

func normalizeGoogleBusinessReview(review googleBusinessReview) AccountActivityItem {
	context := &inboxactivity.ReviewContext{Anonymous: review.Reviewer.IsAnonymous}
	for index, rating := range []string{"ONE", "TWO", "THREE", "FOUR", "FIVE"} {
		if review.StarRating == rating {
			stars := index + 1
			context.Stars = &stars
		}
	}
	if review.ReviewReply != nil {
		reply := normalizeGoogleBusinessReply(*review.ReviewReply)
		context.OwnerReply = &reply
	}
	author, avatar := review.Reviewer.DisplayName, review.Reviewer.ProfilePhotoURL
	if context.Anonymous {
		author, avatar = "", ""
	}
	return AccountActivityItem{Kind: "review", ObservedAt: review.UpdateTime,
		Comment: Comment{ID: review.Name, ConversationID: review.Name, AuthorName: author, AuthorAvatarURL: avatar,
			Text: review.Comment, CreatedAt: review.CreateTime, UpdatedAt: review.UpdateTime.Format(time.RFC3339Nano), CanReply: true},
		Subject: inboxactivity.EngagementSubject{Kind: "review", RemoteID: review.Name, URL: review.ReviewReplyURL, Review: context},
	}
}

func normalizeGoogleBusinessReply(reply googleBusinessReviewReply) inboxactivity.ReviewReply {
	return inboxactivity.ReviewReply{Text: reply.Comment, State: reply.ReviewReplyState, PolicyViolation: reply.PolicyViolation, UpdatedAt: reply.UpdateTime}
}

func (g *GoogleBusinessAdapter) GetReview(ctx context.Context, token, location, name string) (AccountActivityItem, error) {
	if !googleBusinessReviewResource.MatchString(location+"/reviews/example") || !googleBusinessReviewResource.MatchString(name) || !strings.HasPrefix(name, location+"/reviews/") {
		return AccountActivityItem{}, fmt.Errorf("invalid Google Business review resource")
	}
	review, err := DoBearerJSON[googleBusinessReview](ctx, http.MethodGet, googleBusinessPostsBaseURL+"/"+name, token, nil, "Google Business review")
	if err != nil {
		return AccountActivityItem{}, err
	}
	if review == nil || (review.Name != "" && review.Name != name) {
		return AccountActivityItem{}, fmt.Errorf("google business returned a mismatched review")
	}
	review.Name = name
	return normalizeGoogleBusinessReview(*review), nil
}

func (g *GoogleBusinessAdapter) SetReviewReply(ctx context.Context, token, location, name, text string) (inboxactivity.ReviewReply, error) {
	if !googleBusinessReviewResource.MatchString(location+"/reviews/example") || !googleBusinessReviewResource.MatchString(name) || !strings.HasPrefix(name, location+"/reviews/") {
		return inboxactivity.ReviewReply{}, fmt.Errorf("invalid Google Business review resource")
	}
	if !utf8.ValidString(text) || strings.TrimSpace(text) == "" || len(text) > 4096 {
		return inboxactivity.ReviewReply{}, fmt.Errorf("review replies must contain between 1 and 4096 UTF-8 bytes")
	}
	reply, err := DoBearerJSON[googleBusinessReviewReply](ctx, http.MethodPut, googleBusinessPostsBaseURL+"/"+name+"/reply", token, map[string]string{"comment": text}, "Google Business review reply")
	if err != nil {
		return inboxactivity.ReviewReply{}, err
	}
	if reply == nil {
		return inboxactivity.ReviewReply{}, fmt.Errorf("google business returned no reply receipt")
	}
	return normalizeGoogleBusinessReply(*reply), nil
}

func (g *GoogleBusinessAdapter) DeleteReviewReply(ctx context.Context, token, location, name string) error {
	if !googleBusinessReviewResource.MatchString(location+"/reviews/example") || !googleBusinessReviewResource.MatchString(name) || !strings.HasPrefix(name, location+"/reviews/") {
		return fmt.Errorf("invalid Google Business review resource")
	}
	_, err := DoRequest(ctx, http.MethodDelete, googleBusinessPostsBaseURL+"/"+name+"/reply", nil, bearerHeaders(token))
	return err
}
