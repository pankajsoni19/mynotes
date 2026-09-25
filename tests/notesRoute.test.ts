import { expect, test } from "bun:test";
import { notesRoute, resolveNotesPanel, resolveNotesRoute } from "../src/notesRoute";

const folderA = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const folderB = "4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const own = { id: "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", folder_id: folderA, is_owner: 1 };
const shared = { id: "b1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", folder_id: null, is_owner: 0 };
const data = { folders: [{ id: folderA }, { id: folderB }], notes: [own, shared] };
const none = { snapshot: null, lastFolder: "all" as const };

test("a missing note or folder falls back to all notes and says which was missing", () => {
  expect(resolveNotesRoute(notesRoute("all", "c1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d"), data, none)).toEqual({ folder: "all", noteId: null, missing: "note" });
  expect(resolveNotesRoute(notesRoute("d1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", null), data, none)).toEqual({ folder: "all", noteId: null, missing: "folder" });
  expect(resolveNotesRoute(notesRoute("shared", null), data, none)).toEqual({ folder: "shared", noteId: null, missing: null });
});

test("a note URL takes its folder from the matching history entry, then the note, then the last folder", () => {
  const snapshot = { panel: "editor" as const, folder: "all", noteId: own.id };
  expect(resolveNotesRoute(notesRoute("all", own.id), data, { snapshot, lastFolder: folderB }).folder).toBe("all");
  expect(resolveNotesRoute(notesRoute("all", own.id), data, { snapshot: null, lastFolder: folderB }).folder).toBe(folderA);
  expect(resolveNotesRoute(notesRoute("all", shared.id), data, { snapshot: null, lastFolder: "shared" }).folder).toBe("shared");
});

test("the phone panel follows a matching hint and otherwise falls back by selection", () => {
  const selection = { folder: "all", noteId: own.id };
  expect(resolveNotesPanel(selection, { panel: "notes", folder: "all", noteId: own.id })).toBe("notes");
  expect(resolveNotesPanel(selection, { panel: "folders", folder: "all", noteId: null })).toBe("editor");
  expect(resolveNotesPanel({ folder: "all", noteId: null }, null)).toBe("folders");
  expect(resolveNotesPanel({ folder: folderA, noteId: null }, null)).toBe("notes");
  expect(resolveNotesPanel({ folder: folderA, noteId: null }, { panel: "editor", folder: folderA, noteId: null })).toBe("notes");
});

test("shared note prefers Shared", () => {
  const hiddenFolder = { ...shared, folder_id: "e1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d" };
  const withHidden = { ...data, notes: [own, hiddenFolder] };
  expect(resolveNotesRoute(notesRoute("all", shared.id), data, none).folder).toBe("shared");
  expect(resolveNotesRoute(notesRoute("all", hiddenFolder.id), withHidden, { snapshot: null, lastFolder: folderB }).folder).toBe("shared");
  const visibleShared = { ...shared, folder_id: folderB };
  expect(resolveNotesRoute(notesRoute("all", shared.id), { ...data, notes: [own, visibleShared] }, none).folder).toBe(folderB);
  const snapshot = { panel: "editor" as const, folder: "all", noteId: shared.id };
  expect(resolveNotesRoute(notesRoute("all", shared.id), data, { snapshot, lastFolder: "all" }).folder).toBe("all");
});
