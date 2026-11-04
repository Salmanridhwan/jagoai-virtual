import { describe, expect, it } from 'vitest';
import { createCalendarTimeIndex } from './calendar-time-index';

describe('calendar local-hour placement', () => {
	it('keeps both occurrences of a repeated daylight-saving hour in input order', () => {
		const later = { id: 'later', occursAt: '2026-11-01T06:45:00Z' };
		const earlier = { id: 'earlier', occursAt: '2026-11-01T05:15:00Z' };
		const index = createCalendarTimeIndex(
			new Map([['2026-11-01', [later, earlier]]]),
			'America/New_York'
		);
		const repeatedHour = index.itemsForHour('2026-11-01', 1);
		expect(repeatedHour).toEqual([later, earlier]);
		expect(repeatedHour[0]).toBe(later);
		expect(repeatedHour[1]).toBe(earlier);
		expect(index.timeParts(later.occursAt)).toEqual({ hour: 1, minute: 45 });
		expect(index.timeParts(earlier.occursAt)).toEqual({ hour: 1, minute: 15 });
	});

	it('leaves a skipped daylight-saving hour empty', () => {
		const before = { occursAt: '2026-03-08T06:59:00Z' };
		const after = { occursAt: '2026-03-08T07:00:00Z' };
		const index = createCalendarTimeIndex(
			new Map([['2026-03-08', [before, after]]]),
			'America/New_York'
		);
		expect(index.itemsForHour('2026-03-08', 1)).toEqual([before]);
		expect(index.itemsForHour('2026-03-08', 2)).toEqual([]);
		expect(index.itemsForHour('2026-03-08', 3)).toEqual([after]);
		expect(index.timeParts(after.occursAt)).toEqual({ hour: 3, minute: 0 });
	});

	it('places quarter-hour offsets and midnight in the supplied local day', () => {
		const midnight = { occursAt: '2026-10-18T18:15:00Z' };
		const lastMinute = { occursAt: '2026-10-19T18:14:00Z' };
		const index = createCalendarTimeIndex(
			new Map([['2026-10-19', [midnight, lastMinute]]]),
			'Asia/Kathmandu'
		);
		expect(index.itemsForHour('2026-10-19', 0)).toEqual([midnight]);
		expect(index.timeParts(midnight.occursAt)).toEqual({ hour: 0, minute: 0 });
		expect(index.itemsForHour('2026-10-19', 23)).toEqual([lastMinute]);
		expect(index.timeParts(lastMinute.occursAt)).toEqual({ hour: 23, minute: 59 });
		expect(index.itemsForHour('2026-10-18', 0)).toEqual([]);
	});

	it('resolves drag timestamps outside the visible posts using the same timezone', () => {
		const index = createCalendarTimeIndex(new Map(), 'Australia/Adelaide');
		expect(index.timeParts('2026-06-01T00:15:00Z')).toEqual({ hour: 9, minute: 45 });
		expect(index.timeParts('2026-12-01T00:15:00Z')).toEqual({ hour: 10, minute: 45 });
		expect(index.itemsForHour('2026-06-01', 9)).toEqual([]);
	});
});
