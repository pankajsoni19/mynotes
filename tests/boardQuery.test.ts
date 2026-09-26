import { expect, test } from "bun:test";
import { dueGroupOf, weekEnd, viewerDueDate } from "../shared/taskQuery";
import { applyBoardQuery, boardData, BOARD_REGISTRIES, dueValues, FILTER_FIELDS, GROUP_DIMENSIONS, sortBoardCards, type BoardCard, type BoardContext, type BoardData, type GroupDimension } from "../src/tasks/boardQuery";
import { DEFAULT_BOARD_QUERY, parseBoardSearch, type BoardQuery } from "../src/tasks/boardUrl";
import type { CardSummary } from "../src/tasks/tasksApi";

// WAVE_13_TASK_CARD_UX.md §4.5 (one pipeline, two registries), §4.6, §7 `tests/boardQuery.test.ts`.
const me = "11111111-1111-4111-8111-111111111111";
const asha = "22222222-2222-4222-8222-222222222222";
const ben = "33333333-3333-4333-8333-333333333333";
const todo = "aaaaaaaa-0000-4000-8000-000000000001";
const doing = "aaaaaaaa-0000-4000-8000-000000000002";
const done = "aaaaaaaa-0000-4000-8000-000000000003";
const backend = "bbbbbbbb-0000-4000-8000-000000000001";
const design = "bbbbbbbb-0000-4000-8000-000000000002";

const person = (id: string, name: string) => ({ id, display_name: name, can_read: 1 as const });
function card(id: string, change: Partial<CardSummary> & Record<string, unknown> = {}): CardSummary {
  return {
    id, board_id: "b", column_id: todo, position: 1, title: id, has_description: 0, revision: 1, created_by: me, creator_name: "Me",
    due_on: null, assignees: [], assignee_id: null, assignee_name: null, comment_count: 0, attachment_count: 0,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", ...change
  } as CardSummary;
}

const column = (id: string, name: string, position: number) => ({ id, board_id: "b", name, position, is_done: 0 as const, created_at: "", updated_at: "" });
const board: BoardData = boardData({
  columns: [column(done, "Done", 3072), column(todo, "To do", 1024), column(doing, "Doing", 2048)],
  tags: [{ id: backend, name: "Backend", color: "blue" }, { id: design, name: "Design", color: "pink" }],
  cards: [
    card("login", { title: "Fix login", position: 1, assignees: [person(asha, "Asha"), person(ben, "Ben")], tag_ids: [backend, design], flags: ["urgent"], due_on: "2026-09-25", description_excerpt: "Crème brûlée recipe", relation_count: 2, open_blockers: 1 }),
    card("docs", { title: "Écrire docs", position: 2, assignees: [person(me, "Pat")], tag_ids: [design], due_on: "2026-09-26", created_at: "2026-09-03T00:00:00.000Z" }),
    card("api", { title: "api keys", column_id: doing, position: 1, flags: ["blocked", "on_hold"], due_on: "2026-09-27", due_time: "23:30", due_tz: "Pacific/Kiritimati", due_at: "2026-09-27T09:30:00.000Z", relation_count: 1, open_blockers: 0 }),
    card("ship", { title: "Ship", column_id: done, position: 1, assignees: [person(ben, "Ben")], due_on: "2026-10-10", updated_at: "2026-09-20T00:00:00.000Z" }),
    card("idea", { title: "Idea", column_id: doing, position: 2 })
  ]
});
// Saturday 26 September 2026 at 12:00 UTC, viewer in UTC.
const context: BoardContext = { userId: me, today: "2026-09-26", now: Date.parse("2026-09-26T12:00:00.000Z"), timeZone: "UTC" };
const ids = (cards: readonly BoardCard[]) => cards.map((item) => item.id);
const run = (search: string, change: Partial<BoardContext> = {}) => ids(applyBoardQuery(board, parseBoardSearch(search), { ...context, ...change }).cards);

test("boardData fills the optional payload fields and orders columns", () => {
  const plain = boardData({ columns: [column(todo, "To do", 1)], cards: [card("x", { assignees: undefined, assignee_id: asha, assignee_name: "Asha" })] });
  expect(plain.cards[0]).toMatchObject({ description_excerpt: "", tag_ids: [], flags: [], assignees: [{ id: asha, display_name: "Asha", can_read: 1 }] });
  expect(plain.tags).toEqual([]);
  expect(board.columns.map((item) => item.name)).toEqual(["To do", "Doing", "Done"]);
});

