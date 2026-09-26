// One pipeline for every board view (WAVE_13_TASK_CARD_UX.md §4.5, D113): filter with the shared
// grammar (shared/taskQuery.ts), sort, then group for the list view. Pure, no DOM access.
//
// Grouping and the filter bar run through two registries, GROUP_DIMENSIONS and FILTER_FIELDS. The
// hierarchy wave (migration 019) adds `parent` and `sprint` entries to both (and to BOARD_GROUPS
// in boardUrl.ts); the router, the filter bar, and the views need no rework.
import { dueGroupOf, foldText, queryCards, sortCards, TASK_FLAGS, type CardFilter, type CardSortKey, type DueGroup, type FilterParamKey, type QueryCard, type RelationFilter, type TaskFlag } from "../../shared/taskQuery";
import { byPosition } from "./boardOrder";
import type { BoardGroupId, BoardQuery, BoardSort } from "./boardUrl";
import { cardAssignees } from "./taskActions";
import type { BoardColumn, BoardDetail, CardAssignee, CardSummary } from "./tasksApi";

/** A board tag (13C, `GET /boards/:b` → `tags`). */
export type BoardTag = { id: string; board_id?: string; name: string; color: string; card_count?: number };

/**
 * The card fields the views read. 13C and 13D added `description_excerpt`, `tag_ids`, `flags`,
 * `relation_count`, and `open_blockers` to the board payload; they are optional here so an older
 * payload still renders.
 */
export type BoardCardInput = CardSummary & Partial<{ description_excerpt: string; tag_ids: string[]; flags: string[]; relation_count: number; open_blockers: number }>;
export type BoardCard = CardSummary & QueryCard & { assignees: CardAssignee[]; tag_ids: string[]; flags: string[] };
export type BoardData = { columns: BoardColumn[]; cards: BoardCard[]; tags: BoardTag[] };

/** The viewer: `today` is their local date, `now` their clock, `timeZone` their zone (for timed cards). */
export type BoardContext = { userId: string; today: string; now: number; timeZone: string };

/** Fills the optional payload fields, so every view reads one shape. */
export function boardData(detail: Pick<BoardDetail, "columns" | "cards"> & { tags?: BoardTag[] }): BoardData {
  return {
    columns: [...detail.columns].sort(byPosition),
    tags: detail.tags ?? [],
    cards: (detail.cards as BoardCardInput[]).map((card) => ({
      ...card,
      description_excerpt: card.description_excerpt ?? "",
      tag_ids: card.tag_ids ?? [],
      flags: card.flags ?? [],
      assignees: cardAssignees(card) as CardAssignee[]
    }))
  };
}

export const FLAG_LABELS: Record<TaskFlag, string> = { urgent: "Urgent", blocked: "Blocked", needs_review: "Needs review", on_hold: "On hold" };
export const DUE_GROUP_LABELS: Record<DueGroup, string> = { overdue: "Overdue", today: "Today", week: "This week", later: "Later", none: "No date" };
export const UNKNOWN_TAG = "Unknown tag";
export const UNKNOWN_PERSON = "Unknown person";

const byName = (a: string, b: string) => foldText(a).localeCompare(foldText(b));

/** Every assignee name the board's cards carry, by id. */
function peopleOf(board: BoardData) {
  const people = new Map<string, string>();
  for (const card of board.cards) for (const person of card.assignees) if (!people.has(person.id)) people.set(person.id, person.display_name);
  return people;
}

export function personLabel(id: string, board: BoardData, context: Pick<BoardContext, "userId">) {
  if (id === "none") return "No assignee";
  if (id === "me" || id === context.userId) return id === "me" ? "Me" : `${peopleOf(board).get(id) ?? "You"} (you)`;
  return peopleOf(board).get(id) ?? UNKNOWN_PERSON;
}

export function tagLabel(id: string, board: BoardData) {
  if (id === "none") return "No tag";
  return board.tags.find((tag) => tag.id === id)?.name ?? UNKNOWN_TAG;
}

