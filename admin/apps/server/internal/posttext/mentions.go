// Package posttext owns versioned authored mention identity and text ranges.
// Editor HTML and provider encodings are projections, never stored authorship.
package posttext

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const SettingsKey = "mentions"
const NativeSettingsKey = "authored_mentions"

var ErrInvalid = errors.New("invalid mention annotations")
var ErrMetadataRequired = errors.New("this edit changes a selected mention; include updated mention metadata or an explicit empty spans list")
var didPattern = regexp.MustCompile(`^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$`)
var organizationURN = regexp.MustCompile(`^urn:li:organization:[1-9][0-9]{0,30}$`)

type MentionTarget struct {
	Provider  string           `json:"provider" enum:"bluesky,mastodon,linkedin,workspace"`
	Kind      string           `json:"kind" enum:"person,page,profile"`
	ID        string           `json:"id" minLength:"1" maxLength:"2048"`
	Authority string           `json:"authority,omitempty" maxLength:"2048" doc:"Connected instance origin for Mastodon; empty for global identity namespaces"`
	Handle    string           `json:"handle,omitempty" maxLength:"512" doc:"Native account address returned by the provider lookup"`
	Profiles  []MentionProfile `json:"profiles,omitempty" maxItems:"32" doc:"Immutable per-network snapshot for a reusable Workspace mention"`
}
type MentionProfile struct {
	Provider  string               `json:"provider" minLength:"1" maxLength:"40"`
	Authority string               `json:"authority,omitempty" maxLength:"2048"`
	Text      string               `json:"text" minLength:"1" maxLength:"512"`
	Target    *NativeMentionTarget `json:"target,omitempty" doc:"Validated native identity, or omitted for an ordinary text replacement"`
}
type NativeMentionTarget struct {
	Provider  string `json:"provider" enum:"bluesky,mastodon,linkedin"`
	Kind      string `json:"kind" enum:"person,page"`
	ID        string `json:"id" minLength:"1" maxLength:"2048"`
	Authority string `json:"authority,omitempty" maxLength:"2048"`
	Handle    string `json:"handle,omitempty" maxLength:"512"`
}
type MentionSpan struct {
	Start  int           `json:"start" minimum:"0" doc:"Inclusive UTF-8 byte offset in the exact authored text"`
	End    int           `json:"end" minimum:"1" doc:"Exclusive UTF-8 byte offset"`
	Text   string        `json:"text" minLength:"1" maxLength:"512" doc:"Exact visible text covered by the range"`
	Target MentionTarget `json:"target"`
}
type Mentions struct {
	Version int           `json:"version" enum:"1"`
	Spans   []MentionSpan `json:"spans" nullable:"false" maxItems:"50" doc:"Ordered, nonoverlapping native mention selections; an empty list explicitly contains no selected mentions"`
}
type ByteRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// Projection includes legacy source windows so adding a selected mention in one
// joined segment never changes implicit mention behavior in another old segment.
type Projection struct {
	Mentions
	LegacyRanges []ByteRange `json:"legacy_ranges,omitempty"`
}
type Value struct {
	Body     string
	Mentions *Mentions
}

func Read(settings map[string]any) (*Mentions, error) {
	raw, ok := settings[SettingsKey]
	if !ok || raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil || len(data) > 128*1024 {
		return nil, ErrInvalid
	}
	var mentions Mentions
	if err := json.Unmarshal(data, &mentions); err != nil {
		return nil, ErrInvalid
	}
	return &mentions, nil
}

func Validate(body string, mentions *Mentions) error {
	if mentions == nil {
		return nil
	}
	if mentions.Version != 1 || mentions.Spans == nil || len(mentions.Spans) > 50 || !utf8.ValidString(body) {
		return ErrInvalid
	}
	previous := 0
	for _, span := range mentions.Spans {
		if !validMentionRange(body, span, previous) {
			return ErrInvalid
		}
		if err := validateTarget(span.Target); err != nil {
			return err
		}
		previous = span.End
	}
	return nil
}

func validMentionRange(body string, span MentionSpan, previous int) bool {
	if span.Start < previous || span.End <= span.Start || span.End > len(body) || span.Start >= len(body) {
		return false
	}
	if !utf8.RuneStart(body[span.Start]) || span.End < len(body) && !utf8.RuneStart(body[span.End]) {
		return false
	}
	return body[span.Start:span.End] == span.Text && strings.TrimSpace(span.Text) != "" && utf8.RuneCountInString(span.Text) <= 512
}

func validateTarget(target MentionTarget) error {
	if len(target.ID) == 0 || len(target.ID) > 2048 || len(target.Handle) > 512 {
		return ErrInvalid
	}
	valid := false
	if target.Provider != "workspace" && len(target.Profiles) > 0 {
		return ErrInvalid
	}
	switch target.Provider {
	case "workspace":
		return ValidateProfiles(target)
	case "bluesky":
		valid = validBlueskyTarget(target)
	case "linkedin":
		valid = target.Kind == "page" && organizationURN.MatchString(target.ID) && target.Authority == ""
	case "mastodon":
		valid = validMastodonTarget(target)
	}
	if !valid {
		return ErrInvalid
	}
	return nil
}
func validBlueskyTarget(target MentionTarget) bool {
	return target.Kind == "person" && didPattern.MatchString(target.ID) && target.Authority == ""
}
func validMastodonTarget(target MentionTarget) bool {
	return target.Kind == "person" && Authority(target.Authority) != "" && target.Handle != "" && !strings.ContainsAny(target.Handle, " \t\r\n") && asciiDigits(target.ID)
}

func asciiDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return value != ""
}
func Authority(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" && parsed.Path != "/" {
		return ""
	}
	return "https://" + strings.ToLower(parsed.Host)
}

func ValidateDestination(body, provider, authority string, mentions *Mentions) error {
	if err := Validate(body, mentions); err != nil {
		return err
	}
	if mentions == nil {
		return nil
	}
	for _, span := range mentions.Spans {
		if span.Target.Provider != provider || provider == "mastodon" && (Authority(span.Target.Authority) != Authority(authority) || span.Text != "@"+strings.TrimPrefix(span.Target.Handle, "@")) {
			return fmt.Errorf("%w: choose mentions for this destination account", ErrInvalid)
		}
	}
	return nil
}

// PreserveSettings supports old plain-text clients without silently changing a
// selected identity. Explicit modern metadata is validated against the new text.
func PreserveSettings(oldBody, newBody string, oldSettings, newSettings map[string]any) (map[string]any, error) {
	if _, reserved := newSettings[NativeSettingsKey]; reserved {
		return nil, fmt.Errorf("provider mention projections cannot be authored")
	}
	next := maps.Clone(newSettings)
	if next == nil {
		next = map[string]any{}
	}
	if _, present := next[SettingsKey]; !present {
		previous, err := Read(oldSettings)
		if err != nil {
			return nil, err
		}
		if previous != nil {
			remapped, err := Remap(oldBody, newBody, previous)
			if err != nil {
				return nil, err
			}
			next[SettingsKey] = remapped
		}
	}
	mentions, err := Read(next)
	if err != nil {
		return nil, err
	}
	return next, Validate(newBody, mentions)
}

func Remap(before, after string, mentions *Mentions) (*Mentions, error) {
	if err := Validate(before, mentions); err != nil {
		return nil, err
	}
	if mentions == nil {
		return nil, nil
	}
	result := &Mentions{Version: 1, Spans: append([]MentionSpan{}, mentions.Spans...)}
	if after == "" {
		return &Mentions{Version: 1, Spans: []MentionSpan{}}, nil
	}
	if before == after {
		return result, nil
	}
	prefix, suffix := unchangedMentionText(before, after)
	for i, span := range result.Spans {
		remapped, err := remapMentionSpan(before, after, span, prefix, suffix)
		if err != nil {
			return nil, err
		}
		result.Spans[i] = remapped
	}
	sort.Slice(result.Spans, func(i, j int) bool { return result.Spans[i].Start < result.Spans[j].Start })
	return result, Validate(after, result)
}

func unchangedMentionText(before, after string) (int, int) {
	prefix := 0
	for prefix < len(before) && prefix < len(after) && before[prefix] == after[prefix] {
		prefix++
	}
	for prefix > 0 && !utf8BoundaryInBoth(before, after, prefix, prefix) {
		prefix--
	}
	suffix := 0
	for suffix < len(before)-prefix && suffix < len(after)-prefix && before[len(before)-suffix-1] == after[len(after)-suffix-1] {
		suffix++
	}
	for suffix > 0 && !utf8BoundaryInBoth(before, after, len(before)-suffix, len(after)-suffix) {
		suffix--
	}
	return prefix, suffix
}
func utf8BoundaryInBoth(before, after string, left, right int) bool {
	return (left == len(before) || utf8.RuneStart(before[left])) && (right == len(after) || utf8.RuneStart(after[right]))
}
func remapMentionSpan(before, after string, span MentionSpan, prefix, suffix int) (MentionSpan, error) {
	oldCount, newCount := strings.Count(before, span.Text), strings.Count(after, span.Text)
	if newCount > oldCount || (oldCount > 1 && newCount < oldCount) {
		return span, ErrMetadataRequired
	}
	switch {
	case span.End <= prefix:
	case span.Start >= len(before)-suffix:
		span.Start += len(after) - len(before)
		span.End += len(after) - len(before)
	default:
		if oldCount != 1 || newCount != 1 {
			return span, ErrMetadataRequired
		}
		span.Start = strings.Index(after, span.Text)
		span.End = span.Start + len(span.Text)
	}
	return span, nil
}

// Join follows authored source trimming and separators, then remaps byte ranges.
func Join(values []Value) (string, *Projection, error) {
	body := ""
	projection := &Projection{Mentions: Mentions{Version: 1, Spans: []MentionSpan{}}}
	managed := false
	for _, value := range values {
		if err := Validate(value.Body, value.Mentions); err != nil {
			return "", nil, err
		}
		managed = managed || value.Mentions != nil
		trimmed := strings.TrimSpace(value.Body)
		if trimmed == "" {
			continue
		}
		if body != "" {
			body += "\n\n"
		}
		offset := len(body)
		leading := len(value.Body) - len(strings.TrimLeftFunc(value.Body, unicode.IsSpace))
		if value.Mentions == nil {
			projection.LegacyRanges = append(projection.LegacyRanges, ByteRange{Start: offset, End: offset + len(trimmed)})
		} else {
			for _, span := range value.Mentions.Spans {
				span.Start -= leading
				span.End -= leading
				if span.Start < 0 || span.End > len(trimmed) {
					return "", nil, ErrInvalid
				}
				span.Start += offset
				span.End += offset
				projection.Spans = append(projection.Spans, span)
			}
		}
		body += trimmed
	}
	if !managed {
		return body, nil, nil
	}
	return body, projection, nil
}