test("each filter field, with me and none, OR within a field and AND across fields", () => {
  expect(run("")).toEqual(["login", "docs", "api", "idea", "ship"]);
  expect(run("?assignee=me")).toEqual(["docs"]);
  expect(run(`?assignee=${ben}`)).toEqual(["login", "ship"]);
  expect(run("?assignee=none")).toEqual(["api", "idea"]);
  expect(run(`?assignee=me&assignee=${asha}`)).toEqual(["login", "docs"]);
  expect(run(`?tag=${design}`)).toEqual(["login", "docs"]);
  expect(run("?tag=none")).toEqual(["api", "idea", "ship"]);
  expect(run("?flag=on_hold&flag=urgent")).toEqual(["login", "api"]);
  expect(run("?flag=none")).toEqual(["docs", "idea", "ship"]);
  expect(run(`?column=${doing}`)).toEqual(["api", "idea"]);
  expect(run("?rel=any")).toEqual(["login", "api"]);
  expect(run("?rel=blocked")).toEqual(["login"]);
  expect(run("?rel=none")).toEqual(["docs", "idea", "ship"]);
  expect(run("?due=before:2026-09-27")).toEqual(["login", "docs"]);
  expect(run("?due=after:2026-09-26&due=before:2026-10-10")).toEqual(["api"]);
  expect(run("?due=none")).toEqual(["idea"]);
  // AND across fields.
  expect(run(`?tag=${design}&assignee=me`)).toEqual(["docs"]);
  expect(run(`?tag=${design}&flag=blocked`)).toEqual([]);
  // A tag id no card carries matches nothing (it renders as "Unknown tag").
  expect(run("?tag=bbbbbbbb-0000-4000-8000-00000000ffff")).toEqual([]);
});

test("text matches the title and excerpt, ignoring case and accents", () => {
  expect(run("?q=ECRIRE")).toEqual(["docs"]);
  expect(run("?q=creme brulee")).toEqual(["login"]);
  expect(run("?q=KEYS")).toEqual(["api"]);
  expect(run("?q=zzz")).toEqual([]);
});

test("relative due buckets use the viewer's day, across midnight and zones", () => {
  expect(weekEnd("2026-09-26")).toBe("2026-09-27");
  expect(weekEnd("2026-09-27")).toBe("2026-09-27");
  expect(weekEnd("2026-09-21")).toBe("2026-09-27");
  // api is due 23:30 on the 27th at UTC+14: the 27th 09:30 UTC.
  expect(viewerDueDate(board.cards[2]!, "UTC")).toBe("2026-09-27");
  expect(viewerDueDate(board.cards[2]!, "Etc/GMT+12")).toBe("2026-09-26");
  expect(run("?due=overdue")).toEqual(["login"]);
  expect(run("?due=today")).toEqual(["docs"]);
  expect(run("?due=week")).toEqual(["docs", "api"]);
  // For a UTC−12 viewer the timed card falls on their today.
  expect(run("?due=today", { timeZone: "Etc/GMT+12" })).toEqual(["docs", "api"]);
  // Once its instant passed, a timed card is overdue even on its own day.
  expect(run("?due=overdue", { now: Date.parse("2026-09-27T10:00:00.000Z"), today: "2026-09-27" })).toEqual(["login", "docs", "api"]);
  // Just before midnight the date-only card is still due today; at midnight it is overdue.
  expect(dueGroupOf({ due_on: "2026-09-26", due_at: null }, { today: "2026-09-26" })).toBe("today");
  expect(dueGroupOf({ due_on: "2026-09-26", due_at: null }, { today: "2026-09-27" })).toBe("overdue");
  expect(run("?due=overdue&due=none")).toEqual(["login", "idea"]);
  // Buckets OR with the date range.
  expect(run("?due=today&due=after:2026-10-01")).toEqual(["docs", "ship"]);
  // The server has no viewer clock: a bucket without `today` matches nothing.
  expect(run("?due=today", { today: undefined as unknown as string })).toEqual([]);
});

test("each grouping dimension; a card with two assignees or tags appears in each group", () => {
  const groups = (group: string) => applyBoardQuery(board, { ...DEFAULT_BOARD_QUERY, view: "list", group: group as BoardQuery["group"] }, context).groups!;
  const shape = (group: string) => groups(group).map((item) => [item.label, ids(item.items.map((entry) => entry.card))]);
  expect(shape("column")).toEqual([["To do", ["login", "docs"]], ["Doing", ["api", "idea"]], ["Done", ["ship"]]]);
  expect(shape("assignee")).toEqual([["Asha", ["login"]], ["Ben", ["login", "ship"]], ["Pat (you)", ["docs"]], ["No assignee", ["api", "idea"]]]);
  expect(shape("tag")).toEqual([["Backend", ["login"]], ["Design", ["login", "docs"]], ["No tag", ["api", "idea", "ship"]]]);
  expect(shape("flag")).toEqual([["Urgent", ["login"]], ["Blocked", ["api"]], ["On hold", ["api"]], ["No flag", ["docs", "idea", "ship"]]]);
  expect(shape("due")).toEqual([["Overdue", ["login"]], ["Today", ["docs"]], ["This week", ["api"]], ["Later", ["ship"]], ["No date", ["idea"]]]);
  // "also in …" names the card's other groups.
  expect(groups("assignee")[0]!.items[0]!.also).toEqual(["Ben"]);
  expect(groups("tag")[1]!.items[0]!.also).toEqual(["Backend"]);
  // Empty columns still show; filters apply before grouping.
  const filtered = applyBoardQuery(board, { ...parseBoardSearch("?flag=urgent"), view: "list" }, context).groups!;
  expect(filtered.map((item) => [item.label, item.items.length])).toEqual([["To do", 1], ["Doing", 0], ["Done", 0]]);
  // Other views get no groups.
  expect(applyBoardQuery(board, { ...DEFAULT_BOARD_QUERY, view: "table" }, context).groups).toBeNull();
});

