package capabilities

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRequiredDemoBlocksDeliveryUntilVideoAttached(t *testing.T) {
	settings := map[string]any{"attachment_requirement": map[string]any{"kind": "video", "brief": "Show the new drag interaction."}}
	issues := ValidateOutput("x", "x.video", "short_video", "This is how it works.", "", "", nil, settings)
	require.True(t, hasAttachmentIssue(issues), "a missing demo must block scheduling and delivery")
	issues = ValidateOutput("x", "x.video", "short_video", "This is how it works.", "", "", []MediaItem{{ID: "image", MimeType: "image/png"}}, settings)
	require.True(t, hasAttachmentIssue(issues), "a screenshot does not fulfill a video requirement")
	issues = ValidateOutput("x", "x.video", "short_video", "This is how it works.", "", "", []MediaItem{{ID: "demo", MimeType: "video/mp4", AnalysisStatus: "ready", Size: 1024, Width: 1920, Height: 1080, DurationMS: 10000}}, settings)
	require.False(t, hasAttachmentIssue(issues))
	for _, issue := range issues {
		require.NotEqual(t, "error", issue.Severity, "matching media must restore complete readiness: %+v", issues)
	}
	resolved := Resolve("x", ResolveInput{RequestedOutputProfile: "x.post", Segments: []ResolveSegment{{ID: "source", Body: "This is how it works."}}, Settings: settings})
	require.False(t, resolved.Compatible, "discovery must show the missing attachment before scheduling")
	require.True(t, hasAttachmentIssue(resolved.Issues))
}

func hasAttachmentIssue(issues []ValidationIssue) bool {
	for _, issue := range issues {
		if issue.Code == "attachment_required" && issue.Severity == "error" {
			return true
		}
	}
	return false
}

func TestAttachmentRequirementsAreSegmentScopedAndValidateShape(t *testing.T) {
	requirement := map[string]any{"attachment_requirement": map[string]any{"kind": "video"}}
	resolved := Resolve("x", ResolveInput{RequestedOutputProfile: "x.thread", Segments: []ResolveSegment{{ID: "first", Body: "Watch the demo", Settings: requirement}, {ID: "reply", Body: "Details"}}})
	require.False(t, resolved.Compatible)
	missing := 0
	for _, issue := range resolved.Issues {
		if issue.Code == "attachment_required" {
			missing++
			require.Equal(t, "first", issue.SegmentID)
		}
	}
	require.Equal(t, 1, missing, "the reply must not inherit the first source's attachment requirement")
	for _, malformed := range []any{"video", true, []string{"video"}, map[string]any{"kind": "audio"}} {
		require.True(t, hasAttachmentIssue(ValidateAttachmentRequirement("x", "x.post", nil, map[string]any{"attachment_requirement": malformed})))
	}
	require.Empty(t, ValidateAttachmentRequirement("x", "x.post", nil, map[string]any{"attachment_requirement": nil}))
}
