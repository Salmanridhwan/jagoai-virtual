// Package inboxactivity defines normalized account activity. It contains no
// provider payloads, credentials, persistence or transport behavior.
package inboxactivity

import (
	"encoding/json"
	"strings"
	"time"
)

type PostReference struct {
	URI string `json:"uri"`
	CID string `json:"cid"`
}

type ReviewReply struct {
	Text            string    `json:"text"`
	State           string    `json:"state"`
	PolicyViolation string    `json:"policy_violation,omitempty"`
	UpdatedAt       time.Time `json:"updated_at,omitempty,omitzero"`
}

type ReviewContext struct {
	Stars      *int         `json:"stars,omitempty"`
	Anonymous  bool         `json:"anonymous"`
	OwnerReply *ReviewReply `json:"owner_reply,omitempty"`
}

// EngagementSubject is an upstream post or review, independent of whether it
// was authored in OpenPost. Its optional native references are used for replies.
type EngagementSubject struct {
	Kind       string         `json:"kind"`
	RemoteID   string         `json:"remote_id"`
	URL        string         `json:"url,omitempty"`
	Visibility string         `json:"visibility,omitempty"`
	Root       *PostReference `json:"root,omitempty"`
	Parent     *PostReference `json:"parent,omitempty"`
	Review     *ReviewContext `json:"review,omitempty"`
}

// NativeIdentity excludes historical reply-routing context from object identity.
// The original remote reference remains stored for existing action receipts.
func NativeIdentity(provider, remoteID string) string {
	if provider == "bluesky" {
		var reference struct {
			URI string `json:"uri"`
		}
		if json.Unmarshal([]byte(remoteID), &reference) == nil && strings.HasPrefix(reference.URI, "at://") && len(reference.URI) <= 512 {
			return reference.URI
		}
	}
	return remoteID
}
