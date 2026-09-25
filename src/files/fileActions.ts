// Pure helpers for the Files actions (rename, move, delete, toasts). No DOM or network access, so
// they are unit tested directly.
import type { DocumentSummary, Folder, Visibility } from "../types";

export const MAX_DISPLAY_NAME_BYTES = 255;

// Same character classes as server/validation.ts: C0/C1 controls, DEL, bidi embeddings, overrides,
// isolates and marks, and zero-width characters.
const strippedCharacters = /[\u0000-\u001F\u007F-\u009F؜​-‏‪-‮⁦-⁩﻿]/g;
const encoder = new TextEncoder();
export const utf8Length = (value: string) => encoder.encode(value).length;
const cleanEdges = (value: string) => value.replace(/^[\s.]+|[\s.]+$/g, "");

/** Client mirror of the server's `sanitizeDisplayName(input, "rename")`: the name the server will store, or null. */
export function sanitizeRenameInput(input: string): string | null {
  const cleaned = cleanEdges(
    input
      .replace(/\p{Cs}/gu, "")
      .normalize("NFC")
      .replace(strippedCharacters, "")
      .replace(/[/\\:]/g, "-")
      .replace(/\s+/g, " ")
  );
  if (cleaned === "" || cleaned === "." || cleaned === "..") return null;
  return utf8Length(cleaned) <= MAX_DISPLAY_NAME_BYTES ? cleaned : null;
}

export type RenameCheck = { ok: true; name: string; changed: boolean } | { ok: false; error: string };

/** Validates a rename before it is sent. `changed` is false when the stored name would stay the same. */
export function validateRename(input: string, currentName: string): RenameCheck {
  const name = sanitizeRenameInput(input);
  if (name === null) {
    const stripped = input.replace(strippedCharacters, "").trim();
    if (!stripped || /^[\s.]+$/.test(stripped)) return { ok: false, error: "Enter a name." };
    return { ok: false, error: `Use at most ${MAX_DISPLAY_NAME_BYTES} bytes. This name is ${utf8Length(stripped)}.` };
  }
  return { ok: true, name, changed: name !== currentName };
}

/** The selection a rename field starts with: the base name, without the extension. */
export function baseNameRange(name: string): [number, number] {
  const dot = name.lastIndexOf(".");
  return [0, dot > 0 ? dot : name.length];
}

export type MoveTarget = { id: string; name: string; isDefault: boolean; current: boolean };

/** Folders a document can be moved into: owned folders only, Default first, the current one disabled. */
export function moveTargets(folders: Folder[], currentFolderId: string | null): MoveTarget[] {
  return folders
    .filter((folder) => folder.is_owner === 1)
    .sort((left, right) => right.is_default - left.is_default || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
    .map((folder) => ({ id: folder.id, name: folder.name, isDefault: folder.is_default === 1, current: folder.id === currentFolderId }));
}

const effectiveLabels: Record<Visibility, string> = { private: "private", selected: "shared with selected people", all_users: "shared with everyone" };

export function effectiveVisibilityLabel(visibility: Visibility) {
  return Object.hasOwn(effectiveLabels, visibility) ? effectiveLabels[visibility] : effectiveLabels.private;
}

/** Toast after a move. It always names who can now see the file, because a move can widen access. */
export function movedMessage(folderName: string, visibility: Visibility) {
  return `Moved to ${folderName} · ${effectiveVisibilityLabel(visibility)}`;
}

export function deleteConfirmMessage(name: string) {
  return `Move “${name}” to the Bin? You can restore it for 30 days.`;
}

export const canManage = (document: Pick<DocumentSummary, "is_owner">) => document.is_owner === 1;

// A single toast slot owned by Files, so a delete can offer Undo. The id lets a timer dismiss only
// the toast it was started for.
export type FileToast = { id: number; message: string; undoDocumentId: string | null };
export type FileToastState = { next: number; toast: FileToast | null };
export type FileToastAction =
  | { type: "show"; message: string; undoDocumentId?: string | null }
  | { type: "dismiss"; id: number }
  | { type: "clear" };

export const emptyToastState: FileToastState = { next: 1, toast: null };

export function fileToastReducer(state: FileToastState, action: FileToastAction): FileToastState {
  switch (action.type) {
    case "show":
      return { next: state.next + 1, toast: { id: state.next, message: action.message, undoDocumentId: action.undoDocumentId ?? null } };
    case "dismiss":
      return state.toast?.id === action.id ? { ...state, toast: null } : state;
    case "clear":
      return state.toast ? { ...state, toast: null } : state;
  }
}

/** How long a toast stays: long enough to reach Undo. */
export const toastDuration = (toast: FileToast) => toast.undoDocumentId ? 8000 : 3200;
