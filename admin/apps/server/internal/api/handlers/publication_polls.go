package handlers

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationpoll"
	"github.com/openpost/backend/internal/services/publicationsource"
	"github.com/uptrace/bun"
)

func publicationPollSources(segments []models.PublicationSegment) []map[string]any {
	sources := make([]map[string]any, 0, len(segments))
	for _, segment := range segments {
		var values map[string]any
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &values)
		sources = append(sources, values)
	}
	return sources
}

func joinedPublicationBody(segments []models.PublicationSegment) string {
	bodies := make([]string, 0, len(segments))
	for _, segment := range segments {
		if body := strings.TrimSpace(segment.Body); body != "" {
			bodies = append(bodies, body)
		}
	}
	return strings.Join(bodies, "\n\n")
}

func validatePublicationPoll(rendition models.Rendition, segment RenditionSegmentResponse, canonical []models.PublicationSegment, segmentCount int) []capabilities.ValidationIssue {
	var pollErr error
	code := "poll_resolution_required"
	if segmentCount == 1 && len(canonical) > 1 {
		_, _, pollErr = publicationpoll.ResolveJoined(publicationPollSources(canonical), rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, segment.Body, segment.Settings)
		code = "poll_join_conflict"
	} else {
		for _, source := range canonical {
			if source.ID != segment.PublicationSegmentID {
				continue
			}
			var values map[string]any
			_ = json.Unmarshal([]byte(source.SettingsJSON), &values)
			_, _, pollErr = publicationpoll.Resolve(values, rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, segment.Body, segment.Settings)
			break
		}
	}
	if pollErr == nil {
		return validatePublicationLink(rendition, segment, canonical, segmentCount)
	}
	return []capabilities.ValidationIssue{{Code: code, Message: pollErr.Error(), Severity: "error", Provider: rendition.Platform, Field: "poll", SegmentID: segment.ID, Scope: capabilities.SettingScopeSegment, ScopeID: segment.ID}}
}

// Canonical-only API updates must refresh the same output as a composer save.
func refreshPublicationText(ctx context.Context, db bun.IDB, publicationID string, previous []models.PublicationSegment) error {
	var canonical []models.PublicationSegment
	if err := db.NewSelect().Model(&canonical).Where("publication_id = ?", publicationID).Order("position ASC").Scan(ctx); err != nil {
		return err
	}
	previousBodies := make(map[string]string, len(previous))
	for _, source := range previous {
		previousBodies[source.ID] = source.Body
	}
	owned := map[string]*publicationpoll.Draft{}
	for _, source := range append(append([]models.PublicationSegment{}, previous...), canonical...) {
		var values map[string]any
		_ = json.Unmarshal([]byte(source.SettingsJSON), &values)
		if values[publicationpoll.SettingsKey] != nil {
			owned[source.ID], _ = publicationpoll.Decode(values)
		}
	}
	// Joined source overrides also inherit canonical text without a poll.
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).Where("publication_id = ?", publicationID).Scan(ctx); err != nil {
		return err
	}
	for _, rendition := range renditions {
		if err := refreshRenditionText(ctx, db, rendition, canonical, owned, previousBodies); err != nil {
			return err
		}
	}
	return refreshPublicationLinks(ctx, db, publicationID, previous)
}

