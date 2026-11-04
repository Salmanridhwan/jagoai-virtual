// Package settingx owns typed reads out of untyped settings maps
// (renditions.settings_json and rendition_segments.settings_json decoded
// into map[string]any).
//
// One documented rule per type:
//
//   - String coerces: missing or null reads as "", anything else reads as
//     strings.TrimSpace(fmt.Sprint(value)). This is the tolerant policy the
//     provider adapters under internal/platform already persist and send, so
//     every other reader of the same stored value must agree with it.
//   - Bool coerces: a bare bool reads as itself; a string reads as true
//     only when it trims and lowercases to "true", "1", "yes", or "on";
//     any other type reads as true only when fmt.Sprint(value) equals
//     "true" case-insensitively. This is the tolerant adapter policy.
//   - BoolPtr preserves the null-or-unset versus false distinction: nil
//     when the key is absent or null, otherwise a pointer to Bool.
//   - BoolDefault returns the fallback when the map is nil or the key is
//     absent; a present null reads as false, matching the adapters.
//   - Int reads int, int64, and float64 directly and trims then Atoi's
//     strings; anything else reads as 0.
//
// Deliberate divergences kept outside this package:
//
//   - capabilities.settingBooleanValue used strconv.ParseBool, which accepts
//     "t" but rejects "yes" and "on". It now delegates to Bool so the
//     capability preview agrees with what the adapters already send for the
//     same stored value. Concretely: "yes"/"on" now read true and "t" now
//     reads false in validation.
//   - publisher.settingStringPublisher stays strict (string or
//     fmt.Stringer only) because coercing a stored number into a media ID
//     would manufacture a database lookup instead of skipping it.
//   - api/handlers stringFromMap/boolFromMap stay strict (bare type
//     assertions, no trimming) because they read internal upload-result
//     maps on the public API surface, where no new coercion is accepted.
package settingx

import (
	"fmt"
	"strconv"
	"strings"
)

// String reads a general adapter setting, coercing any present non-null
// value with strings.TrimSpace(fmt.Sprint(value)).
func String(settings map[string]any, key string) string {
	if settings == nil {
		return ""
	}
	value, ok := settings[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

// Bool reads a boolean destination setting with the tolerant adapter rule:
// bare bools pass through, strings match "true", "1", "yes", or "on" after
// trimming and lowercasing, and any other type matches "true"
// case-insensitively after fmt.Sprint.
func Bool(settings map[string]any, key string) bool {
	if settings == nil {
		return false
	}
	value, ok := settings[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on"
	default:
		return strings.EqualFold(fmt.Sprint(value), "true")
	}
}

// BoolPtr keeps an explicit false distinct from unset: nil when the key is
// absent or null, so providers can tell "not set" (use the account default)
// from "set to false".
func BoolPtr(settings map[string]any, key string) *bool {
	if raw, ok := settings[key]; !ok || raw == nil {
		return nil
	}
	value := Bool(settings, key)
	return &value
}

// BoolDefault returns fallback when the map is nil or the key is absent. A
// present null reads as false, matching the adapters.
func BoolDefault(settings map[string]any, key string, fallback bool) bool {
	if settings == nil {
		return fallback
	}
	if _, ok := settings[key]; !ok {
		return fallback
	}
	return Bool(settings, key)
}

// Int reads an integer setting from int, int64, float64, or a trimmed
// decimal string; anything else reads as 0.
func Int(settings map[string]any, key string) int {
	if settings == nil {
		return 0
	}
	value, ok := settings[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return 0
}
