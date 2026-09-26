import { expect, test } from "bun:test";
import { filterParams, parseFilterParams, QUERY_LIMITS } from "../shared/taskQuery";
import { isRouteMonth } from "../src/router";
import { DEFAULT_BOARD_QUERY, formatBoardSearch, isBoardMonth, isDefaultBoardQuery, parseBoardSearch, type BoardQuery } from "../src/tasks/boardUrl";

// WAVE_13_TASK_CARD_UX.md §4.6 (URL codec), §7 `tests/boardUrl.test.ts`, T102.
const user = "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d";
const tag = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const column = "4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

test("the default query formats as no query string at all", () => {
  expect(formatBoardSearch(DEFAULT_BOARD_QUERY)).toBe("");
  expect(isDefaultBoardQuery(parseBoardSearch(""))).toBe(true);
  expect(isDefaultBoardQuery(parseBoardSearch("?view=board&cal=month"))).toBe(true);
});

test("the codec round-trips and is canonical: fixed key order, sorted values, readable colons", () => {
  const search = `?q=Login&due=overdue&tag=${tag.toUpperCase()}&assignee=me&assignee=${user}&flag=urgent&flag=blocked&view=table&sort=due:desc&rel=blocked&column=${column}&month=2026-10&cal=agenda&group=tag`;
  const query = parseBoardSearch(search);
  expect(query).toEqual({
    view: "table", group: "tag", sort: { field: "due", direction: "desc" }, cal: "agenda", month: "2026-10",
    filter: { assignees: [user, "me"], tags: [tag], flags: ["blocked", "urgent"], columns: [column], relations: ["blocked"], due: { buckets: ["overdue"] }, text: "Login" }
  });
  const canonical = formatBoardSearch(query);
  expect(canonical).toBe(`?view=table&group=tag&sort=due:desc&cal=agenda&month=2026-10&assignee=${user}&assignee=me&tag=${tag}&flag=blocked&flag=urgent&due=overdue&column=${column}&rel=blocked&q=Login`);
  expect(formatBoardSearch(parseBoardSearch(canonical))).toBe(canonical);
  // The order of the input never changes the output.
  expect(formatBoardSearch(parseBoardSearch("?flag=urgent&flag=blocked"))).toBe(formatBoardSearch(parseBoardSearch("?flag=blocked&flag=urgent")));
});

test("invalid values and unknown keys are dropped, never thrown", () => {
  const query = parseBoardSearch("?view=kanban&group=owner&sort=title:up&cal=week&month=2026-13&assignee=bob&assignee=me&tag=../x&flag=spicy&due=yesterday&due=before:2026-02-30&column=none&rel=parent&evil=<script>&__proto__=1");
  expect(query).toEqual({ ...DEFAULT_BOARD_QUERY, filter: { assignees: ["me"] } });
  expect(parseBoardSearch("?month=1899-12").month).toBeNull();
  expect(parseBoardSearch("?month=2026-07").month).toBe("2026-07");
  expect(parseBoardSearch("%%%&&=&view").view).toBe("board");
  expect(parseBoardSearch(`?view=table&${"x=1&".repeat(2000)}`).view).toBe("board");
  // The month rule is the router's.
  for (const value of ["2026-01", "1900-01", "2200-12", "2201-01", "1899-12", "2026-1", "x"]) expect(isBoardMonth(value)).toBe(isRouteMonth(value));
});

test("due keeps one before and one after bound, plus none and the relative buckets", () => {
  const query = parseBoardSearch("?due=before:2026-10-01&due=before:2026-11-01&due=after:2026-09-01&due=none&due=week&due=today");
  expect(query.filter.due).toEqual({ before: "2026-10-01", after: "2026-09-01", none: true, buckets: ["today", "week"] });
  expect(formatBoardSearch(query)).toBe("?due=after:2026-09-01&due=before:2026-10-01&due=none&due=today&due=week");
});

test("at most 30 filter values are kept, and duplicates count once", () => {
  const many = Array.from({ length: 40 }, (_, index) => `tag=${index.toString(16).padStart(8, "0")}-4d5a-4b6c-8d7e-9f0a1b2c3d4e`).join("&");
  expect(parseBoardSearch(`?${many}`).filter.tags).toHaveLength(QUERY_LIMITS.values);
  expect(parseFilterParams([["flag", "urgent"], ["flag", "urgent"], ["flag", "none"]]).flags).toEqual(["none", "urgent"]);
});

test("q is cleaned, capped at 100 characters, and kept as plain text", () => {
  expect(parseBoardSearch(`?q=${"é".repeat(150)}`).filter.text).toHaveLength(QUERY_LIMITS.textMax);
  expect(parseBoardSearch("?q=%20%20").filter.text).toBeUndefined();
  expect(parseBoardSearch("?q=a%E2%80%AEb%07c").filter.text).toBe("abc");
  const hostile = parseBoardSearch("?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
  expect(hostile.filter.text).toBe("<img src=x onerror=alert(1)>");
  // Encoded back, it stays inside its parameter.
  expect(formatBoardSearch(hostile)).toBe("?q=%3Cimg+src%3Dx+onerror%3Dalert%281%29%3E");
  expect(parseBoardSearch("?q=a&q=b").filter.text).toBe("a");
});

test("filterParams encodes only what parseFilterParams keeps", () => {
  const entries = filterParams({ assignees: ["ME", "none", "nobody"], tags: [tag.toUpperCase()], due: { before: "2026-02-30", none: true }, text: "  x  " });
  expect(entries).toEqual([["assignee", "none"], ["tag", tag], ["due", "none"], ["q", "x"]]);
  const query: BoardQuery = { ...DEFAULT_BOARD_QUERY, filter: { flags: ["urgent"] } };
  expect(formatBoardSearch(query)).toBe("?flag=urgent");
});
