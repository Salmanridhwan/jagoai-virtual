package capabilities

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// All returns one process-wide catalog. Resolution must never rewrite it,
// because every request and the certification digest cache read the same slice.
func TestCapabilityCatalogStableAcrossResolution(t *testing.T) {
	before, err := json.Marshal(All())
	require.NoError(t, err)

	for _, provider := range []string{ProviderX, ProviderInstagram, ProviderYouTube, ProviderLinkedIn} {
		Resolve(provider, ResolveInput{
			Intent:   IntentPost,
			Segments: []ResolveSegment{{ID: "segment-1", Body: "A normal update"}},
			Settings: map[string]any{"title": "Title"},
		})
	}

	after, err := json.Marshal(All())
	require.NoError(t, err)
	require.JSONEq(t, string(before), string(after))
}
