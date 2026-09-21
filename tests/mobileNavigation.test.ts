import { expect, test } from "bun:test";
import { createHistoryState, readHistorySnapshot, sameSnapshot } from "../src/mobileNavigation";

test("mobile history snapshots preserve host history state and round trip", () => {
  const snapshot = { panel: "editor" as const, folder: "folder-1", noteId: "note-1" };
  const state = createHistoryState("user-1", snapshot, { external: "preserved" });
  expect(state.external).toBe("preserved");
  expect(readHistorySnapshot(state, "user-1")).toEqual(snapshot);
});

test("mobile history snapshots reject invalid or cross-user entries", () => {
  const state = createHistoryState("user-1", { panel: "notes", folder: "all", noteId: null }, null);
  expect(readHistorySnapshot(state, "user-2")).toBeNull();
  expect(readHistorySnapshot({ "mynotes.mobile-navigation": { version: 1, userId: "user-1", snapshot: { panel: "bad" } } }, "user-1")).toBeNull();
});

test("sameSnapshot only treats identical panel selections as duplicates", () => {
  const folders = { panel: "folders" as const, folder: "all", noteId: null };
  expect(sameSnapshot(folders, { ...folders })).toBe(true);
  expect(sameSnapshot(folders, { ...folders, panel: "notes" })).toBe(false);
});
