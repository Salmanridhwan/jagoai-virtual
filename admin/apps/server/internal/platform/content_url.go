package platform

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

var (
	safeContentID  = regexp.MustCompile(`^[A-Za-z0-9._~:@-]+$`)
	numericContent = regexp.MustCompile(`^[0-9]+$`)
)

// DeterministicContentURL returns a public post URL when a provider's stored
// publish result contains everything needed to build one without another API
// request. Providers with opaque IDs use ContentURLResolver instead.
func DeterministicContentURL(provider, _ string, username, instanceURL, externalID string, outputProfile ...string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	username = strings.TrimPrefix(strings.TrimSpace(username), "@")
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return ""
	}
	if IsSafeContentURL(externalID) {
		return externalID
	}

	switch provider {
	case "x":
		return xContentURL(externalID)
	case "mastodon", "pixelfed":
		return mastodonContentURL(username, instanceURL, externalID)
	case "bluesky":
		return blueskyContentURL(externalID)
	case "linkedin":
		return linkedinContentURL(externalID)
	case "pinterest":
		return pinterestPinURL(externalID)
	case "tiktok":
		profile := ""
		if len(outputProfile) > 0 {
			profile = outputProfile[0]
		}
		return tiktokContentURL(username, externalID, profile)
	case "youtube":
		return youtubeContentURL(externalID)
	case "peertube":
		return peertubeContentURL(instanceURL, externalID)
	case "lemmy", "piefed":
		return communityContentURL(instanceURL, externalID)
	case "devnull":
		return devNullContentURL(username, externalID)
	case "facebook":
		return facebookContentURL(externalID)
	}
	return ""
}

func xContentURL(externalID string) string {
	if !safeContentID.MatchString(externalID) {
		return ""
	}
	return "https://x.com/i/web/status/" + externalID
}

func mastodonContentURL(username, instanceURL, externalID string) string {
	// Stored handles are sometimes a full "user@host" Fediverse address;
	// Mastodon profile paths use only the local part.
	if at := strings.Index(username, "@"); at >= 0 {
		username = username[:at]
	}
	base, err := url.Parse(strings.TrimSpace(instanceURL))
	if err != nil || base.Scheme != "https" || base.Host == "" || username == "" ||
		!safeContentID.MatchString(externalID) {
		return ""
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/@" + username + "/" + externalID
	base.RawQuery = ""
	base.Fragment = ""
	return base.String()
}

func blueskyContentURL(externalID string) string {
	uri := blueskyPublishedURI(externalID)
	if uri == "" {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(uri, "at://"), "/")
	if len(parts) != 3 || parts[1] != "app.bsky.feed.post" ||
		!safeContentID.MatchString(parts[0]) || !safeContentID.MatchString(parts[2]) {
		return ""
	}
	return "https://bsky.app/profile/" + parts[0] + "/post/" + parts[2]
}

func linkedinContentURL(externalID string) string {
	if !strings.HasPrefix(externalID, "urn:li:") || !safeContentID.MatchString(externalID) {
		return ""
	}
	return "https://www.linkedin.com/feed/update/" + externalID
}

func tiktokContentURL(username, externalID, outputProfile string) string {
	if username == "" || !numericContent.MatchString(externalID) {
		return ""
	}
	kind := "video"
	if outputProfile == "tiktok.photo" || outputProfile == "carousel" {
		kind = "photo"
	}
	return "https://www.tiktok.com/@" + username + "/" + kind + "/" + externalID
}

func youtubeContentURL(externalID string) string {
	if !safeContentID.MatchString(externalID) {
		return ""
	}
	return "https://www.youtube.com/watch?v=" + url.QueryEscape(externalID)
}

func peertubeContentURL(instanceURL, externalID string) string {
	externalID = strings.TrimSpace(externalID)
	if externalID == "" || !safeContentID.MatchString(externalID) {
		return ""
	}
	base, err := url.Parse(strings.TrimSpace(instanceURL))
	if err != nil || base.Scheme != "https" || base.Host == "" {
		return ""
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/videos/watch/" + externalID
	base.RawQuery = ""
	base.Fragment = ""
	return base.String()
}

func communityContentURL(instanceURL, externalID string) string {
	externalID = strings.TrimSpace(externalID)
	if externalID == "" || !safeContentID.MatchString(externalID) {
		return ""
	}
	base, err := url.Parse(strings.TrimSpace(instanceURL))
	if err != nil || base.Scheme != "https" || base.Host == "" {
		return ""
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/post/" + externalID
	base.RawQuery = ""
	base.Fragment = ""
	return base.String()
}

func facebookContentURL(externalID string) string {
	if !safeContentID.MatchString(externalID) {
		return ""
	}
	return "https://www.facebook.com/" + externalID
}

// devNullContentURL rebuilds a commit link from a stored commit UUID, short
// hash, or full link. The CLI contract returns a full link, which also
// round-trips through IsSafeContentURL, so this path only rebuilds URLs when
// the stored ID is bare.
func devNullContentURL(username, externalID string) string {
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return ""
	}
	if IsSafeContentURL(externalID) {
		return externalID
	}
	username = strings.TrimPrefix(strings.TrimSpace(username), "@")
	if username == "" {
		return ""
	}
	commitID := externalID
	if parsed, err := url.Parse(externalID); err == nil && parsed.Host != "" {
		commitID = strings.TrimRight(parsed.Path, "/")
		if idx := strings.LastIndex(commitID, "/"); idx >= 0 {
			commitID = commitID[idx+1:]
		}
	}
	if commitID == "" {
		return ""
	}
	return DevNullDefaultBaseURL + "/@" + username + "/commits/" + commitID
}

// blueskyNativePostURL names the profile link for an imported native post:
// the verified handle when Bluesky vouches for it, otherwise the DID.
func blueskyNativePostURL(profile, uri string) string {
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(uri), "at://"), "/")
	if len(parts) != 3 || parts[1] != "app.bsky.feed.post" || parts[2] == "" {
		return ""
	}
	return "https://bsky.app/profile/" + profile + "/post/" + parts[2]
}

func IsSafeContentURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}

func blueskyPublishedURI(externalID string) string {
	if strings.HasPrefix(externalID, "at://") {
		return externalID
	}
	var payload struct {
		URI string `json:"uri"`
	}
	if json.Unmarshal([]byte(externalID), &payload) != nil {
		return ""
	}
	return strings.TrimSpace(payload.URI)
}