test("table sorts are stable and tie-break on board order; empty values sort last both ways", () => {
  const sort = (value: string) => ids(sortBoardCards(board.cards, board, parseBoardSearch(`?sort=${value}`).sort));
  expect(sort("title:asc")).toEqual(["api", "docs", "login", "idea", "ship"]);
  expect(sort("title:desc")).toEqual(["ship", "idea", "login", "docs", "api"]);
  expect(sort("column:asc")).toEqual(["login", "docs", "api", "idea", "ship"]);
  expect(sort("column:desc")).toEqual(["ship", "idea", "api", "docs", "login"]);
  expect(sort("due:asc")).toEqual(["login", "docs", "api", "ship", "idea"]);
  expect(sort("due:desc")).toEqual(["ship", "api", "docs", "login", "idea"]);
  expect(sort("assignees:asc")).toEqual(["login", "ship", "docs", "api", "idea"]);
  expect(sort("assignees:desc")).toEqual(["docs", "ship", "login", "api", "idea"]);
  expect(sort("tags:asc")).toEqual(["login", "docs", "api", "idea", "ship"]);
  expect(sort("tags:desc")).toEqual(["docs", "login", "api", "idea", "ship"]);
  expect(sort("flags:asc")).toEqual(["login", "api", "docs", "idea", "ship"]);
  expect(sort("created:desc")).toEqual(["docs", "login", "api", "idea", "ship"]);
  expect(sort("updated:desc")).toEqual(["ship", "login", "docs", "api", "idea"]);
});

test("the filter registry reads and writes the shared filter", () => {
  let filter = FILTER_FIELDS.tag!.set({}, [design, "none"]);
  expect(filter).toEqual({ tags: [design, "none"] });
  filter = FILTER_FIELDS.due!.set(filter, ["today", "before:2026-10-01", "none"]);
  expect(filter.due).toEqual({ before: "2026-10-01", none: true, buckets: ["today"] });
  expect(dueValues(filter)).toEqual(["today", "before:2026-10-01", "none"]);
  expect(FILTER_FIELDS.tag!.set(filter, [])).toEqual({ due: filter.due });
  expect(FILTER_FIELDS.assignee!.optionsFor(board, context).map((option) => option.label)).toEqual(["Me", "Asha", "Ben", "No assignee"]);
  expect(FILTER_FIELDS.tag!.labelFor("bbbbbbbb-0000-4000-8000-00000000ffff", board, context)).toBe("Unknown tag");
  expect(FILTER_FIELDS.due!.labelFor("week", board, context)).toBe("this week");
  expect(Object.keys(GROUP_DIMENSIONS)).toEqual(["column", "assignee", "tag", "flag", "due"]);
});

test("hierarchy readiness: a stub `parent` dimension and filter plug in without code changes", () => {
  const parentOf: Record<string, string> = { login: "epic", docs: "epic", api: "infra" };
  const parent: GroupDimension = {
    label: "Parent",
    keysFor: (item) => [parentOf[item.id] ?? "none"],
    labelFor: (key) => key === "none" ? "No parent" : key,
    order: (keys) => [...keys].sort()
  };
  const registries = {
    groups: { ...BOARD_REGISTRIES.groups, parent },
    filters: { ...BOARD_REGISTRIES.filters, parent: { ...FILTER_FIELDS.column!, label: "Parent", param: "parent", match: (item: BoardCard, values: readonly string[]) => values.includes(parentOf[item.id] ?? "none") } }
  };
  const result = applyBoardQuery(board, { ...DEFAULT_BOARD_QUERY, view: "list", group: "parent" as BoardQuery["group"], extra: { parent: ["epic", "none"] } }, context, registries);
  expect(result.groups!.map((item) => [item.label, ids(item.items.map((entry) => entry.card))])).toEqual([["epic", ["login", "docs"]], ["No parent", ["idea", "ship"]]]);
});
