// Pure Bin display helpers. No DOM or network access, so they are unit tested directly.
import type { BinItem, BinRestoreResult, Visibility } from "../types";

export type BinFilter = "all" | "note" | "document" | "tasks" | "collections";

export const isTaskBinItem = (item: Pick<BinItem, "type">) => item.type === "card" || item.type === "board";
export const isCollectionItem = (item: Pick<BinItem, "type">) => item.type === "collection" || item.type === "collection_row";

const DAY_MS = 86_400_000;

/** Whole days left before an item is deleted forever, rounded up so a fresh deletion reads 30. Never negative. */
export function daysUntilPurge(purgeAfter: string, nowMs = Date.now()) {
  const remaining = new Date(purgeAfter).getTime() - nowMs;
  if (!Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.ceil(remaining / DAY_MS));
}

export function purgeCountdownLabel(purgeAfter: string, nowMs = Date.now()) {
  const days = daysUntilPurge(purgeAfter, nowMs);
  if (days === 0) return "Deletes soon";
  return days === 1 ? "Deletes in 1 day" : `Deletes in ${days} days`;
}

/**
 * Where a restore will put the item: its original folder (Default when that folder is gone), a
 * card's board, Collections for a collection, or a row's collection (Wave 11).
 */
export function binFolderLabel(item: Pick<BinItem, "folder_name"> & Partial<Pick<BinItem, "type" | "board_name">>) {
  if (item.type === "card") return item.board_name ?? "its board";
  if (item.type === "board") return "Tasks";
  if (item.type === "collection") return "Collections";
  if (item.type === "collection_row") return item.folder_name ?? "its collection";
  return item.folder_name ?? "Default";
}

/** The Tasks filter shows cards and boards together; the Collections filter, collections and rows. */
export function filterBinItems(items: BinItem[], filter: BinFilter) {
  if (filter === "all") return items;
  if (filter === "tasks") return items.filter(isTaskBinItem);
  if (filter === "collections") return items.filter(isCollectionItem);
  return items.filter((item) => item.type === filter);
}

const untitled: Record<BinItem["type"], string> = { note: "Untitled note", document: "Untitled file", card: "Untitled card", board: "Untitled board", collection: "Untitled collection", collection_row: "Untitled row" };

export function binItemLabel(item: Pick<BinItem, "title" | "type">) {
  return item.title.trim() || untitled[item.type];
}

/** Row meta for an attachment: the card it still belongs to, or a generic label. */
export function attachmentLabel(item: Pick<BinItem, "attachment_of">) {
  return item.attachment_of ? `Attachment of ${item.attachment_of}` : "Card attachment";
}

/** The kind shown to screen readers and in the row meta. */
export function binKindLabel(item: Pick<BinItem, "type" | "attachment">) {
  if (item.type === "note") return "Note";
  if (item.type === "card") return "Card";
  if (item.type === "board") return "Board";
  if (item.type === "collection") return "Collection";
  if (item.type === "collection_row") return "Row";
  return item.attachment ? "Card attachment" : "File";
}

/** Toast after restoring any Bin item. */
export function restoreResultMessage(item: Pick<BinItem, "type"> & Partial<Pick<BinItem, "attachment" | "folder_name">>, result: BinRestoreResult) {
  if (item.type === "board") {
    const name = result.boardName ? ` “${result.boardName}”` : "";
    return result.alreadyRestored ? `The board${name} is already restored` : `Restored the board${name}`;
  }
  if (item.type === "card") {
    const where = [result.columnName, result.boardName].filter(Boolean).join(" on ");
    return result.alreadyRestored ? `Already restored${where ? ` to ${where}` : ""}` : `Restored${where ? ` to ${where}` : ""}`;
  }
  if (item.type === "collection" || item.type === "collection_row") {
    const where = result.folderName ?? binFolderLabel({ type: item.type, folder_name: item.folder_name ?? null });
    return result.alreadyRestored ? `Already restored to ${where}` : restoredMessage(where, result.visibility);
  }
  if (item.type === "document" && item.attachment && !result.folderName && !result.alreadyRestored) return "Restored to its card";
  const folderName = result.folderName ?? "Default";
  return result.alreadyRestored ? `Already restored to ${folderName}` : restoredMessage(folderName, result.visibility);
}

export function deleteForeverConfirm(title: string) {
  return `Permanently delete “${title}”? This can't be undone.`;
}

/** GET /api/bin returns at most this many items; a full page may mean there are more. */
export const BIN_LIST_LIMIT = 500;

export function emptyBinConfirm(count: number) {
  const items = count >= BIN_LIST_LIMIT ? `all ${BIN_LIST_LIMIT}+ items` : count === 1 ? "1 item" : `${count} items`;
  return `Permanently delete ${items} in the Bin? This can't be undone.`;
}

const sharedSuffix: Record<Visibility, string> = { private: "", selected: " · shared with selected people", all_users: " · shared with everyone" };

/** Toast after a restore. Names the destination and, when it is not private, who can see the item again. */
export function restoredMessage(folderName: string, visibility?: Visibility) {
  return `Restored to ${folderName}${visibility ? sharedSuffix[visibility] : ""}`;
}

export function emptiedMessage(purged: number, pending: number) {
  const done = purged === 1 ? "1 item deleted forever" : `${purged} items deleted forever`;
  return pending ? `${done}. ${pending} still finishing.` : done;
}
