export interface CalendarPublication {
	status: string;
	scheduled_at?: string | null;
	actual_run_at?: string | null;
	updated_at?: string | null;
	created_at?: string | null;
}

/**
 * Single owner for the planned-versus-actual occurrence rule.
 *
 * Planned views use the authored `scheduled_at`; queued `actual_run_at` may
 * include random dispatch delay and is not the authored schedule. Published
 * views use the recorded actual time.
 *
 * - `scheduled` / `publishing` return the authored schedule, or null when it
 *   is missing (a queued retry can carry a stale previous-run timestamp, so
 *   `actual_run_at` is never used here).
 * - `published` returns the recorded run, falling back down the chain.
 * - Every other status (`draft`, `ready`, `failed`, ...) returns null: the
 *   post has no calendar occurrence.
 *
 * Server parity: `publicationCalendarOccurrenceSQL` in
 * `apps/server/internal/api/handlers/publication_list.go` (indexed by
 * `160_publication_calendar_lookup.sql`) is intentionally broader: its ELSE
 * branch returns `scheduled_at` for every non-published status, including
 * `ready` and `failed`, where this rule returns null. The difference is
 * latent today (`ready` is never written; the calendar index only covers
 * `scheduled`/`publishing`/`published`), but the SQL must stay hand-written
 * for ordering and range filtering, never generated from this rule. Keep the
 * two aligned when statuses change.
 */
export function publicationCalendarOccurrence(publication: CalendarPublication): string | null {
	// Queued dispatch may be randomized; planned views retain the authored schedule.
	if (publication.status === 'scheduled' || publication.status === 'publishing') {
		return publication.scheduled_at || null;
	}
	if (publication.status === 'published') {
		return (
			publication.actual_run_at ||
			publication.scheduled_at ||
			publication.updated_at ||
			publication.created_at ||
			null
		);
	}
	return null;
}

export function publicationActivityOccurrence(publication: CalendarPublication): string {
	const planned = publicationCalendarOccurrence(publication);
	if (planned) return planned;
	if (publication.status === 'scheduled' || publication.status === 'publishing') {
		// A queued retry can carry a stale previous-run timestamp with no authored
		// schedule; show the queued time instead of the previous run.
		return publication.updated_at || publication.created_at || '';
	}
	return publication.actual_run_at || publication.scheduled_at || publication.created_at || '';
}

/**
 * Day key (`YYYY-MM-DD`) for calendar placement in the given time zone.
 * Thin wrapper over the owner: no occurrence means no day. Returns '' when
 * the publication has no occurrence so callers can skip it.
 */
export function publicationCalendarDayKey(
	publication: CalendarPublication,
	timeZone: string
): string {
	const occurrence = publicationCalendarOccurrence(publication);
	if (!occurrence) return '';
	return new Date(occurrence)
		.toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
		.replace(/\//g, '-');
}
