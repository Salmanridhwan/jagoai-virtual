package posttext

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func alice() MentionTarget {
	return MentionTarget{Provider: "bluesky", Kind: "person", ID: "did:plc:ewvi7nxzyoun6zhxrhs64oiz", Handle: "alice.bsky.social"}
}
func TestMentionRangesPreserveUnicodeAndJoinedSources(t *testing.T) {
	first := &Mentions{Version: 1, Spans: []MentionSpan{{Start: 10, End: 16, Text: "@alice", Target: alice()}}}
	third := &Mentions{Version: 1, Spans: []MentionSpan{{Start: 3, End: 8, Text: "@Acme", Target: MentionTarget{Provider: "linkedin", Kind: "page", ID: "urn:li:organization:123"}}}}
	body, projection, err := Join([]Value{{Body: "  🚀 Hi @alice  ", Mentions: first}, {Body: " @bob "}, {Body: "\u3000@Acme\u00a0", Mentions: third}})
	require.NoError(t, err)
	require.Equal(t, "🚀 Hi @alice\n\n@bob\n\n@Acme", body)
	require.Equal(t, []MentionSpan{{Start: 8, End: 14, Text: "@alice", Target: alice()}, {Start: 22, End: 27, Text: "@Acme", Target: third.Spans[0].Target}}, projection.Spans)
	require.Equal(t, []ByteRange{{Start: 16, End: 20}}, projection.LegacyRanges)
	require.Equal(t, 10, first.Spans[0].Start, "projection must not rewrite authored ranges")
}

func TestLegacyTextEditsRetainUnambiguousIdentities(t *testing.T) {
	before := "🚀 Hi @alice"
	mentions := &Mentions{Version: 1, Spans: []MentionSpan{{Start: 8, End: 14, Text: "@alice", Target: alice()}}}
	for _, test := range []struct {
		body       string
		start, end int
	}{{"A 🚀 Hi @alice", 10, 16}, {"🚀 Hi @alice!", 8, 14}, {"🚀 Hi @alice", 8, 14}} {
		result, err := Remap(before, test.body, mentions)
		require.NoError(t, err)
		require.Equal(t, test.start, result.Spans[0].Start)
		require.Equal(t, test.end, result.Spans[0].End)
		require.Equal(t, alice(), result.Spans[0].Target)
	}
	for _, body := range []string{"🚀 Hi @alex", "🚀 Hi ", "🚀 Hi @alice and @alice"} {
		_, err := Remap(before, body, mentions)
		require.ErrorIs(t, err, ErrMetadataRequired)
	}
	cleared, err := PreserveSettings(before, "Changed", map[string]any{SettingsKey: mentions}, map[string]any{SettingsKey: Mentions{Version: 1, Spans: []MentionSpan{}}})
	require.NoError(t, err)
	parsed, err := Read(cleared)
	require.NoError(t, err)
	require.Empty(t, parsed.Spans)
	require.Equal(t, 8, mentions.Spans[0].Start)
}

func TestInvalidMentionCannotIntroduceProviderMarkupOrWrongIdentity(t *testing.T) {
	valid := MentionSpan{Start: 8, End: 14, Text: "@alice", Target: alice()}
	for _, mutate := range []func(*MentionSpan){func(s *MentionSpan) { s.Start = 1 }, func(s *MentionSpan) { s.End = 100 }, func(s *MentionSpan) { s.Text = "different" }, func(s *MentionSpan) { s.Target.Provider = "invented" }, func(s *MentionSpan) {
		s.Target = MentionTarget{Provider: "linkedin", Kind: "page", ID: "urn:li:organization:123) @[attacker](evil"}
	}} {
		span := valid
		mutate(&span)
		require.ErrorIs(t, Validate("🚀 Hi @alice", &Mentions{Version: 1, Spans: []MentionSpan{span}}), ErrInvalid)
	}
	require.Error(t, ValidateDestination("🚀 Hi @alice", "linkedin", "", &Mentions{Version: 1, Spans: []MentionSpan{valid}}))
	span := MentionSpan{Start: 0, End: 17, Text: "@test@one.example", Target: MentionTarget{Provider: "mastodon", Kind: "person", ID: "123", Handle: "test@one.example", Authority: "https://one.example"}}
	require.NoError(t, ValidateDestination("@test@one.example", "mastodon", "https://ONE.example/", &Mentions{Version: 1, Spans: []MentionSpan{span}}))
	require.Error(t, ValidateDestination("@test@one.example", "mastodon", "https://two.example", &Mentions{Version: 1, Spans: []MentionSpan{span}}))
}

func TestDuplicateMentionDeletionRequiresExplicitSelection(t *testing.T) {
	for _, start := range []int{3, 14} {
		before := "Hi @alice and @alice"
		selected := &Mentions{Version: 1, Spans: []MentionSpan{{Start: start, End: start + 6, Text: "@alice", Target: alice()}}}
		_, err := Remap(before, "Hi @alice", selected)
		require.ErrorIs(t, err, ErrMetadataRequired, "either selected occurrence could have been deleted")
	}
}
