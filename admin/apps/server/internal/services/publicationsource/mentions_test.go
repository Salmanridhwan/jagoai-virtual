package publicationsource

import (
	"encoding/json"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/posttext"
	"github.com/stretchr/testify/require"
)

func TestReusableMentionProjectionPreservesJoinedSourceDecisionsAndPollSuffix(t *testing.T) {
	mention := posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{{Start: 4, End: 10, Text: "@guest", Target: posttext.MentionTarget{Provider: "workspace", Kind: "profile", ID: "saved", Profiles: []posttext.MentionProfile{{Provider: "x", Text: "@guest_x"}}}}}}
	settings, err := json.Marshal(map[string]any{"mentions": mention})
	require.NoError(t, err)
	canonical := []models.PublicationSegment{{ID: "one", Body: " Hi @guest ", SettingsJSON: string(settings)}, {ID: "two", Body: "Plain @guest", SettingsJSON: "{}"}}
	body, projection, err := DeliveryText(canonical, "one", "", nil, nil, true, "Hi @guest\n\nPlain @guest\n\nPoll: Which?", "x", "")
	require.NoError(t, err)
	require.Equal(t, "Hi @guest_x\n\nPlain @guest\n\nPoll: Which?", body)
	require.Empty(t, projection.Spans)
	require.Equal(t, []posttext.ByteRange{{Start: 13, End: 25}}, projection.LegacyRanges)
	empty := ""
	overrides, _ := json.Marshal([]RenditionSourceOverride{{PublicationSegmentID: "one", BodyOverride: &empty, Mentions: &posttext.Mentions{Version: 1, Spans: []posttext.MentionSpan{}}}})
	body, _, err = DeliveryText(canonical, "one", string(overrides), nil, nil, true, "Plain @guest", "x", "")
	require.NoError(t, err)
	require.Equal(t, "Plain @guest", body)
}