func refreshRenditionText(ctx context.Context, db bun.IDB, rendition models.Rendition, canonical []models.PublicationSegment, owned map[string]*publicationpoll.Draft, previousBodies map[string]string) error {
	var segments []models.RenditionSegment
	if err := db.NewSelect().Model(&segments).Where("rendition_id = ?", rendition.ID).Order("position ASC").Scan(ctx); err != nil {
		return err
	}
	byID := map[string]models.PublicationSegment{}
	for _, source := range canonical {
		byID[source.ID] = source
	}
	joined := len(segments) == 1 && len(canonical) > 1
	mediaChanged := false
	for i := range segments {
		segment := &segments[i]
		previousPoll, wasOwned := owned[segment.PublicationSegmentID]
		joinedSource := joined || len(readRenditionSourceOverrides(segment.SourceOverridesJSON)) > 0
		source, ok := byID[segment.PublicationSegmentID]
		if !ok {
			continue
		}
		if !joinedSource && !wasOwned {
			if !refreshOrdinaryRenditionText(segment, source, previousBodies) {
				continue
			}
		} else {
			refreshPollSegment(segment, rendition, source, canonical, previousPoll, joinedSource)
		}
		if publicationsource.HasSourceOverrides(segment.SourceOverridesJSON) {
			if err := refreshJoinedSourceMedia(ctx, db, segment, canonical); err != nil {
				return err
			}
			mediaChanged = true
		}
		if err := persistRenditionTextProjection(ctx, db, segment, i == 0); err != nil {
			return err
		}
	}
	if mediaChanged {
		return refreshRenditionMediaProjection(ctx, db, rendition.ID)
	}
	return nil
}

func refreshPollSegment(segment *models.RenditionSegment, rendition models.Rendition, source models.PublicationSegment, canonical []models.PublicationSegment, previousPoll *publicationpoll.Draft, joined bool) {
	body := source.Body
	if joined {
		body = publicationsource.JoinedSourceBody(canonical, segment.SourceOverridesJSON, segment.BodyOverride)
		if publicationsource.HasSourceOverrides(segment.SourceOverridesJSON) {
			sourceBody := body
			segment.BodyOverride = &sourceBody
		}
	}
	if !joined && segment.BodyOverride != nil {
		body = *segment.BodyOverride
	}
	var values, sourceSettings map[string]any
	_ = json.Unmarshal([]byte(segment.SettingsJSON), &values)
	_ = json.Unmarshal([]byte(source.SettingsJSON), &sourceSettings)
	legacy := previousPoll != nil && previousPoll.Destinations[rendition.SocialAccountID].Mode == publicationpoll.ModeLegacy
	if sourceSettings[publicationpoll.SettingsKey] == nil && !joined && !legacy {
		for key := range values {
			if strings.HasPrefix(key, "poll_") {
				delete(values, key)
			}
		}
	}
	if joined {
		body, values, _ = publicationpoll.ResolveJoined(publicationPollSources(canonical), rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, body, values)
	} else {
		body, values, _ = publicationpoll.Resolve(sourceSettings, rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, body, values)
	}
	segment.Body = body
	segment.SettingsJSON = mustJSON(values)
}

func persistRenditionTextProjection(ctx context.Context, db bun.IDB, segment *models.RenditionSegment, first bool) error {
	if _, err := db.NewUpdate().Model(segment).Column("body", "body_override", "settings_json").WherePK().Exec(ctx); err != nil {
		return err
	}
	if !first {
		return nil
	}
	_, err := db.NewUpdate().Model((*models.Rendition)(nil)).Set("body = ?", segment.Body).Where("id = ?", segment.RenditionID).Exec(ctx)
	return err
}

func inheritedRenditionText(segment *models.RenditionSegment, source models.PublicationSegment, previous map[string]string) bool {
	before, found := previous[source.ID]
	if !found {
		before = source.Body
	}
	return segment.BodyOverride == nil && segment.Body == before
}

// Ordinary text has one owner even when older storage omitted its override.
func refreshOrdinaryRenditionText(segment *models.RenditionSegment, source models.PublicationSegment, previous map[string]string) bool {
	if inheritedRenditionText(segment, source, previous) {
		segment.Body = source.Body
		return true
	}
	if segment.BodyOverride != nil {
		return false
	}
	// Snapshot legacy independent text before new canonical annotations can leak
	// into it during validation or delivery. Its existing settings remain its own.
	body := segment.Body
	segment.BodyOverride = &body
	return true
}