export const flagLabel = (value: string) => value === "none" ? "No flag" : FLAG_LABELS[value as TaskFlag] ?? value;

export type GroupDimension = {
  label: string;
  /** The groups a card belongs to; a card with two assignees or tags is in each of them. */
  keysFor: (card: BoardCard, board: BoardData, context: BoardContext) => string[];
  labelFor: (key: string, board: BoardData, context: BoardContext) => string;
  /** Group order; `always` lists groups shown even when empty (the board's columns). */
  order: (keys: string[], board: BoardData, context: BoardContext) => string[];
  always?: (board: BoardData) => string[];
};

const noneLast = (compare: (a: string, b: string) => number) => (a: string, b: string) => a === "none" ? 1 : b === "none" ? -1 : compare(a, b);

export const GROUP_DIMENSIONS: Record<BoardGroupId, GroupDimension> = {
  column: {
    label: "Column",
    keysFor: (card) => [card.column_id],
    labelFor: (key, board) => board.columns.find((column) => column.id === key)?.name ?? "Column",
    order: (keys, board) => {
      const index = new Map(board.columns.map((column, at) => [column.id, at]));
      return [...keys].sort((a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity));
    },
    always: (board) => board.columns.map((column) => column.id)
  },
  assignee: {
    label: "Assignee",
    keysFor: (card) => card.assignees.length ? card.assignees.map((person) => person.id) : ["none"],
    labelFor: (key, board, context) => personLabel(key, board, context),
    order: (keys, board, context) => [...keys].sort(noneLast((a, b) => byName(personLabel(a, board, context), personLabel(b, board, context))))
  },
  tag: {
    label: "Tag",
    keysFor: (card) => card.tag_ids.length ? card.tag_ids : ["none"],
    labelFor: (key, board) => tagLabel(key, board),
    order: (keys, board) => [...keys].sort(noneLast((a, b) => byName(tagLabel(a, board), tagLabel(b, board))))
  },
  flag: {
    label: "Flag",
    keysFor: (card) => card.flags.length ? card.flags : ["none"],
    labelFor: (key) => flagLabel(key),
    order: (keys) => [...keys].sort(noneLast((a, b) => TASK_FLAGS.indexOf(a as TaskFlag) - TASK_FLAGS.indexOf(b as TaskFlag)))
  },
  due: {
    label: "Due date",
    keysFor: (card, _board, context) => [dueGroupOf(card, context)],
    labelFor: (key) => DUE_GROUP_LABELS[key as DueGroup] ?? key,
    order: (keys) => {
      const order: DueGroup[] = ["overdue", "today", "week", "later", "none"];
      return [...keys].sort((a, b) => order.indexOf(a as DueGroup) - order.indexOf(b as DueGroup));
    }
  }
};

export type FilterOption = { value: string; label: string; swatch?: string };

/**
 * A field of the filter bar. `get` and `set` read and write its values in the shared filter;
 * `match` is only for a field outside the shared grammar (applied after it). Values within a field
 * are OR-ed and fields are AND-ed (§4.6).
 */
export type FilterField = {
  label: string;
  param: FilterParamKey | string;
  get: (filter: CardFilter) => readonly string[];
  set: (filter: CardFilter, values: string[]) => CardFilter;
  optionsFor: (board: BoardData, context: BoardContext) => FilterOption[];
  labelFor: (value: string, board: BoardData, context: BoardContext) => string;
  match?: (card: BoardCard, values: readonly string[], board: BoardData) => boolean;
};

/** Sets or removes one key of a filter (an empty list removes it). */
function withKey<K extends keyof CardFilter>(filter: CardFilter, key: K, value: CardFilter[K] | undefined): CardFilter {
  const next = { ...filter };
  if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
  else next[key] = value;
  return next;
}

/** The due field's values as the URL spells them (`before:…`, `after:…`, `none`, buckets). */
export function dueValues(filter: CardFilter): string[] {
  const due = filter.due;
  if (!due) return [];
  return [...(due.buckets ?? []), ...(due.before ? [`before:${due.before}`] : []), ...(due.after ? [`after:${due.after}`] : []), ...(due.none ? ["none"] : [])];
}

