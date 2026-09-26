// Board calendar view placement and moves (named apart from BoardCalendar.tsx for case-insensitive file systems) (WAVE_13_TASK_CARD_UX.md §4.5a, D115). Pure: no DOM.
//
// - A date-only card sits on its `due_on` day.
// - A timed card sits on the viewer-local date of its `due_at` and shows the viewer-local time.
// - A card without `due_on` is Unscheduled.
// The board pipeline (filters) runs before placement; the list grouping does not apply here.
import { addDays, daysBetween } from "../calendarRoute";
import { instantParts } from "./taskActions";

type DueCard = { id: string; due_on: string | null; due_time?: string | null; due_tz?: string | null; due_at?: string | null };

/** The day a card shows on for the viewer, or null when it has no due date. */
export function displayedDay(card: DueCard, viewerZone: string) {
  if (!card.due_on) return null;
  if (card.due_time && card.due_at && Number.isFinite(Date.parse(card.due_at))) return instantParts(card.due_at, viewerZone).date;
  return card.due_on;
}

/** The viewer-local time of a timed card ("09:30"), or null. */
export function displayedTime(card: DueCard, viewerZone: string) {
  return card.due_time && card.due_at && Number.isFinite(Date.parse(card.due_at)) ? instantParts(card.due_at, viewerZone).time : null;
}

export type Placement<T> = { byDay: Map<string, T[]>; unscheduled: T[] };

/** Cards by displayed day (date-only cards first, then by time, then in the given order), and the rest. */
export function placeCards<T extends DueCard>(cards: readonly T[], viewerZone: string): Placement<T> {
  const byDay = new Map<string, T[]>();
  const unscheduled: T[] = [];
  const order = new Map(cards.map((card, index) => [card.id, index]));
  for (const card of cards) {
    const day = displayedDay(card, viewerZone);
    if (!day) {
      unscheduled.push(card);
      continue;
    }
    const list = byDay.get(day) ?? [];
    list.push(card);
    byDay.set(day, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      const left = displayedTime(a, viewerZone);
      const right = displayedTime(b, viewerZone);
      if (left !== right) return left === null ? -1 : right === null ? 1 : left < right ? -1 : 1;
      return order.get(a.id)! - order.get(b.id)!;
    });
  }
  return { byDay, unscheduled };
}

/**
 * The `dueOn` to send when a card is dropped on `day`: its civil date shifts by the days between
 * where it is shown and where it was dropped, so the wall time and zone stay (the server keeps
 * `dueTime`/`dueTz` when only `dueOn` changes). An unscheduled card takes the day itself. Null
 * when nothing changes.
 */
export function dropDueOn(card: DueCard, day: string, viewerZone: string): string | null {
  const shown = displayedDay(card, viewerZone);
  if (!shown || !card.due_on) return day;
  const delta = daysBetween(shown, day);
  return delta === 0 ? null : addDays(card.due_on, delta);
}

/** Alt+←/→ move a day, Alt+↑/↓ a week (mirroring the board's Alt+Arrow). */
export function keyboardDayDelta(key: string): number | null {
  return ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[key] ?? null;
}

/** The instant a timed card moves to when its date shifts by `days` (optimistic only; the server's answer replaces it). */
export function shiftedDueAt(dueAt: string | null | undefined, days: number) {
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return dueAt ?? null;
  return new Date(Date.parse(dueAt) + days * 86_400_000).toISOString();
}

/** "Due Thursday 3 October", "Due Thursday 3 October at 17:30", or "No due date", for the live region. */
export function dueAnnouncement(day: string | null, time: string | null) {
  if (!day) return "No due date";
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const spoken = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, date)));
  return `Due ${spoken}${time ? ` at ${time}` : ""}`;
}
