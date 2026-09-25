import { expect, test } from "bun:test";
import { createAppHistoryState, readAppHistorySection } from "../src/appShellNavigation";

test("app shell history preserves existing panel state and round trips a section", () => {
  const state = createAppHistoryState("user-1", "notes", { external: "kept" });
  expect(state.external).toBe("kept");
  expect(readAppHistorySection(state, "user-1")).toBe("notes");
});

test("app shell history rejects a different user and invalid app sections", () => {
  const state = createAppHistoryState("user-1", "home", null);
  expect(readAppHistorySection(state, "user-2")).toBeNull();
  expect(readAppHistorySection({ "mynotes.app-shell": { version: 1, userId: "user-1", section: "admin" } }, "user-1")).toBeNull();
});
