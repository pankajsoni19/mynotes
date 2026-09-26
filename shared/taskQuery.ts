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
 *   cards only. The relative `buckets` (13E: overdue, today, this week) are
 *   OR-ed with the range and `none`; they need the viewer's `today` in the
 *   context and never match without it (the server does not send them).
 * - `relations` (13E): `any` (a relation), `blocked` (an open blocker),
 *   `none` (no relation), from the board JSON's per-viewer counts.
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
  /** 13E: the UTC instant of a timed card, for the relative due buckets. */
  due_at?: string | null;
  /** 13E (13D payload): relations and open blockers the viewer can see. */
  relation_count?: number;
  open_blockers?: number;
};
export type QueryColumn = { id: string; position: number };

/** Relative due buckets (13E): they need the viewer's clock and zone (`QueryContext.today`). */
export const DUE_BUCKETS = ["overdue", "today", "week"] as const;
export type DueBucket = typeof DUE_BUCKETS[number];
/** Relation filters (13E, §4.6): any relation, an open blocker (`open_blockers` > 0), or none. */
export const RELATION_FILTERS = ["any", "blocked", "none"] as const;
export type RelationFilter = typeof RELATION_FILTERS[number];

export type CardFilter = {
  assignees?: readonly string[];
  tags?: readonly string[];
  flags?: ReadonlyArray<TaskFlag | "none">;
  /** `buckets` (13E) are OR-ed with the date range and `none`. */
  due?: { before?: string; after?: string; none?: boolean; buckets?: readonly DueBucket[] };
  columns?: readonly string[];
  /** 13E: client-side only (the board JSON carries `relation_count` and `open_blockers`). */
  relations?: readonly RelationFilter[];
  text?: string;
};

export const CARD_SORT_KEYS = ["board", "due", "title", "created", "updated"] as const;
export type CardSortKey = typeof CARD_SORT_KEYS[number];
export type CardSort = { key: CardSortKey; direction: "asc" | "desc" };

/**
 * `today` (the viewer's local date), `now` (ms), and `timeZone` (IANA) are for the relative due
 * buckets (13E); without `today` a bucket matches nothing.
 */
export type QueryContext = { userId: string; today?: string; now?: number; timeZone?: string };

/** A filter with `me` resolved, ids lower-cased and deduplicated, and `none` split out. */
export type NormalizedFilter = {
  assignees: { ids: string[]; none: boolean } | null;
  tags: { ids: string[]; none: boolean } | null;
  flags: { values: TaskFlag[]; none: boolean } | null;
  due: { before: string | null; after: string | null; none: boolean } | null;
  columns: string[] | null;
  text: string | null;
  /** 13E: relative due buckets with the viewer's clock, OR-ed with `due`. */
  dueBuckets: { values: DueBucket[]; today: string | null; now: number; timeZone: string | null } | null;
  /** 13E: relation filters (OR-ed). */
  relations: RelationFilter[] | null;
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
    text,
    dueBuckets: filter.due?.buckets?.length
      ? { values: DUE_BUCKETS.filter((bucket) => filter.due!.buckets!.includes(bucket)), today: context.today ?? null, now: context.now ?? Date.now(), timeZone: context.timeZone ?? null }
      : null,
    relations: filter.relations?.length ? RELATION_FILTERS.filter((value) => filter.relations!.includes(value)) : null
  };
}

const dayNumber = (date: string) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};
const fromDayNumber = (value: number) => new Date(value * 86_400_000).toISOString().slice(0, 10);

