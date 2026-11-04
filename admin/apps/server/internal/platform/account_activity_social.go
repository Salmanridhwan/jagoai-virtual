package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/openpost/backend/internal/inboxactivity"
)

func (b *BlueskyAdapter) AccountActivitySupport() []AccountActivitySupport {
	return []AccountActivitySupport{{Feed: "mentions"}}
}

func (b *BlueskyAdapter) ListAccountActivity(ctx context.Context, token, accountID string, input AccountActivityRequest) (AccountActivityPage, error) {
	if err := validateActivityRequest(input, "mentions"); err != nil {
		return AccountActivityPage{}, err
	}
	query := url.Values{"reasons": {"mention"}, "limit": {"50"}}
	if input.Cursor != "" {
		query.Set("cursor", input.Cursor)
	}
	data, err := b.doRequest(ctx, http.MethodGet, b.pdsURL+"/xrpc/app.bsky.notification.listNotifications?"+query.Encode(), nil, bearerHeaders(token))
	if err != nil {
		return AccountActivityPage{}, err
	}
	var response struct {
		Cursor        string `json:"cursor"`
		Notifications []struct {
			URI       string                                            `json:"uri"`
			CID       string                                            `json:"cid"`
			Reason    string                                            `json:"reason"`
			IndexedAt time.Time                                         `json:"indexedAt"`
			Author    struct{ DID, Handle, DisplayName, Avatar string } `json:"author"`
			Record    struct {
				Text      string `json:"text"`
				CreatedAt string `json:"createdAt"`
				Reply     *struct {
					Root inboxactivity.PostReference `json:"root"`
				} `json:"reply"`
			} `json:"record"`
		} `json:"notifications"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return AccountActivityPage{}, fmt.Errorf("decode Bluesky mentions: %w", err)
	}
	if response.Notifications == nil || len(response.Notifications) > 50 {
		return AccountActivityPage{}, fmt.Errorf("invalid Bluesky mention page")
	}
	page := AccountActivityPage{NextCursor: response.Cursor}
	for _, notification := range response.Notifications {
		if notification.Reason != "mention" || notification.URI == "" || notification.CID == "" || notification.Author.DID == accountID {
			continue
		}
		parent := inboxactivity.PostReference{URI: notification.URI, CID: notification.CID}
		root := parent
		if notification.Record.Reply != nil {
			root = notification.Record.Reply.Root
		}
		// Match the existing comment collector's native reply reference, so a
		// mention in an owned post remains one Inbox item with the same read state.
		id, _ := json.Marshal(map[string]any{"uri": parent.URI, "cid": parent.CID, "_root": map[string]string{"uri": root.URI, "cid": root.CID}})
		page.Items = append(page.Items, AccountActivityItem{
			Kind: "mention", ObservedAt: notification.IndexedAt,
			Comment: Comment{ID: string(id), ConversationID: root.URI,
				AuthorID: notification.Author.DID, AuthorName: notification.Author.DisplayName,
				AuthorHandle: prefixHandle(notification.Author.Handle), AuthorAvatarURL: notification.Author.Avatar,
				Text: notification.Record.Text, CreatedAt: notification.Record.CreatedAt, CanReply: true},
			Subject: inboxactivity.EngagementSubject{Kind: "post", RemoteID: parent.URI,
				URL: DeterministicContentURL("bluesky", notification.Author.DID, notification.Author.Handle, "", string(id), ""), Root: &root, Parent: &parent},
		})
	}
	return page, validateActivityCursor(page.NextCursor)
}

func (m *MastodonAdapter) AccountActivitySupport() []AccountActivitySupport {
	return []AccountActivitySupport{{Feed: "mentions", RequiredScopes: []string{"read:notifications"}}}
}

func (m *MastodonAdapter) ListAccountActivity(ctx context.Context, token, accountID string, input AccountActivityRequest) (AccountActivityPage, error) {
	if err := validateActivityRequest(input, "mentions"); err != nil {
		return AccountActivityPage{}, err
	}
	query := url.Values{"types[]": {"mention"}, "limit": {"40"}}
	if input.Cursor != "" {
		query.Set("max_id", input.Cursor)
	}
	endpoint := strings.TrimRight(m.compat.instanceURL, "/") + "/api/v1/notifications?" + query.Encode()
	data, headers, err := activityPageRequest(ctx, endpoint, token)
	if err != nil {
		return AccountActivityPage{}, err
	}
	var notifications []struct {
		Type      string                 `json:"type"`
		CreatedAt time.Time              `json:"created_at"`
		Status    *mastodonMessageStatus `json:"status"`
	}
	if err := json.Unmarshal(data, &notifications); err != nil {
		return AccountActivityPage{}, fmt.Errorf("decode Mastodon mentions: %w", err)
	}
	if notifications == nil || len(notifications) > 40 {
		return AccountActivityPage{}, fmt.Errorf("invalid Mastodon mention page")
	}
	next, err := activityLinkCursor(endpoint, headers.Get("Link"))
	if err != nil {
		return AccountActivityPage{}, err
	}
	page := AccountActivityPage{NextCursor: next}
	for _, notification := range notifications {
		status := notification.Status
		if !isIncomingMastodonMention(notification.Type, status, accountID) {
			continue
		}
		comment := mastodonStatusComment(*status, accountID)
		comment.CanReply = mastodonMentionReplyVisibility(status.Visibility)
		comment.ConversationID = status.InReplyToID
		if comment.ConversationID == "" {
			comment.ConversationID = status.ID
		}
		page.Items = append(page.Items, AccountActivityItem{Kind: "mention", ObservedAt: notification.CreatedAt, Comment: comment,
			Subject: inboxactivity.EngagementSubject{Kind: "post", RemoteID: status.ID, URL: status.URL, Visibility: status.Visibility}})
	}
	return page, nil
}

func (m *MastodonAdapter) ReplyToAccountActivity(ctx context.Context, token, accountID, remoteID string, subject inboxactivity.EngagementSubject, message string) (string, error) {
	if subject.Kind != "post" || subject.RemoteID != remoteID || !mastodonMentionReplyVisibility(subject.Visibility) {
		return "", fmt.Errorf("unsupported Mastodon mention reply context")
	}
	result, err := m.Publish(ctx, token, accountID, &PublishRequest{Content: message, ReplyToID: remoteID, Settings: map[string]any{"visibility": subject.Visibility}})
	return result.ExternalID, err
}

func validateActivityRequest(input AccountActivityRequest, feed string) error {
	if input.Feed != feed {
		return fmt.Errorf("unsupported account activity feed")
	}
	return validateActivityCursor(input.Cursor)
}

func validateActivityCursor(cursor string) error {
	if len(cursor) > 4096 || strings.ContainsAny(cursor, "\x00\r\n") {
		return fmt.Errorf("invalid account activity cursor")
	}
	return nil
}

func activityPageRequest(ctx context.Context, endpoint, token string) ([]byte, http.Header, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, nil, err
	}
	request.Header.Set(headerAuthorization, bearerPrefix+token)
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, nil, sanitizeTransportError(err)
	}
	defer response.Body.Close()
	body, err := readProviderBody(response)
	if err != nil {
		return nil, nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, nil, NewHTTPError(response.StatusCode, response.Header, body)
	}
	return body, response.Header, nil
}

func activityLinkCursor(endpoint, links string) (string, error) {
	base, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	for _, link := range strings.Split(links, ",") {
		target, parameters, ok := strings.Cut(link, ";")
		if !ok || !strings.Contains(parameters, `rel="next"`) {
			continue
		}
		remote, err := url.Parse(strings.Trim(strings.TrimSpace(target), "<>"))
		if err != nil || remote.Scheme != base.Scheme || !strings.EqualFold(remote.Host, base.Host) || remote.Path != base.Path || remote.User != nil {
			return "", fmt.Errorf("invalid account activity continuation")
		}
		cursor := remote.Query().Get("max_id")
		if cursor == "" {
			return "", fmt.Errorf("missing account activity continuation")
		}
		return cursor, validateActivityCursor(cursor)
	}
	return "", nil
}

func isIncomingMastodonMention(kind string, status *mastodonMessageStatus, accountID string) bool {
	return kind == "mention" && status != nil && status.ID != "" && status.Visibility != "direct" && status.Account.ID != accountID
}
func mastodonMentionReplyVisibility(visibility string) bool {
	return visibility == "public" || visibility == "unlisted" || visibility == "private"
}

func (b *BlueskyAdapter) ReplyToAccountActivity(ctx context.Context, token, accountID, remoteID string, subject inboxactivity.EngagementSubject, message string) (string, error) {
	if subject.Kind != "post" || subject.Root == nil || subject.Parent == nil || subject.Parent.URI != subject.RemoteID || subject.Root.URI == "" || subject.Root.CID == "" || subject.Parent.CID == "" || inboxactivity.NativeIdentity("bluesky", remoteID) != subject.RemoteID {
		return "", fmt.Errorf("bluesky mention reply context is missing")
	}
	reference, err := json.Marshal(map[string]any{"uri": subject.Parent.URI, "cid": subject.Parent.CID, "_root": map[string]string{"uri": subject.Root.URI, "cid": subject.Root.CID}})
	if err != nil {
		return "", err
	}
	return b.ReplyToComment(ctx, token, accountID, string(reference), message)
}
