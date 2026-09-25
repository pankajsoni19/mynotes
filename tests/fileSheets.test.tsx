import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileActionSheet } from "../src/files/FileActionSheet";
import { MoveSheet } from "../src/files/MoveSheet";
import { popStateClosedDialog, registerHistoryDialogGuard } from "../src/historyDialogs";
import type { DocumentSummary, Folder } from "../src/types";

const base: DocumentSummary = {
  id: "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d", owner_id: "u1", owner_name: "Ada", is_owner: 1, folder_id: "f2",
  name: "plan.pdf", mime_type: "application/pdf", preview_kind: "pdf", size_bytes: 10,
  visibility: "private", sharing_override: 0, created_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-02T10:00:00.000Z"
};
const folder = (id: string, name: string, extra: Partial<Folder> = {}): Folder => ({
  id, owner_id: "u1", owner_name: "Ada", parent_id: null, name, is_default: 0, is_owner: 1, visibility: "private",
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", ...extra
});
const noop = () => undefined;

test("the action sheet offers every action to owners and only Download and Open preview to others", () => {
  const owner = renderToStaticMarkup(<FileActionSheet document={base} onAction={noop} onClose={noop} />);
  for (const label of ["Download", "Open preview", "Rename", "Move", "Share", "Delete", "Cancel"]) expect(owner).toContain(`${label}</`);
  expect(owner).toContain('role="dialog" aria-modal="true"');
  expect(owner).toContain(`href="/api/files/${base.id}/content?disposition=attachment" download=""`);
  const other = renderToStaticMarkup(<FileActionSheet document={{ ...base, is_owner: 0 }} onAction={noop} onClose={noop} />);
  expect(other).toContain("Download</a>");
  expect(other).toContain("Open preview</a>");
  for (const label of ["Rename", "Move", "Share", "Delete"]) expect(other).not.toContain(`${label}</button>`);
  const text = renderToStaticMarkup(<FileActionSheet document={{ ...base, preview_kind: "text", name: "a.txt" }} onAction={noop} onClose={noop} />);
  expect(text).not.toContain("Open preview");
});

test("the Move sheet lists owned folders with the current one disabled", () => {
  const folders = [folder("f1", "Default", { is_default: 1 }), folder("f2", "Projects"), folder("f3", "Theirs", { is_owner: 0 })];
  const markup = renderToStaticMarkup(<MoveSheet document={base} folders={folders} onMove={async () => undefined} onCancel={noop} />);
  expect(markup).toContain("Default");
  expect(markup).not.toContain("Theirs");
  expect(markup).toMatch(/<button role="radio" aria-checked="false" class="move-option" disabled="">.*Projects<small>Current folder<\/small>/);
  expect(markup).toContain("file-dialog-sheet");
});

test("popstate handlers skip an event that only closed a dialog", () => {
  let open = true;
  const unregister = registerHistoryDialogGuard(() => {
    if (!open) return false;
    open = false;
    return true;
  });
  const first = {};
  // The first handler closes the dialog; later handlers for the same event also skip it.
  expect(popStateClosedDialog(first)).toBe(true);
  expect(popStateClosedDialog(first)).toBe(true);
  expect(popStateClosedDialog({})).toBe(false);
  unregister();
  open = true;
  expect(popStateClosedDialog({})).toBe(false);
  // Unregistering a replaced guard leaves the newer one in place.
  const unregisterOld = registerHistoryDialogGuard(() => true);
  const unregisterNew = registerHistoryDialogGuard(() => false);
  unregisterOld();
  expect(popStateClosedDialog({})).toBe(false);
  unregisterNew();
});