/** The last day (Sunday) of the Monday-first week holding `today`. */
export function weekEnd(today: string) {
  const number = dayNumber(today);
  const weekday = (new Date(number * 86_400_000).getUTCDay() + 6) % 7;
  return fromDayNumber(number + 6 - weekday);
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
/**
 * The day a card is due for the viewer: the viewer-local date of `due_at` for a timed card (when
 * a zone is given), otherwise its civil `due_on`.
 */
export function viewerDueDate(card: Pick<QueryCard, "due_on" | "due_at">, timeZone?: string | null) {
  if (!card.due_on) return null;
  if (!card.due_at || !timeZone) return card.due_on;
  const at = Date.parse(card.due_at);
  if (!Number.isFinite(at)) return card.due_on;
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      return card.due_on;
    }
    zoneFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

/**
 * The one due group a card falls in for the viewer (the grouped list's buckets): overdue (a
 * timed card once its instant passed, a dated card from the day after), today, the rest of this
 * week, later, or no date.
 */
export function dueGroupOf(card: Pick<QueryCard, "due_on" | "due_at">, context: { today: string; now?: number; timeZone?: string | null }): DueGroup {
  const day = viewerDueDate(card, context.timeZone);
  if (!day) return "none";
  const at = card.due_at ? Date.parse(card.due_at) : Number.NaN;
  if (Number.isFinite(at) ? at <= (context.now ?? Date.now()) : day < context.today) return "overdue";
  if (day === context.today) return "today";
  return day <= weekEnd(context.today) ? "week" : "later";
}

/** Whether a card is in any of the filter's relative buckets (`week` runs from today to Sunday). */
function matchesBuckets(buckets: NonNullable<NormalizedFilter["dueBuckets"]>, card: QueryCard) {
  if (buckets.today === null) return false;
  const day = viewerDueDate(card, buckets.timeZone);
  if (!day) return false;
  return buckets.values.some((bucket) => {
    if (bucket === "overdue") return dueGroupOf(card, { today: buckets.today!, now: buckets.now, timeZone: buckets.timeZone }) === "overdue";
    if (bucket === "today") return day === buckets.today;
    return day >= buckets.today! && day <= weekEnd(buckets.today!);
  });
}

function matchesRelations(values: RelationFilter[], card: QueryCard) {
  const count = card.relation_count ?? 0;
  return values.some((value) => value === "any" ? count > 0 : value === "blocked" ? (card.open_blockers ?? 0) > 0 : count === 0);
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
  if ((filter.due || filter.dueBuckets) && !((filter.due !== null && matchesDue(filter.due, card.due_on)) || (filter.dueBuckets !== null && matchesBuckets(filter.dueBuckets, card)))) return false;
  if (filter.relations && !matchesRelations(filter.relations, card)) return false;
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

// ---------------------------------------------------------------------------
// URL grammar (13E, §4.6, T102): the board filter bar keeps its filters in the
// URL query. This is the one encoding of a `CardFilter` as query parameters;
// `src/tasks/boardUrl.ts` adds the presentation keys (view, group, sort, cal,
// month) around it. Decoding is strict and never throws: unknown keys and
// invalid values are dropped, ids must be UUIDs, at most `QUERY_LIMITS.values`
// values are kept in total, and `q` is capped at `QUERY_LIMITS.textMax`
// characters. Encoding is canonical: keys in `FILTER_PARAM_KEYS` order and
// values sorted, so the same filter always gives the same URL.

/** Query keys of the filter grammar, in canonical order. */
export const FILTER_PARAM_KEYS = ["assignee", "tag", "flag", "due", "column", "rel", "q"] as const;
export type FilterParamKey = typeof FILTER_PARAM_KEYS[number];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A UUID as the server issues them (case-insensitive). */
export const isQueryId = (value: string) => uuidPattern.test(value);

/** A real calendar date `YYYY-MM-DD` from 1900 to 2999 (the server's `dueOn` range). */
export function isQueryDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Control, bidi, and other format characters never reach the text filter.
const unsafeText = /[\p{Cc}\p{Cf}]/gu;

/** The text filter as the URL keeps it: unsafe characters removed, trimmed, at most 100 characters. */
export function cleanFilterText(value: string) {
  return value.replace(unsafeText, "").trim().slice(0, QUERY_LIMITS.textMax).trim();
}

/** Whether a filter selects anything (an empty filter shows every card). */
export function isEmptyFilter(filter: CardFilter) {
  return !filter.assignees?.length && !filter.tags?.length && !filter.flags?.length && !filter.columns?.length && !filter.relations?.length
    && !filter.text?.trim() && !(filter.due && (filter.due.before || filter.due.after || filter.due.none || filter.due.buckets?.length));
}

/** One filter value as a URL value, or null when it is not valid for its key. */
function decodeValue(key: FilterParamKey, raw: string): string | null {
  const value = raw.trim();
  switch (key) {
    case "assignee": return value === "me" || value === "none" ? value : isQueryId(value) ? value.toLowerCase() : null;
    case "tag": return value === "none" ? value : isQueryId(value) ? value.toLowerCase() : null;
    case "flag": return value === "none" || (TASK_FLAGS as readonly string[]).includes(value) ? value : null;
    case "column": return isQueryId(value) ? value.toLowerCase() : null;
    case "rel": return (RELATION_FILTERS as readonly string[]).includes(value) ? value : null;
    case "due": {
      if (value === "none" || (DUE_BUCKETS as readonly string[]).includes(value)) return value;
      const match = /^(before|after):(.+)$/.exec(value);
      return match && isQueryDate(match[2]!) ? value : null;
    }
    case "q": return null;
  }
}

/**
 * Reads the filter keys of a query (a `URLSearchParams` or its entries). Other keys are
 * ignored. For `due`, at most one `before:` and one `after:` bound is kept (the first valid one).
 */
export function parseFilterParams(entries: Iterable<[string, string]>): CardFilter {
  const values = new Map<FilterParamKey, Set<string>>();
  let text = "";
  let count = 0;
  let before: string | null = null;
  let after: string | null = null;
  for (const [key, raw] of entries) {
    if (!(FILTER_PARAM_KEYS as readonly string[]).includes(key) || typeof raw !== "string" || raw.length > 200) continue;
    const name = key as FilterParamKey;
    if (name === "q") {
      if (!text) text = cleanFilterText(raw);
      continue;
    }
    const value = decodeValue(name, raw);
    if (value === null || count >= QUERY_LIMITS.values) continue;
    if (name === "due" && value.startsWith("before:")) {
      if (before !== null) continue;
      before = value;
    } else if (name === "due" && value.startsWith("after:")) {
      if (after !== null) continue;
      after = value;
    }
    const set = values.get(name) ?? new Set<string>();
    if (set.has(value)) continue;
    set.add(value);
    values.set(name, set);
    count += 1;
  }
  const list = (key: FilterParamKey) => [...(values.get(key) ?? [])].sort();
  const filter: CardFilter = {};
  if (values.has("assignee")) filter.assignees = list("assignee");
  if (values.has("tag")) filter.tags = list("tag");
  if (values.has("flag")) filter.flags = list("flag") as Array<TaskFlag | "none">;
  if (values.has("column")) filter.columns = list("column");
  if (values.has("rel")) filter.relations = list("rel") as RelationFilter[];
  if (values.has("due")) {
    const due = list("due");
    const buckets = due.filter((value): value is DueBucket => (DUE_BUCKETS as readonly string[]).includes(value));
    filter.due = {
      ...(before ? { before: before.slice(7) } : {}),
      ...(after ? { after: after.slice(6) } : {}),
      ...(due.includes("none") ? { none: true } : {}),
      ...(buckets.length ? { buckets } : {})
    };
  }
  if (text) filter.text = text;
  return filter;
}

/**
 * The canonical query entries of a filter: keys in `FILTER_PARAM_KEYS` order, values
 * deduplicated and sorted, invalid values dropped, and at most 30 values in total, so
 * `parseFilterParams(filterParams(f))` is stable.
 */
export function filterParams(filter: CardFilter): Array<[FilterParamKey, string]> {
  const raw: Array<[FilterParamKey, string]> = [];
  for (const value of filter.assignees ?? []) raw.push(["assignee", value]);
  for (const value of filter.tags ?? []) raw.push(["tag", value]);
  for (const value of filter.flags ?? []) raw.push(["flag", value]);
  if (filter.due?.before) raw.push(["due", `before:${filter.due.before}`]);
  if (filter.due?.after) raw.push(["due", `after:${filter.due.after}`]);
  if (filter.due?.none) raw.push(["due", "none"]);
  for (const value of filter.due?.buckets ?? []) raw.push(["due", value]);
  for (const value of filter.columns ?? []) raw.push(["column", value]);
  for (const value of filter.relations ?? []) raw.push(["rel", value]);
  if (filter.text) raw.push(["q", filter.text]);
  // Round-trip through the decoder so the output is exactly what a reader would keep.
  const clean = parseFilterParams(raw);
  const entries: Array<[FilterParamKey, string]> = [];
  for (const value of clean.assignees ?? []) entries.push(["assignee", value]);
  for (const value of clean.tags ?? []) entries.push(["tag", value]);
  for (const value of clean.flags ?? []) entries.push(["flag", value]);
  const due = [
    ...(clean.due?.after ? [`after:${clean.due.after}`] : []),
    ...(clean.due?.before ? [`before:${clean.due.before}`] : []),
    ...(clean.due?.none ? ["none"] : []),
    ...(clean.due?.buckets ?? [])
  ].sort();
  for (const value of due) entries.push(["due", value]);
  for (const value of clean.columns ?? []) entries.push(["column", value]);
  for (const value of clean.relations ?? []) entries.push(["rel", value]);
  if (clean.text) entries.push(["q", clean.text]);
  return entries;
}
