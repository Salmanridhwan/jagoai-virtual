package capabilities

import "strings"

// Attachment requirements are authored segment settings. Every client can save
// an incomplete draft; the shared capability boundary fences scheduling and delivery.
func ValidateAttachmentRequirement(provider, profile string, media []MediaItem, settings map[string]any) []ValidationIssue {
	value := settings["attachment_requirement"]
	if value == nil {
		return nil
	}
	requirement, ok := value.(map[string]any)
	if !ok {
		return []ValidationIssue{validationIssue("attachment_required", "Choose an image or video attachment requirement.", provider, profile, "media")}
	}
	kind, _ := requirement["kind"].(string)
	if kind != "image" && kind != "video" {
		return []ValidationIssue{validationIssue("attachment_required", "Choose an image or video attachment requirement.", provider, profile, "media")}
	}
	for _, item := range media {
		if strings.HasPrefix(item.MimeType, kind+"/") {
			return nil
		}
	}
	brief, _ := requirement["brief"].(string)
	issue := validationIssue("attachment_required", "Attach the required "+kind+" before publishing.", provider, profile, "media")
	issue.Parameters = map[string]any{"kind": kind, "brief": brief}
	return []ValidationIssue{issue}
}
