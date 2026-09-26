// Pure helpers for cross-board results (My work and views): state and due-bucket words, and the
// grouping of the loaded cards. `board`, `state`, and `due` groups arrive from the server as
// contiguous runs; `assignee` and `tag` group the loaded cards here (API_CONTRACTS § Cross-board).
import { addQueryDays, foldText, TASK_STATES, type TaskState } from "../../../shared/taskQuery";
import type { QueriedCard, QueryRefs } from "./homeApi";
import type { HomeGroup } from "./homeUrl";

export const STATE_LABELS: Record<TaskState, string> = { todo: "To do", doing: "In progress", done: "Done" };
export const DUE_BUCKET_LABELS = { overdue: "Overdue", today: "Today", week: "This week", later: "Later", none: "No due date" } as const;
export type DueBucket = keyof typeof DUE_BUCKET_LABELS;
const DUE_ORDER: DueBucket[] = ["overdue", "today", "week", "later", "none"];

/** The server's due bucket (query.ts GROUP_PARTS.due): before today, today, the next six days, later, none. */
export function dueBucket(card: Pick<QueriedCard, "due_on">, today: string): DueBucket {
  if (!card.due_on) return "none";
  if (card.due_on < today) return "overdue";
  if (card.due_on === today) return "today";
  return card.due_on <= addQueryDays(today, 6) ? "week" : "later";
}

export type ResultGroup = { key: string; label: string; items: Array<{ card: QueriedCard; also: string[] }> };

const byName = (a: string, b: string) => foldText(a).localeCompare(foldText(b));

/**
 * The loaded cards in groups, in the server's order within each group. A card with two assignees
 * or tags is listed in each, marked "also in …". `none` gives one unnamed group.
 */
export function groupResults(cards: readonly QueriedCard[], group: HomeGroup, context: { today: string; userId: string }): ResultGroup[] {
  if (group === "none") return [{ key: "all", label: "", items: cards.map((card) => ({ card, also: [] })) }];
  const labels = new Map<string, string>();
  const keysOf = (card: QueriedCard): string[] => {
    if (group === "board") { labels.set(card.board_id, card.board_name); return [card.board_id]; }
    if (group === "state") { labels.set(card.column_state, STATE_LABELS[card.column_state] ?? card.column_state); return [card.column_state]; }
    if (group === "due") { const bucket = dueBucket(card, context.today); labels.set(bucket, DUE_BUCKET_LABELS[bucket]); return [bucket]; }
    if (group === "assignee") {
      if (!card.assignees.length) { labels.set("none", "No assignee"); return ["none"]; }
      for (const person of card.assignees) labels.set(person.id, person.id === context.userId ? `${person.display_name} (you)` : person.display_name);
      return card.assignees.map((person) => person.id);
    }
    // Tags match by name across boards, as the `tag:` filter does.
    if (!card.tags.length) { labels.set("none", "No tag"); return ["none"]; }
    const keys = card.tags.map((tag) => `name:${foldText(tag.name)}`);
    card.tags.forEach((tag, index) => { if (!labels.has(keys[index]!)) labels.set(keys[index]!, tag.name); });
    return [...new Set(keys)];
  };
  const members = new Map<string, QueriedCard[]>();
  const cardKeys = new Map<string, string[]>();
  for (const card of cards) {
    const keys = keysOf(card);
    cardKeys.set(card.id, keys);
    for (const key of keys) members.set(key, [...(members.get(key) ?? []), card]);
  }
  let order = [...members.keys()];
  if (group === "state") order.sort((a, b) => TASK_STATES.indexOf(a as TaskState) - TASK_STATES.indexOf(b as TaskState));
  else if (group === "due") order.sort((a, b) => DUE_ORDER.indexOf(a as DueBucket) - DUE_ORDER.indexOf(b as DueBucket));
  else if (group === "assignee" || group === "tag") order = order.sort((a, b) => a === "none" ? 1 : b === "none" ? -1 : byName(labels.get(a)!, labels.get(b)!));
  // Boards keep the server's order (board name), which the loaded cards already follow.
  return order.map((key) => ({
    key,
    label: labels.get(key) ?? key,
    items: members.get(key)!.map((card) => ({ card, also: cardKeys.get(card.id)!.filter((other) => other !== key).map((other) => labels.get(other) ?? other) }))
  }));
}

/** The board layout's three lanes (normalized state); no drag between them (Q9, D143). */
export function stateLanes(cards: readonly QueriedCard[]) {
  return TASK_STATES.map((state) => ({ state, label: STATE_LABELS[state], cards: cards.filter((card) => card.column_state === state) }));
}

/** Names for the ids a filter carries, per viewer: restricted ones are never named (T116). */
export type RefNames = {
  board: (id: string) => string;
  column: (id: string) => string;
  tag: (value: string) => string;
  user: (id: string) => string;
};

export const RESTRICTED_BOARD = "Restricted board";
export const RESTRICTED_COLUMN = "Restricted column";
export const RESTRICTED_TAG = "Restricted tag";
export const UNKNOWN_PERSON = "Unknown person";

/**
 * Resolves filter ids with the query's `refs` first, then what the viewer already knows (their
 * boards and the user list). A restricted ref stays restricted whatever else is known.
 */
export function refNames(refs: QueryRefs | undefined, known: { boards?: ReadonlyMap<string, string>; users?: ReadonlyMap<string, string>; userId: string }): RefNames {
  const boards = new Map<string, string | null>();
  const columns = new Map<string, string | null>();
  const tags = new Map<string, string | null>();
  const users = new Map<string, string | null>();
  for (const item of refs?.boards ?? []) boards.set(item.id, "restricted" in item ? null : item.name);
  for (const item of refs?.columns ?? []) columns.set(item.id, "restricted" in item ? null : item.name);
  for (const item of refs?.tags ?? []) tags.set(item.id, "restricted" in item ? null : item.name);
  for (const item of refs?.users ?? []) users.set(item.id, "unknown" in item ? null : item.display_name);
  return {
    board: (id) => boards.has(id) ? boards.get(id) ?? RESTRICTED_BOARD : known.boards?.get(id) ?? RESTRICTED_BOARD,
    column: (id) => columns.get(id) ?? RESTRICTED_COLUMN,
    tag: (value) => value === "none" ? "No tag" : tags.has(value) ? tags.get(value) ?? RESTRICTED_TAG : /^[0-9a-f-]{36}$/i.test(value) ? RESTRICTED_TAG : value,
    user: (id) => {
      if (id === "me") return "Me";
      if (id === "none") return "No assignee";
      const name = users.has(id) ? users.get(id) : known.users?.get(id);
      if (!name) return UNKNOWN_PERSON;
      return id === known.userId ? `${name} (you)` : name;
    }
  };
}
