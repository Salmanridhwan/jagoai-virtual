package analytics

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/openpost/backend/internal/models"
)

var ErrInvalidRange = errors.New("choose 7, 30, 90, or 365 days, 0 for all time, or valid inclusive from/to dates")

// ValidateRange is shared by overview, export, and repurpose admission.
func ValidateRange(days int, from, to string) error {
	if from != "" || to != "" {
		start, e1 := time.Parse(time.DateOnly, from)
		end, e2 := time.Parse(time.DateOnly, to)
		if e1 != nil || e2 != nil || end.Before(start) || start.Year() < 1 || end.Year() > 9998 {
			return ErrInvalidRange
		}
		return nil
	}
	switch days {
	case 0, 7, 30, 90, 365:
		return nil
	default:
		return ErrInvalidRange
	}
}

func (s *Service) overviewRange(ctx context.Context, workspaceID string, days int, from, to string, now time.Time) (time.Time, time.Time, error) {
	if err := ValidateRange(days, from, to); err != nil {
		return time.Time{}, time.Time{}, err
	}
	if from != "" {
		start, _ := time.Parse(time.DateOnly, from)
		last, _ := time.Parse(time.DateOnly, to)
		end := last.AddDate(0, 0, 1)
		if end.After(now) {
			end = now.Add(time.Nanosecond)
		}
		if !start.Before(end) {
			return time.Time{}, time.Time{}, ErrInvalidRange
		}
		return start, end, nil
	}
	if days != 0 {
		return now.AddDate(0, 0, -days), now.Add(time.Nanosecond), nil
	}
	start, err := s.earliestStoredAnalyticsTime(ctx, workspaceID, now)
	return start, now.Add(time.Nanosecond), err
}

// earliestStoredAnalyticsTime bounds All time to data actually retained in this Workspace.
func (s *Service) earliestStoredAnalyticsTime(ctx context.Context, workspaceID string, now time.Time) (time.Time, error) {
	start := now
	var publication models.Publication
	err := s.db.NewSelect().Model(&publication).Column("actual_run_at", "updated_at").Where("workspace_id = ? AND status = ?", workspaceID, models.PublicationStatusPublished).OrderExpr("COALESCE(actual_run_at,updated_at) ASC").Limit(1).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return start, err
	}
	if err == nil {
		at := publication.ActualRunAt
		if at.IsZero() {
			at = publication.UpdatedAt
		}
		if at.Before(start) {
			start = at
		}
	}
	var account models.AnalyticsAccountSnapshot
	err = s.db.NewSelect().Model(&account).Column("captured_at").Where("workspace_id = ?", workspaceID).Order("captured_at ASC").Limit(1).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return start, err
	}
	if err == nil && account.CapturedAt.Before(start) {
		start = account.CapturedAt
	}
	var content models.AnalyticsRenditionSnapshot
	err = s.db.NewSelect().Model(&content).Column("captured_at").Where("workspace_id = ?", workspaceID).Order("captured_at ASC").Limit(1).Scan(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return start, err
	}
	if err == nil && content.CapturedAt.Before(start) {
		start = content.CapturedAt
	}
	return start, nil
}
