import { isValidTimeZone, zonedToUtc } from "../calendar/recurrence";

/**
 * Optional due times (WAVE_13_TASK_CARD_UX.md D100, D101; migration 015).
 *
 * `due_on` stays the civil date, now in `due_tz` when a time is set.
 * `due_time` is `HH:MM` and `due_tz` the IANA zone the setter's browser sent;
 * the server validates the zone and stores it as sent, never converting it.
 * Both are NULL or both set, and a time needs a date (the 015 CHECK). The
 * instant `due_at` is derived with `zonedToUtc`, which moves a time inside a
 * DST gap forward and picks the earlier instant in an overlap (T94).
 */

export const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isDueTime = (value: string) => DUE_TIME_PATTERN.test(value);
export const isDueTimeZone = (value: string) => isValidTimeZone(value);

export type DueFields = { due_on: string | null; due_time: string | null; due_tz: string | null };
export type DueInput = { dueOn?: string | null; dueTime?: string | null; dueTz?: string | null };

/** The UTC instant of a timed due date as an ISO string, or null for a date-only (or undated) card. */
export function dueAt(card: DueFields) {
  if (!card.due_on || !card.due_time || !card.due_tz) return null;
  return new Date(zonedToUtc(`${card.due_on}T${card.due_time}`, card.due_tz)).toISOString();
}

/**
 * The due fields after applying `input` to `current`, or a user-facing error.
 * - `dueTz` only comes with a `dueTime`; a time needs a zone.
 * - `dueTime: null` clears the time and zone.
 * - Changing only `dueOn` keeps the wall time and zone (D115).
 * - Clearing the date also clears the time; a time without a date is refused.
 */
export function resolveDue(current: DueFields, input: DueInput): { value: DueFields; timeChange: "set" | "cleared" | null } | { error: string } {
  if (input.dueTz !== undefined && input.dueTime === undefined) return { error: "Send dueTz together with dueTime" };
  let { due_time, due_tz } = current;
  const due_on = input.dueOn !== undefined ? input.dueOn : current.due_on;
  let timeChange: "set" | "cleared" | null = null;
  if (input.dueTime === null) {
    if (input.dueTz) return { error: "A cleared due time takes no time zone" };
    timeChange = current.due_time ? "cleared" : null;
    due_time = null;
    due_tz = null;
  } else if (input.dueTime !== undefined) {
    if (!input.dueTz) return { error: "A due time needs a time zone (dueTz)" };
    if (!due_on) return { error: "A due time needs a due date" };
    due_time = input.dueTime;
    due_tz = input.dueTz;
    timeChange = "set";
  }
  if (!due_on && due_time) {
    timeChange = "cleared";
    due_time = null;
    due_tz = null;
  }
  return { value: { due_on, due_time, due_tz }, timeChange };
}
