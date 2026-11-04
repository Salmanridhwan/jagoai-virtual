package posttext

import (
	"encoding/json"
	"strings"
	"unicode"
)

// ForDelivery projects only authored ranges into the final text. Poll text may
// be appended after trimming, but it cannot move or replace selected identities.
func ForDelivery(authored, delivered, provider, authority string, projection *Projection) (*Projection, error) {
	if projection == nil {
		return nil, nil
	}
	if err := ValidateDestination(authored, provider, authority, &projection.Mentions); err != nil {
		return nil, err
	}
	output := &Projection{Mentions: Mentions{Version: 1, Spans: append([]MentionSpan{}, projection.Spans...)}, LegacyRanges: append([]ByteRange{}, projection.LegacyRanges...)}
	offset := 0
	if !strings.HasPrefix(delivered, authored) {
		trimmed := strings.TrimSpace(authored)
		if !strings.HasPrefix(delivered, trimmed) {
			return nil, ErrInvalid
		}
		offset = len(authored) - len(strings.TrimLeftFunc(authored, unicode.IsSpace))
	}
	for i := range output.Spans {
		output.Spans[i].Start -= offset
		output.Spans[i].End -= offset
	}
	for i := range output.LegacyRanges {
		output.LegacyRanges[i].Start = max(0, output.LegacyRanges[i].Start-offset)
		output.LegacyRanges[i].End = min(len(delivered), output.LegacyRanges[i].End-offset)
	}
	return output, ValidateDestination(delivered, provider, authority, &output.Mentions)
}

func ReadProjection(body, provider, authority string, settings map[string]any) (*Projection, error) {
	raw, exists := settings[NativeSettingsKey]
	if !exists || raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil || len(data) > 128*1024 {
		return nil, ErrInvalid
	}
	var projection Projection
	if json.Unmarshal(data, &projection) != nil {
		return nil, ErrInvalid
	}
	if err := ValidateDestination(body, provider, authority, &projection.Mentions); err != nil {
		return nil, err
	}
	previous := 0
	for _, window := range projection.LegacyRanges {
		if window.Start < previous || window.End <= window.Start || window.End > len(body) {
			return nil, ErrInvalid
		}
		for _, span := range projection.Spans {
			if window.Start < span.End && span.Start < window.End {
				return nil, ErrInvalid
			}
		}
		previous = window.End
	}
	return &projection, nil
}

func LegacyMentionAllowed(projection *Projection, start, end int) bool {
	if projection == nil {
		return true
	}
	for _, window := range projection.LegacyRanges {
		if window.Start <= start && end <= window.End {
			return true
		}
	}
	return false
}
