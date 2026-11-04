type CalendarTime = { hour: number; minute: number };

export function createCalendarTimeIndex<Item extends { occursAt: string }>(
	itemsByDay: ReadonlyMap<string, readonly Item[]>,
	timeZone: string
) {
	const formatter = new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	});
	const times = new Map<string, CalendarTime>();
	const days = new Map<string, Map<number, Item[]>>();

	function timeParts(value: string): CalendarTime {
		const cached = times.get(value);
		if (cached) return cached;
		const parts = formatter.formatToParts(new Date(value));
		const time = {
			hour: Number(parts.find((part) => part.type === 'hour')?.value ?? 0),
			minute: Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
		};
		times.set(value, time);
		return time;
	}

	for (const [day, items] of itemsByDay) {
		const hours = new Map<number, Item[]>();
		for (const item of items) {
			const hour = timeParts(item.occursAt).hour;
			const bucket = hours.get(hour);
			if (bucket) bucket.push(item);
			else hours.set(hour, [item]);
		}
		days.set(day, hours);
	}

	return {
		timeParts,
		itemsForHour(day: string, hour: number): readonly Item[] {
			return days.get(day)?.get(hour) ?? [];
		}
	};
}
