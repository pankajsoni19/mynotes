/**
 * Card filtering and sorting, pure and shared by the server and the client
 * (WAVE_13_TASK_CARD_UX.md D113, §4.5, §5.5; the top-level `shared/`
 * directory is the one the hierarchy plan approved, its §13 Q10).
 *
 * This is the **client-side approach** of D113: the board JSON already holds
 * every live card, so the client filters it in memory with `queryCards`. MCP
 * `list_cards` filters on the server with bound SQL
 * (`server/tasks/cardQuery.ts`), and a parity test runs both over one fixture.
 * The 13E board pipeline (`src/tasks/boardQuery.ts`) can import this module
 * or mirror it; the hierarchy wave (17C) adds its query-language `parse` and
 * `format` next to it.
 *
 * Semantics (Linear-style, §4.6): values inside one field are OR-ed, fields
 * are AND-ed, and an empty or missing field does not filter.
 * - `assignees`: user ids, `me` (the viewer), or `none` (no assignee).
 * - `tags`: tag ids, or `none` (no tag). An id no card carries matches nothing.
 * - `flags`: flags from the fixed set, or `none` (no flag).
 * - `due`: `before`/`after` are exclusive bounds on `due_on` (the civil date
 *   in the card's zone) and are AND-ed into one range over dated cards;
 *   `none` adds cards without a date. `{ none: true }` alone means undated
 *   cards only. The relative buckets (overdue, today, this week) depend on
 *   the viewer's clock and zone and arrive with the 13E filter bar.
 * - `columns`: column ids.
 * - `text`: 1–100 characters, matched as a substring of the title and the
 *   description excerpt, ignoring case and accents.
 *
 * No DOM, database, or Node APIs, so it runs in both bundles.
 */

export const TASK_FLAGS = ["urgent", "blocked", "needs_review", "on_hold"] as const;
export type TaskFlag = typeof TASK_FLAGS[number];

export const QUERY_LIMITS = { values: 30, textMax: 100 } as const;

/** The card fields the query reads; `CardSummary` from `GET /boards/:b` satisfies it. */
export type QueryCard = {
  id: string;
  column_id: string;
  position: number;
  title: string;
  description_excerpt: string;
  due_on: string | null;
  assignees: ReadonlyArray<{ id: string }>;
  tag_ids: readonly string[];
  flags: readonly string[];
  created_at: string;
  updated_at: string;
};
export type QueryColumn = { id: string; position: number };

export type CardFilter = {
  assignees?: readonly string[];
  tags?: readonly string[];
  flags?: ReadonlyArray<TaskFlag | "none">;
  due?: { before?: string; after?: string; none?: boolean };
  columns?: readonly string[];
  text?: string;
};

export const CARD_SORT_KEYS = ["board", "due", "title", "created", "updated"] as const;
export type CardSortKey = typeof CARD_SORT_KEYS[number];
export type CardSort = { key: CardSortKey; direction: "asc" | "desc" };

export type QueryContext = { userId: string };

/** A filter with `me` resolved, ids lower-cased and deduplicated, and `none` split out. */
export type NormalizedFilter = {
  assignees: { ids: string[]; none: boolean } | null;
  tags: { ids: string[]; none: boolean } | null;
  flags: { values: TaskFlag[]; none: boolean } | null;
  due: { before: string | null; after: string | null; none: boolean } | null;
  columns: string[] | null;
  text: string | null;
};

function idSet(values: readonly string[] | undefined, me?: string) {
  if (!values?.length) return null;
  const ids = new Set<string>();
  let none = false;
  for (const value of values) {
    if (value === "none") none = true;
    else ids.add(value === "me" && me ? me.toLowerCase() : value.toLowerCase());
  }
  return { ids: [...ids], none };
}

/** Case- and accent-folded text for matching: NFKD, combining marks removed, lower case. */
export function foldText(value: string) {
  return value.normalize("NFKD").replace(/\p{Mn}/gu, "").toLowerCase();
}