function withDueValues(filter: CardFilter, values: string[]): CardFilter {
  const buckets = values.filter((value) => value === "overdue" || value === "today" || value === "week") as Array<"overdue" | "today" | "week">;
  const before = values.find((value) => value.startsWith("before:"))?.slice(7);
  const after = values.find((value) => value.startsWith("after:"))?.slice(6);
  const due = { ...(before ? { before } : {}), ...(after ? { after } : {}), ...(values.includes("none") ? { none: true } : {}), ...(buckets.length ? { buckets } : {}) };
  return withKey(filter, "due", Object.keys(due).length ? due : undefined);
}

const shortDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
};

export function dueValueLabel(value: string) {
  if (value.startsWith("before:")) return `before ${shortDate(value.slice(7))}`;
  if (value.startsWith("after:")) return `after ${shortDate(value.slice(6))}`;
  return { overdue: "overdue", today: "today", week: "this week", none: "no date" }[value] ?? value;
}

export const RELATION_LABELS: Record<RelationFilter, string> = { any: "has relations", blocked: "is blocked", none: "has no relations" };

export const FILTER_FIELDS: Record<string, FilterField> = {
  assignee: {
    label: "Assignee",
    param: "assignee",
    get: (filter) => filter.assignees ?? [],
    set: (filter, values) => withKey(filter, "assignees", values),
    optionsFor: (board, context) => [
      { value: "me", label: "Me" },
      ...[...peopleOf(board).entries()].filter(([id]) => id !== context.userId).map(([id, name]) => ({ value: id, label: name })).sort((a, b) => byName(a.label, b.label)),
      { value: "none", label: "No assignee" }
    ],
    labelFor: (value, board, context) => personLabel(value, board, context)
  },
  tag: {
    label: "Tag",
    param: "tag",
    get: (filter) => filter.tags ?? [],
    set: (filter, values) => withKey(filter, "tags", values),
    optionsFor: (board) => [...[...board.tags].sort((a, b) => byName(a.name, b.name)).map((tag) => ({ value: tag.id, label: tag.name, swatch: tag.color })), { value: "none", label: "No tag" }],
    labelFor: (value, board) => tagLabel(value, board)
  },
  flag: {
    label: "Flag",
    param: "flag",
    get: (filter) => filter.flags ?? [],
    set: (filter, values) => withKey(filter, "flags", values as Array<TaskFlag | "none">),
    optionsFor: () => [...TASK_FLAGS.map((flag) => ({ value: flag, label: FLAG_LABELS[flag] })), { value: "none", label: "No flag" }],
    labelFor: (value) => flagLabel(value)
  },
  due: {
    label: "Due",
    param: "due",
    get: dueValues,
    set: withDueValues,
    optionsFor: () => [{ value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "none", label: "No date" }],
    labelFor: (value) => dueValueLabel(value)
  },
  column: {
    label: "Column",
    param: "column",
    get: (filter) => filter.columns ?? [],
    set: (filter, values) => withKey(filter, "columns", values),
    optionsFor: (board) => board.columns.map((column) => ({ value: column.id, label: column.name })),
    labelFor: (value, board) => board.columns.find((column) => column.id === value)?.name ?? "Unknown column"
  },
  rel: {
    label: "Relations",
    param: "rel",
    get: (filter) => filter.relations ?? [],
    set: (filter, values) => withKey(filter, "relations", values as RelationFilter[]),
    optionsFor: () => [{ value: "any", label: "Has relations" }, { value: "blocked", label: "Is blocked" }, { value: "none", label: "Has no relations" }],
    labelFor: (value) => RELATION_LABELS[value as RelationFilter] ?? value
  }
};

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Sorts by a table column. `title`, `due`, `created`, and `updated` are the shared sort; the rest tie-break on board order. */
export function sortBoardCards(cards: readonly BoardCard[], board: BoardData, sort: BoardSort | null): BoardCard[] {
  if (!sort) return sortCards(cards, board.columns);
  const shared: Partial<Record<BoardSort["field"], CardSortKey>> = { title: "title", due: "due", created: "created", updated: "updated", column: "board" };
  const key = shared[sort.field];
  if (key) return sortCards(cards, board.columns, { key, direction: sort.direction });
  const inBoardOrder = sortCards(cards, board.columns);
  const rank = new Map(inBoardOrder.map((card, index) => [card.id, index]));
  const sign = sort.direction === "desc" ? -1 : 1;
  // The first value of a multi-valued field; empty cards sort last both ways.
  const first = (card: BoardCard): string | null => {
    if (sort.field === "assignees") return card.assignees[0] ? foldText(card.assignees[0].display_name) : null;
    if (sort.field === "tags") return card.tag_ids[0] ? foldText(tagLabel(card.tag_ids[0], board)) : null;
    const flags = card.flags.map((flag) => TASK_FLAGS.indexOf(flag as TaskFlag)).filter((index) => index >= 0).sort();
    return flags.length ? String(flags[0]) : null;
  };
  return [...inBoardOrder].sort((a, b) => {
    const left = first(a);
    const right = first(b);
    if (left === right) return rank.get(a.id)! - rank.get(b.id)!;
    if (left === null) return 1;
    if (right === null) return -1;
    return sign * compareText(left, right) || rank.get(a.id)! - rank.get(b.id)!;
  });
}

