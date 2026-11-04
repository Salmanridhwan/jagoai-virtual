// Native date pickers and analytics requests use the same UTC calendar.
export function analyticsCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function analyticsPickerDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}