export function normalizeFilter(filter: CardFilter, context: QueryContext): NormalizedFilter {
  const flags = filter.flags?.length
    ? { values: TASK_FLAGS.filter((flag) => filter.flags!.includes(flag)), none: filter.flags.includes("none") }
    : null;
  const due = filter.due && (filter.due.before || filter.due.after || filter.due.none)
    ? { before: filter.due.before ?? null, after: filter.due.after ?? null, none: filter.due.none === true }
    : null;
  const text = filter.text?.trim() ? foldText(filter.text.trim()) : null;
  return {
    assignees: idSet(filter.assignees, context.userId),
    tags: idSet(filter.tags),
    flags,
    due,
    columns: filter.columns?.length ? [...new Set(filter.columns.map((id) => id.toLowerCase()))] : null,
    text
  };
}

const anyOf = (set: { ids: string[]; none: boolean }, present: readonly string[]) =>
  (set.none && present.length === 0) || present.some((value) => set.ids.includes(value));

/** Whether a card's title or excerpt contains the folded text. */
export function matchesText(card: Pick<QueryCard, "title" | "description_excerpt">, foldedText: string) {
  return foldText(card.title).includes(foldedText) || foldText(card.description_excerpt).includes(foldedText);
}

/** The due clause: a range over dated cards (both bounds exclusive), OR undated cards when `none`. */
function matchesDue(due: NonNullable<NormalizedFilter["due"]>, dueOn: string | null) {
  if (dueOn === null) return due.none;
  if (due.before === null && due.after === null) return false;
  return (due.before === null || dueOn < due.before) && (due.after === null || dueOn > due.after);
}

export function matchesCard(card: QueryCard, filter: NormalizedFilter) {
  if (filter.columns && !filter.columns.includes(card.column_id)) return false;
  if (filter.assignees && !anyOf(filter.assignees, card.assignees.map((assignee) => assignee.id))) return false;
  if (filter.tags && !anyOf(filter.tags, card.tag_ids)) return false;
  if (filter.flags && !((filter.flags.none && card.flags.length === 0) || card.flags.some((flag) => (filter.flags!.values as readonly string[]).includes(flag)))) return false;
  if (filter.due && !matchesDue(filter.due, card.due_on)) return false;
  if (filter.text !== null && !matchesText(card, filter.text)) return false;
  return true;
}

/**
 * Stable sort. `board` is column position, then card position, then id (the
 * board and `list_cards` order). Other keys tie-break on that board order;
 * cards without a due date sort last in both directions.
 */
export function sortCards<T extends QueryCard>(cards: readonly T[], columns: readonly QueryColumn[], sort: CardSort = { key: "board", direction: "asc" }) {
  const columnPosition = new Map(columns.map((column) => [column.id, column.position]));
  const board = (a: T, b: T) => ((columnPosition.get(a.column_id) ?? Infinity) - (columnPosition.get(b.column_id) ?? Infinity))
    || (a.position - b.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sign = sort.direction === "desc" ? -1 : 1;
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byKey: Record<CardSortKey, (a: T, b: T) => number> = {
    board: (a, b) => sign * board(a, b),
    due: (a, b) => {
      if (a.due_on === b.due_on) return board(a, b);
      if (a.due_on === null) return 1;
      if (b.due_on === null) return -1;
      return sign * compare(a.due_on, b.due_on) || board(a, b);
    },
    title: (a, b) => sign * foldText(a.title).localeCompare(foldText(b.title)) || board(a, b),
    created: (a, b) => sign * compare(a.created_at, b.created_at) || board(a, b),
    updated: (a, b) => sign * compare(a.updated_at, b.updated_at) || board(a, b)
  };
  return [...cards].sort(byKey[sort.key]);
}

/** Filters, then sorts: the whole client-side pipeline over a board's cards. */
export function queryCards<T extends QueryCard>(cards: readonly T[], columns: readonly QueryColumn[], filter: CardFilter, context: QueryContext, sort?: CardSort) {
  const normalized = normalizeFilter(filter, context);
  return sortCards(cards.filter((card) => matchesCard(card, normalized)), columns, sort);
}
