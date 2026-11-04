import { expect, test } from "bun:test";
import { analyticsCalendarDate, analyticsPickerDate } from "./analytics-date-range";

test("analytics dates stay on the UTC day across device timezone offsets", () => {
  expect(analyticsCalendarDate(new Date("2026-10-23T18:00:00-07:00"))).toBe("2026-10-24");
  expect(analyticsCalendarDate(new Date("2026-10-24T02:00:00+14:00"))).toBe("2026-10-23");
  expect(analyticsPickerDate("2026-10-24").toISOString()).toBe("2026-10-24T12:00:00.000Z");
});
