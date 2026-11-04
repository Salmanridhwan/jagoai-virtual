package capabilities

import (
	"fmt"
	"slices"

	"github.com/openpost/backend/internal/textcards"
)

// TextCardSettings describes the text-card destination settings for the
// composer. The allowed values and defaults are owned by textcards (see
// getopenpost/openpost#420); this catalogue only adds presentation (labels
// and controls), so adding an option to textcards reaches the composer with
// no second edit.
func TextCardSettings() []SettingDefinition {
	style := textcards.DefaultStyle
	fields := []SettingDefinition{
		{Key: "text_card", Label: "Text as image", Type: "select", Options: slices.Clone(textcards.ModeOptions), Default: style.Mode, Control: "text_card"},
		{Key: "text_card_appearance", Label: "Card appearance", Type: "select", Options: slices.Clone(textcards.AppearanceOptions), Default: style.Appearance},
		{Key: "text_card_background", Label: "Background", Type: "select", Options: slices.Clone(textcards.BackgroundOptions), Default: style.Background},
		{Key: "text_card_color", Label: "Background color", Type: "text", Default: style.Color},
		{Key: "text_card_color_end", Label: "Second color", Type: "text", Default: style.ColorEnd},
		{Key: "text_card_rounded", Label: "Rounded corners", Type: "boolean", Default: style.Rounded},
		{Key: "text_card_shadow", Label: "Drop shadow", Type: "boolean", Default: style.Shadow},
	}
	for i := range fields {
		fields[i].Scope = SettingScopeDestination
		fields[i].Group = "content"
	}
	return fields
}

// projectTextCards plans the exact generated media count without creating files.
// It joins source posts before laying out their text, as delivery does.
func projectTextCards(provider, outputProfile string, segments []ResolveSegment, settings map[string]any) ([]ResolveSegment, bool, []ValidationIssue) {
	// Joining and card projection rewrite media on the first segment. Keep the
	// caller's slice untouched so destinations can resolve from shared input
	// concurrently.
	segments = slices.Clone(segments)
	if !textcards.Supported(provider, outputProfile) {
		return segments, false, nil
	}
	style, err := textcards.Parse(settings)
	if err != nil {
		return segments, false, []ValidationIssue{validationIssue("text_card_invalid", err.Error(), provider, "", "text_card")}
	}
	joined := destinationSegments(segments, "join")
	if len(joined) > 0 {
		seen := map[string]bool{}
		media := make([]MediaItem, 0, len(joined[0].Media))
		for _, item := range joined[0].Media {
			if item.ID != "" && seen[item.ID] {
				continue
			}
			seen[item.ID] = true
			media = append(media, item)
		}
		joined[0].Media = media
	}
	if len(joined) == 0 || !style.Applies(provider, outputProfile, joined[0].Body, len(joined[0].Media)) {
		return segments, false, nil
	}
	pages, err := textcards.Layout(joined[0].Body, outputProfile)
	if err != nil {
		return segments, false, []ValidationIssue{validationIssue("text_card_invalid", err.Error(), provider, "", "text_card")}
	}
	media := make([]MediaItem, 0, len(pages)+len(joined[0].Media))
	for i, page := range pages {
		media = append(media, MediaItem{ID: fmt.Sprintf("text-card:%d", i), MimeType: "image/jpeg", Width: textcards.Width, Height: page.Height, AnalysisStatus: "ready", PublicURLReady: true})
	}
	joined[0].Media = append(media, joined[0].Media...)
	issue := validationIssue("text_card_applied", "Text will be published as an image.", provider, "", "text_card")
	issue.Severity = "info"
	issue.Parameters = map[string]any{"cards": len(pages), "media_count": len(joined[0].Media)}
	return joined, true, []ValidationIssue{issue}
}

func resolveInputTextCards(provider, preset string, input ResolveInput) ([]ResolveSegment, bool, []ValidationIssue) {
	if input.Context == ResolveContextSocialSetDefaults {
		return input.Segments, false, nil
	}
	profile := input.RequestedOutputProfile
	if profile == "" && preset == "story" {
		profile = provider + ".story"
	}
	return projectTextCards(provider, profile, input.Segments, input.Settings)
}
