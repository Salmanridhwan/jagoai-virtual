package capabilities

import "github.com/openpost/backend/internal/providerlimits"

func ApplyInstagramLoginSettings(resolved *ResolvedCapability, settings map[string]any) {
	const reason = "This setting requires an Instagram connection through Facebook."
	issues := InstagramLoginSettingsIssues(resolved.Capability, settings)
	resolved.Issues = append(resolved.Issues, issues...)
	if len(issues) > 0 {
		resolved.Compatible = false
	}
	for index := range resolved.Settings {
		field := &resolved.Settings[index]
		if providerlimits.InstagramLoginSettingUnavailable(field.Key) {
			field.UnavailableReason = reason
		}
	}
	for groupIndex := range resolved.SettingGroups {
		for index := range resolved.SettingGroups[groupIndex].Settings {
			field := &resolved.SettingGroups[groupIndex].Settings[index]
			if providerlimits.InstagramLoginSettingUnavailable(field.Key) {
				field.UnavailableReason = reason
			}
		}
	}
}

func InstagramLoginSettingsIssues(capability Capability, settings map[string]any) []ValidationIssue {
	var issues []ValidationIssue
	for _, field := range instagramSettings(capability.Profile) {
		value := settingsValue(settings, field.Key)
		if providerlimits.InstagramLoginSettingUnavailable(field.Key) && value != "" && value != "[]" && value != "<nil>" {
			issues = append(issues, settingValidationIssue(capability, field, "unsupported_setting", "This setting requires an Instagram connection through Facebook."))
		}
	}
	return issues
}
