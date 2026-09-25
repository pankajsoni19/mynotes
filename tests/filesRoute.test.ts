import { expect, test } from "bun:test";
import { createFilesHistoryState, readFilesHistorySnapshot, sameFilesSnapshot } from "../src/filesNavigation";
import { documentInFolder, filesRoute, resolveFilesPanel, resolveFilesRoute } from "../src/filesRoute";
import { formatRoute, parseRoute } from "../src/router";

const folderA = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const folderB = "4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const own = { id: "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", folder_id: folderA, is_owner: 1 };
const shared = { id: "b1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", folder_id: null, is_owner: 0 };
const folders = [{ id: folderA }, { id: folderB }];
const none = { snapshot: null, lastFolder: "all" };

test("Files URLs round-trip through the router, including Shared", () => {
  expect(parseRoute("/files/shared")).toEqual({ app: "files", folder: "shared", documentId: null });
  expect(formatRoute(filesRoute("shared", null))).toBe("/files/shared");
  expect(formatRoute(filesRoute(folderA, null))).toBe(`/files/folder/${folderA}`);
  expect(formatRoute(filesRoute(folderA, own.id))).toBe(`/files/${own.id}`);
});

test("a missing document or folder falls back to all files and says which was missing", () => {
  expect(resolveFilesRoute(filesRoute("all", own.id), { folders, document: null }, none)).toEqual({ folder: "all", documentId: null, missing: "document" });
  expect(resolveFilesRoute(filesRoute("all", own.id), { folders, document: shared }, none).missing).toBe("document");
  expect(resolveFilesRoute(filesRoute("d1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", null), { folders, document: null }, none)).toEqual({ folder: "all", documentId: null, missing: "folder" });
  expect(resolveFilesRoute(filesRoute("shared", null), { folders, document: null }, none)).toEqual({ folder: "shared", documentId: null, missing: null });
  expect(resolveFilesRoute(filesRoute(folderB, null), { folders, document: null }, none)).toEqual({ folder: folderB, documentId: null, missing: null });
});

test("a document URL takes its folder from the matching entry, then the document, then Shared", () => {
  const snapshot = { panel: "preview" as const, folder: "all", documentId: own.id };
  expect(resolveFilesRoute(filesRoute("all", own.id), { folders, document: own }, { snapshot, lastFolder: folderB }).folder).toBe("all");
  expect(resolveFilesRoute(filesRoute("all", own.id), { folders, document: own }, none).folder).toBe(folderA);
  expect(resolveFilesRoute(filesRoute("all", shared.id), { folders, document: shared }, none).folder).toBe("shared");
  const stale = { panel: "preview" as const, folder: folderB, documentId: own.id };
  expect(resolveFilesRoute(filesRoute("all", own.id), { folders, document: own }, { snapshot: stale, lastFolder: "all" }).folder).toBe(folderA);
  expect(documentInFolder(shared, "shared")).toBe(true);
  expect(documentInFolder(own, "shared")).toBe(false);
});

test("the phone panel follows a matching hint and otherwise falls back by selection", () => {
  expect(resolveFilesPanel({ folder: "all", documentId: null }, null)).toBe("folders");
  expect(resolveFilesPanel({ folder: "all", documentId: null }, { panel: "files", folder: "all", documentId: null })).toBe("files");
  expect(resolveFilesPanel({ folder: folderA, documentId: null }, null)).toBe("files");
  expect(resolveFilesPanel({ folder: folderA, documentId: own.id }, null)).toBe("preview");
  expect(resolveFilesPanel({ folder: folderA, documentId: null }, { panel: "preview", folder: folderA, documentId: null })).toBe("files");
});

test("the history hint is bound to its user and validated strictly", () => {
  const snapshot = { panel: "files" as const, folder: folderA, documentId: null };
  const state = createFilesHistoryState("user-1", snapshot, { other: true });
  expect(readFilesHistorySnapshot(state, "user-1")).toEqual(snapshot);
  expect(readFilesHistorySnapshot(state, "user-2")).toBeNull();
  expect((state as unknown as { other: boolean }).other).toBe(true);
  expect(readFilesHistorySnapshot({ "mynotes.files-navigation": { version: 1, userId: "user-1", snapshot: { panel: "editor", folder: "all", documentId: null } } }, "user-1")).toBeNull();
  expect(sameFilesSnapshot(snapshot, { ...snapshot })).toBe(true);
  expect(sameFilesSnapshot(snapshot, { ...snapshot, panel: "folders" })).toBe(false);
});
