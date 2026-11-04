package capabilities

import (
	"testing"
)

// Issue #414: the capability preview must agree with what the provider
// adapter sends for the same stored settings_json value. Adapters read
// "yes"/"on" as enabled, so validation must too.
func TestSettingBooleanValueMatchesAdapterCoercion(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  bool
	}{
		{"true string", "true", true},
		{"one string", "1", true},
		{"yes string", "yes", true},
		{"on string", "on", true},
		{"empty string", "", false},
		{"false string", "false", false},
		{"bool true", true, true},
		{"bool false", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			settings := map[string]any{"flag": tc.value}
			if got := settingBooleanValue(settings, "flag"); got != tc.want {
				t.Fatalf("settingBooleanValue(%q) = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
	if got := settingBooleanValue(map[string]any{}, "flag"); got != false {
		t.Fatalf("settingBooleanValue(missing) = %v, want false", got)
	}
}
