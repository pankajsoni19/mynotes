import { expect, test } from "bun:test";
import { sanitizeDisplayName } from "../server/validation";
import {
  baseNameRange,
  deleteConfirmMessage,
  emptyToastState,
  fileToastReducer,
  moveTargets,
  movedMessage,
  sanitizeRenameInput,
  toastDuration,
  validateRename
} from "../src/files/fileActions";
import type { Folder } from "../src/types";

test("the client rename sanitizer matches the server for every rule", () => {
  const inputs = [
    "report.pdf", "  spaced   out  .txt ", "a/b\\c:d.txt", "‮evil‬.txt", "zero​width", "tab\tand\nnewline",
    ".", "..", "...", "   ", "", "\u0000\u0007", ".hidden", "trailing.", "éclair.md", "x".repeat(255), "x".repeat(256),
    "é".repeat(127) + "a", "é".repeat(128), "\uD800lonely", "日本語のファイル.txt", "emoji 😀.png"
  ];
  for (const input of inputs) expect(sanitizeRenameInput(input)).toBe(sanitizeDisplayName(input, "rename"));
});

test("rename validation explains empty and oversized names and detects no-op renames", () => {
  expect(validateRename("   ", "a.txt")).toEqual({ ok: false, error: "Enter a name." });
  expect(validateRename("..", "a.txt")).toEqual({ ok: false, error: "Enter a name." });
  const long = validateRename("é".repeat(200), "a.txt");
  expect(long.ok).toBe(false);
  if (!long.ok) expect(long.error).toContain("255 bytes");
  expect(validateRename(" a.txt ", "a.txt")).toEqual({ ok: true, name: "a.txt", changed: false });
  expect(validateRename("a:b.txt", "a.txt")).toEqual({ ok: true, name: "a-b.txt", changed: true });
});

test("the rename field preselects the base name without the extension", () => {
  expect(baseNameRange("report.final.pdf")).toEqual([0, 12]);
  expect(baseNameRange("README")).toEqual([0, 6]);
  expect(baseNameRange(".env")).toEqual([0, 4]);
});

const folder = (id: string, name: string, extra: Partial<Folder> = {}): Folder => ({
  id, owner_id: "u1", owner_name: "Ada", parent_id: null, name, is_default: 0, is_owner: 1, visibility: "private",
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", ...extra
});

test("move targets list owned folders only, Default first, with the current folder disabled", () => {
  const folders = [folder("f3", "zeta"), folder("f2", "Alpha"), folder("f1", "Default", { is_default: 1 }), folder("f4", "Theirs", { is_owner: 0, owner_id: "u2" })];
  const targets = moveTargets(folders, "f2");
  expect(targets.map((target) => target.id)).toEqual(["f1", "f2", "f3"]);
  expect(targets.filter((target) => target.current).map((target) => target.id)).toEqual(["f2"]);
  expect(moveTargets(folders, null).some((target) => target.current)).toBe(false);
});

test("move and delete copy", () => {
  expect(movedMessage("Projects", "selected")).toBe("Moved to Projects · shared with selected people");
  expect(movedMessage("Default", "private")).toBe("Moved to Default · private");
  expect(movedMessage("Team", "all_users")).toBe("Moved to Team · shared with everyone");
  expect(deleteConfirmMessage("a.pdf")).toBe("Move “a.pdf” to the Bin? You can restore it for 30 days.");
});

test("the toast reducer keeps one toast and only dismisses the one a timer started for", () => {
  let state = fileToastReducer(emptyToastState, { type: "show", message: "Moved to the Bin", undoDocumentId: "d1" });
  const first = state.toast!;
  expect(first).toEqual({ id: 1, message: "Moved to the Bin", undoDocumentId: "d1" });
  expect(toastDuration(first)).toBeGreaterThan(toastDuration({ ...first, undoDocumentId: null }));
  state = fileToastReducer(state, { type: "show", message: "Renamed" });
  expect(state.toast).toEqual({ id: 2, message: "Renamed", undoDocumentId: null });
  expect(fileToastReducer(state, { type: "dismiss", id: first.id })).toBe(state);
  expect(fileToastReducer(state, { type: "dismiss", id: 2 }).toast).toBeNull();
  expect(fileToastReducer(fileToastReducer(state, { type: "clear" }), { type: "clear" }).toast).toBeNull();
});
