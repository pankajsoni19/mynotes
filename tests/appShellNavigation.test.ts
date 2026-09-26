import { expect, test } from "bun:test";
import { createAppHistoryState, readAppHistorySection, readHistoryDepth, resolveAppHistorySection, startupRouteState, withHistoryDepth } from "../src/appShellNavigation";
import { createHistoryState } from "../src/mobileNavigation";

test("app shell history preserves existing panel state and round trips a section", () => {
  const state = createAppHistoryState("user-1", "notes", { external: "kept" });
  expect(state.external).toBe("kept");
  expect(readAppHistorySection(state, "user-1")).toBe("notes");
  expect(readAppHistorySection(createAppHistoryState("user-1", "team", null), "user-1")).toBe("team");
});

test("app shell history rejects a different user and invalid app sections", () => {
  const state = createAppHistoryState("user-1", "home", null);
  expect(readAppHistorySection(state, "user-2")).toBeNull();
  expect(readAppHistorySection({ "mynotes.app-shell": { version: 1, userId: "user-1", section: "admin" } }, "user-1")).toBeNull();
});

test("legacy Notes history entries without an app section resolve to Notes", () => {
  const legacy = createHistoryState("user-1", { panel: "notes", folder: "all", noteId: null }, null);
  expect(readAppHistorySection(legacy, "user-1")).toBeNull();
  expect(resolveAppHistorySection(legacy, "user-1")).toBe("notes");
  expect(resolveAppHistorySection(legacy, "user-2")).toBeNull();
  expect(resolveAppHistorySection({ unrelated: true }, "user-1")).toBeNull();
});

test("an explicit app section wins over an inherited Notes snapshot", () => {
  const notes = createAppHistoryState("user-1", "notes", createHistoryState("user-1", { panel: "editor", folder: "all", noteId: "note-1" }, null));
  const home = createAppHistoryState("user-1", "home", notes);
  expect(resolveAppHistorySection(home, "user-1")).toBe("home");
  expect(resolveAppHistorySection(notes, "user-1")).toBe("notes");
});

test("a Notes entry pushed on top of a Home entry resolves back to Notes", () => {
  const home = createAppHistoryState("user-1", "home", null);
  const notes = createAppHistoryState("user-1", "notes", createHistoryState("user-1", { panel: "folders", folder: "all", noteId: null }, home));
  expect(resolveAppHistorySection(notes, "user-1")).toBe("notes");
  expect(resolveAppHistorySection(home, "user-1")).toBe("home");
});

test("history depth defaults to zero for legacy entries and round trips", () => {
  expect(readHistoryDepth(null)).toBe(0);
  expect(readHistoryDepth(createAppHistoryState("user-1", "home", null))).toBe(0);
  expect(readHistoryDepth({ "mynotes.depth": -3 })).toBe(0);
  const state = withHistoryDepth(createAppHistoryState("user-1", "notes", null), 2);
  expect(readHistoryDepth(state)).toBe(2);
  expect(readAppHistorySection(state, "user-1")).toBe("notes");
});

test("route changes wait for the first load, and retry it after a failure", () => {
  expect(startupRouteState("user-1", "user-1", null)).toBe("ready");
  expect(startupRouteState("user-1", null, null)).toBe("loading");
  expect(startupRouteState("user-1", null, "user-1")).toBe("retry");
  expect(startupRouteState("user-1", "user-2", "user-2")).toBe("loading");
});

test("Tasks is a valid app section", () => {
  expect(readAppHistorySection(createAppHistoryState("user-1", "tasks", null), "user-1")).toBe("tasks");
});
