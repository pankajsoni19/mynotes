// History hint for Calendar entries. The URL carries the view, the month, and the event; this payload
// adds what the URL does not: the day selected in a month (the phone day list, updated in place with
// replaceState so tapping days never adds entries) and, on an event entry, the occurrence date it
// was opened from (so "Skip this date" names the right one).
import { isRouteMonth } from "./router";
import type { CalendarRoute } from "./calendarRoute";

export type CalendarHint = { month: string | null; day: string | null; eventId: string | null; occurrence: string | null };

const historyKey = "mynotes.calendar-navigation";
const historyVersion = 1;
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type CalendarHistoryState = {
  [historyKey]: { version: number; userId: string; hint: CalendarHint };
};

const isDate = (value: unknown): value is string => typeof value === "string" && datePattern.test(value);

function cleanHint(hint: CalendarHint): CalendarHint {
  const month = hint.month && isRouteMonth(hint.month) ? hint.month : null;
  // A selected day belongs to its month.
  const day = month && isDate(hint.day) && hint.day.startsWith(month) ? hint.day : null;
  return { month, day, eventId: typeof hint.eventId === "string" ? hint.eventId : null, occurrence: isDate(hint.occurrence) ? hint.occurrence : null };
}

export function createCalendarHistoryState(userId: string, hint: CalendarHint, currentState: unknown): CalendarHistoryState {
  const base = currentState && typeof currentState === "object" ? currentState as Record<string, unknown> : {};
  return { ...base, [historyKey]: { version: historyVersion, userId, hint: cleanHint(hint) } };
}

export function readCalendarHint(state: unknown, userId: string): CalendarHint | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[historyKey];
  if (!value || typeof value !== "object") return null;
  const entry = value as { version?: unknown; userId?: unknown; hint?: unknown };
  if (entry.version !== historyVersion || entry.userId !== userId || !entry.hint || typeof entry.hint !== "object") return null;
  const hint = entry.hint as Partial<CalendarHint>;
  return cleanHint({ month: typeof hint.month === "string" ? hint.month : null, day: hint.day ?? null, eventId: hint.eventId ?? null, occurrence: hint.occurrence ?? null });
}

/** The day to select in `month`: the entry's hint when it is for this month, else null. */
export function selectedDayFor(state: unknown, userId: string, month: string) {
  const hint = readCalendarHint(state, userId);
  return hint && hint.month === month ? hint.day : null;
}

/** The occurrence date an event entry was opened from, when the hint is for this event. */
export function occurrenceFor(state: unknown, userId: string, eventId: string) {
  const hint = readCalendarHint(state, userId);
  return hint && hint.eventId === eventId ? hint.occurrence : null;
}

/** Keeps the current entry's hint when a write (a replace or URL normalisation) stays on the same month or event. */
export function carriedCalendarState(userId: string, route: CalendarRoute, currentState: unknown): CalendarHistoryState | null {
  const hint = readCalendarHint(currentState, userId);
  if (!hint) return null;
  if (route.eventId) return hint.eventId === route.eventId ? createCalendarHistoryState(userId, { month: null, day: null, eventId: hint.eventId, occurrence: hint.occurrence }, null) : null;
  if (route.view === "month" && route.month && hint.month === route.month) return createCalendarHistoryState(userId, { month: hint.month, day: hint.day, eventId: null, occurrence: null }, null);
  return null;
}
