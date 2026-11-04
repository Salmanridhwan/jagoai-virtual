-- Keep this expression aligned with publicationCalendarOccurrenceSQL.
-- Planned posts use authored schedule times; published posts use recorded outcomes.
CREATE INDEX IF NOT EXISTS publications_workspace_calendar_idx
  ON publications (
    workspace_id,
    (CASE
      WHEN status = 'published' THEN COALESCE(actual_run_at, scheduled_at, updated_at, created_at)
      ELSE scheduled_at
    END),
    id
  )
  WHERE status IN ('scheduled', 'publishing', 'published');
