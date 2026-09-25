// Pure Bin display helpers. No DOM or network access, so they are unit tested directly.
import type { BinItem, Visibility } from "../types";

export type BinFilter = "all" | "note" | "document";

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

/** Where a restore will put the item: its original folder, or Default when that folder is gone. */
export function binFolderLabel(item: Pick<BinItem, "folder_name">) {
  return item.folder_name ?? "Default";
}

export function filterBinItems(items: BinItem[], filter: BinFilter) {
  return filter === "all" ? items : items.filter((item) => item.type === filter);
}

export function binItemLabel(item: Pick<BinItem, "title" | "type">) {
  return item.title.trim() || (item.type === "note" ? "Untitled note" : "Untitled file");
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
