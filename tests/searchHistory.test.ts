import { expect, test } from "bun:test";
import { nextSearchHint, readSearchHint, sameSearchHint, withSearchHint } from "../src/search/searchHistory";
import { isSearchable, searchPath } from "../src/search/searchApi";

test("search hints round trip on history state and keep other keys", () => {
  const state = withSearchHint("user-1", { query: "crème brûlée", all: true }, { external: "kept" });
  expect(state.external).toBe("kept");
  expect(readSearchHint(state, "user-1")).toEqual({ query: "crème brûlée", all: true });
  expect(readSearchHint(state, "user-2")).toBeNull();
  expect(readSearchHint(withSearchHint("user-1", null, state), "user-1")).toBeNull();
  expect(withSearchHint("user-1", null, state).external).toBe("kept");
});

test("malformed hints are ignored and long queries are capped", () => {
  expect(readSearchHint(null, "user-1")).toBeNull();
  expect(readSearchHint({ "mynotes.notes-search": { version: 1, userId: "user-1", hint: { query: 5, all: false } } }, "user-1")).toBeNull();
  expect(readSearchHint({ "mynotes.notes-search": { version: 2, userId: "user-1", hint: { query: "x", all: false } } }, "user-1")).toBeNull();
  const long = withSearchHint("user-1", { query: "a".repeat(500), all: false }, null);
  expect(readSearchHint(long, "user-1")!.query).toHaveLength(200);
});

test("a cleared search leaves an empty hint only on entries that had one", () => {
  expect(nextSearchHint(true, "abc", false, null)).toEqual({ query: "abc", all: false });
  expect(nextSearchHint(false, "a", false, null)).toBeNull();
  expect(nextSearchHint(false, "", false, { query: "abc", all: true })).toEqual({ query: "", all: false });
  expect(sameSearchHint(null, null)).toBe(true);
  expect(sameSearchHint({ query: "a", all: false }, { query: "a", all: false })).toBe(true);
  expect(sameSearchHint({ query: "a", all: false }, null)).toBe(false);
});

test("search starts at two characters and never puts more than 200 in the request", () => {
  expect(isSearchable("a")).toBe(false);
  expect(isSearchable(" a ")).toBe(false);
  expect(isSearchable("ab")).toBe(true);
  expect(isSearchable("🎉")).toBe(false);
  const path = searchPath("x".repeat(300), "shared");
  const params = new URL(path, "http://localhost").searchParams;
  expect(params.get("q")).toHaveLength(200);
  expect(params.get("folder")).toBe("shared");
  expect(params.get("scope")).toBe("notes");
});
