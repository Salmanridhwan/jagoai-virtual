// Package textcards owns the deterministic text-to-image publishing format.
// It has no provider I/O or database dependencies.
package textcards

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	MediaRole     = "text_card"
	MaxCharacters = 2200
	Width         = 1080
)

// DefaultColor and DefaultColorEnd are the only place the server
// materializes the default card background gradient. Parse applies them;
// capability catalogue entries, docs and clients must read them from there
// rather than keeping their own literal copy.
const (
	DefaultColor    = "#c4b5fd"
	DefaultColorEnd = "#93c5fd"
)

// ModeOptions, AppearanceOptions and BackgroundOptions are the single owner
// of the allowed text-card setting values. The capability catalogue builds
// its composer options from them (see getopenpost/openpost#420), so adding
// an option here reaches the composer with no second edit.
var (
	ModeOptions       = []string{"off", "text_only", "always"}
	AppearanceOptions = []string{"light", "dark"}
	BackgroundOptions = []string{"solid", "gradient", "mesh"}
)

// DefaultStyle is the single owner of the text-card defaults. Parse applies
// it; capability catalogue entries, docs and clients must read it from here
// rather than keeping their own literal copy.
var DefaultStyle = Style{Mode: "off", Appearance: "light", Background: "gradient", Color: DefaultColor, ColorEnd: DefaultColorEnd, Rounded: true, Shadow: true}

type Style struct {
	Mode       string `json:"mode"`
	Appearance string `json:"appearance"`
	Background string `json:"background"`
	Color      string `json:"color"`
	ColorEnd   string `json:"color_end"`
	Rounded    bool   `json:"rounded"`
	Shadow     bool   `json:"shadow"`
}

func Supported(provider, outputProfile string) bool {
	switch provider {
	case "instagram":
		return outputProfile == "" || outputProfile == "instagram.feed" || outputProfile == "instagram.carousel" || outputProfile == "instagram.story"
	case "pixelfed":
		return outputProfile == "" || outputProfile == "pixelfed.post" || outputProfile == "pixelfed.carousel"
	}
	return false
}

// NewPostDefaults is applied only at creation. Missing settings on existing
// publications remain off, including publications already in the queue.
func NewPostDefaults(provider string, settings map[string]any) map[string]any {
	if !Supported(provider, "") {
		return settings
	}
	result := make(map[string]any, len(settings)+1)
	for key, value := range settings {
		result[key] = value
	}
	if _, exists := result["text_card"]; !exists {
		result["text_card"] = "text_only"
	}
	return result
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func Parse(settings map[string]any) (Style, error) {
	style := DefaultStyle
	for _, field := range []struct {
		key     string
		target  *string
		allowed []string
	}{
		{"text_card", &style.Mode, ModeOptions},
		{"text_card_appearance", &style.Appearance, AppearanceOptions},
		{"text_card_background", &style.Background, BackgroundOptions},
		{"text_card_color", &style.Color, nil},
		{"text_card_color_end", &style.ColorEnd, nil},
	} {
		value, exists := settings[field.key]
		if !exists {
			continue
		}
		text, ok := value.(string)
		if !ok {
			return Style{}, fmt.Errorf("%s must be a string", field.key)
		}
		valid := false
		if field.allowed == nil {
			valid = hexColor.MatchString(text)
		} else {
			for _, allowed := range field.allowed {
				if text == allowed {
					valid = true
				}
			}
		}
		if !valid {
			return Style{}, fmt.Errorf("%s has an invalid value", field.key)
		}
		*field.target = text
	}
	for _, field := range []struct {
		key    string
		target *bool
	}{
		{"text_card_rounded", &style.Rounded}, {"text_card_shadow", &style.Shadow},
	} {
		if value, exists := settings[field.key]; exists {
			boolean, ok := value.(bool)
			if !ok {
				return Style{}, fmt.Errorf("%s must be a boolean", field.key)
			}
			*field.target = boolean
		}
	}
	return style, nil
}

func (style Style) Applies(provider, outputProfile, body string, attachments int) bool {
	return Supported(provider, outputProfile) && strings.TrimSpace(body) != "" &&
		(style.Mode == "always" || style.Mode == "text_only" && attachments == 0)
}

func Height(outputProfile string) int {
	if strings.HasSuffix(outputProfile, ".story") {
		return 1920
	}
	return 1350
}

func ValidateText(body string) error {
	if !utf8.ValidString(body) || utf8.RuneCountInString(body) > MaxCharacters {
		return fmt.Errorf("text cards support up to %d characters; shorten this variant", MaxCharacters)
	}
	return nil
}