export type BoardGroup = {
  key: string;
  label: string;
  /** Each card, with the labels of the other groups it also appears in ("also in …"). */
  items: Array<{ card: BoardCard; also: string[] }>;
};

export type BoardQueryResult = { cards: BoardCard[]; groups: BoardGroup[] | null };

export type BoardRegistries = { groups: Record<string, GroupDimension>; filters: Record<string, FilterField> };
export const BOARD_REGISTRIES: BoardRegistries = { groups: GROUP_DIMENSIONS, filters: FILTER_FIELDS };

/**
 * The cards a view shows, in order, and for the list view their groups. Filters run first with
 * the shared grammar (and any registry field with its own `match`), then the sort, then grouping
 * (`query.group`, by column by default).
 */
export function applyBoardQuery(board: BoardData, query: Pick<BoardQuery, "view" | "group" | "sort" | "filter"> & { extra?: Record<string, readonly string[]> }, context: BoardContext, registries: BoardRegistries = BOARD_REGISTRIES): BoardQueryResult {
  let cards = queryCards(board.cards, board.columns, query.filter, { userId: context.userId, today: context.today, now: context.now, timeZone: context.timeZone });
  for (const [id, values] of Object.entries(query.extra ?? {})) {
    const field = registries.filters[id];
    if (field?.match && values.length) cards = cards.filter((card) => field.match!(card, values, board));
  }
  const sorted = sortBoardCards(cards, board, query.sort);
  if (query.view !== "list") return { cards: sorted, groups: null };
  const dimension = registries.groups[query.group ?? "column"] ?? registries.groups.column!;
  const members = new Map<string, BoardCard[]>();
  for (const key of dimension.always?.(board) ?? []) members.set(key, []);
  const keysOf = new Map<string, string[]>();
  for (const card of sorted) {
    const keys = [...new Set(dimension.keysFor(card, board, context))];
    keysOf.set(card.id, keys);
    for (const key of keys) {
      const list = members.get(key) ?? [];
      list.push(card);
      members.set(key, list);
    }
  }
  const labels = new Map([...members.keys()].map((key) => [key, dimension.labelFor(key, board, context)]));
  const groups = dimension.order([...members.keys()], board, context).map((key) => ({
    key,
    label: labels.get(key)!,
    items: members.get(key)!.map((card) => ({ card, also: keysOf.get(card.id)!.filter((other) => other !== key).map((other) => labels.get(other)!) }))
  }));
  return { cards: sorted, groups };
}
