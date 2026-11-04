package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/openpost/backend/internal/posttext"
)

// MentionLookupAdapter returns provider-scoped identities, never a cross-network match.
type MentionLookupAdapter interface {
	LookupMentions(context.Context, string, string) ([]MentionCandidate, error)
}

// MentionTargetValidator checks mutable identities before a multi-part write begins.
type MentionTargetValidator interface {
	ValidateMentionTargets(context.Context, string, *PublishRequest) error
}

type MentionCandidate struct {
	Label  string                 `json:"label" doc:"Exact visible text inserted into the post"`
	Detail string                 `json:"detail" doc:"Provider account address or company vanity name"`
	Target posttext.MentionTarget `json:"target"`
}

func (b *BlueskyAdapter) LookupMentions(ctx context.Context, token, query string) ([]MentionCandidate, error) {
	data, err := b.doRequest(ctx, http.MethodGet, b.pdsURL+"/xrpc/app.bsky.actor.searchActors?"+url.Values{"q": {strings.TrimPrefix(query, "@")}, "limit": {"20"}}.Encode(), nil, map[string]string{headerAuthorization: bearerPrefix + token})
	if err != nil {
		return nil, err
	}
	var page struct {
		Actors []struct {
			DID         string `json:"did"`
			Handle      string `json:"handle"`
			DisplayName string `json:"displayName"`
		} `json:"actors"`
	}
	if err := json.Unmarshal(data, &page); err != nil {
		return nil, fmt.Errorf("decoding mention candidates: %w", err)
	}
	result := []MentionCandidate{}
	for _, actor := range page.Actors {
		if !blueskyDIDPattern.MatchString(actor.DID) || actor.Handle == "" {
			continue
		}
		result = append(result, MentionCandidate{Label: "@" + actor.Handle, Detail: actor.DisplayName, Target: posttext.MentionTarget{Provider: "bluesky", Kind: "person", ID: actor.DID, Handle: actor.Handle}})
		if len(result) == 20 {
			break
		}
	}
	return result, nil
}

type mastodonMentionAccount struct {
	ID          string `json:"id"`
	Acct        string `json:"acct"`
	DisplayName string `json:"display_name"`
}

func mastodonMentionHandle(account mastodonMentionAccount, instance string) string {
	address := strings.TrimPrefix(account.Acct, "@")
	if !strings.Contains(address, "@") {
		origin, _ := url.Parse(instance)
		if origin == nil {
			return ""
		}
		address += "@" + origin.Hostname()
	}
	return address
}
func (m *MastodonAdapter) LookupMentions(ctx context.Context, token, query string) ([]MentionCandidate, error) {
	endpoint := strings.TrimRight(m.compat.instanceURL, "/") + "/api/v1/accounts/search?" + url.Values{"q": {strings.TrimPrefix(query, "@")}, "limit": {"20"}, "resolve": {"true"}}.Encode()
	data, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{headerAuthorization: bearerPrefix + token})
	if err != nil {
		return nil, err
	}
	var accounts []mastodonMentionAccount
	if err := json.Unmarshal(data, &accounts); err != nil {
		return nil, fmt.Errorf("decoding mention candidates: %w", err)
	}
	result := []MentionCandidate{}
	for _, account := range accounts {
		handle := mastodonMentionHandle(account, m.compat.instanceURL)
		target := posttext.MentionTarget{Provider: "mastodon", Kind: "person", ID: account.ID, Authority: posttext.Authority(m.compat.instanceURL), Handle: handle}
		label := "@" + handle
		metadata := &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 0, End: len(label), Text: label, Target: target}}}
		if posttext.Validate(label, metadata) != nil {
			continue
		}
		result = append(result, MentionCandidate{Label: label, Detail: account.DisplayName, Target: target})
		if len(result) == 20 {
			break
		}
	}
	return result, nil
}

var linkedInVanityName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,99}$`)

func (l *LinkedInAdapter) LookupMentions(ctx context.Context, token, query string) ([]MentionCandidate, error) {
	query = strings.TrimPrefix(strings.TrimSpace(query), "@")
	if !linkedInVanityName.MatchString(query) {
		return []MentionCandidate{}, nil
	}
	endpoint := "https://api.linkedin.com/rest/organizations?" + url.Values{"q": {"vanityName"}, "vanityName": {query}}.Encode()
	data, err := DoRequest(ctx, http.MethodGet, endpoint, nil, linkedinHeaders(token, linkedInAPIVersion()))
	if err != nil {
		return nil, err
	}
	var page struct {
		Elements []struct {
			ID            json.Number `json:"id"`
			LocalizedName string      `json:"localizedName"`
			VanityName    string      `json:"vanityName"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(data, &page); err != nil {
		return nil, fmt.Errorf("decoding company mention: %w", err)
	}
	result := []MentionCandidate{}
	for _, company := range page.Elements {
		if !strings.EqualFold(company.VanityName, query) || company.LocalizedName == "" {
			continue
		}
		target := posttext.MentionTarget{Provider: "linkedin", Kind: "page", ID: "urn:li:organization:" + company.ID.String(), Handle: company.VanityName}
		mention := &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 0, End: len(company.LocalizedName), Text: company.LocalizedName, Target: target}}}
		if posttext.Validate(company.LocalizedName, mention) != nil {
			continue
		}
		result = append(result, MentionCandidate{Label: company.LocalizedName, Detail: company.VanityName, Target: target})
	}
	return result, nil
}

// Mastodon addresses are mutable. Verify the selected local account identity
// still owns that address before crossing the provider-write fence.
func (m *MastodonAdapter) ValidateMentionTargets(ctx context.Context, token string, req *PublishRequest) error {
	projection, err := posttext.ReadProjection(req.Content, "mastodon", m.compat.instanceURL, req.Settings)
	if err != nil || projection == nil {
		return err
	}
	checked := map[string]mastodonMentionAccount{}
	for _, span := range projection.Spans {
		account, found := checked[span.Target.ID]
		if !found {
			data, err := DoRequest(ctx, http.MethodGet, strings.TrimRight(m.compat.instanceURL, "/")+"/api/v1/accounts/"+url.PathEscape(span.Target.ID), nil, map[string]string{headerAuthorization: bearerPrefix + token})
			if err != nil {
				return err
			}
			if json.Unmarshal(data, &account) != nil {
				return fmt.Errorf("%w: invalid mention account", posttext.ErrInvalid)
			}
			checked[span.Target.ID] = account
		}
		if account.ID != span.Target.ID || mastodonMentionHandle(account, m.compat.instanceURL) != span.Target.Handle {
			return fmt.Errorf("%w: selected mention changed; choose the account again", posttext.ErrInvalid)
		}
	}
	return nil
}
