export type MobilePanel = "folders" | "notes" | "editor";
export type FolderSelection = string | "all" | "shared";

export type MobileNavigationSnapshot = {
  panel: MobilePanel;
  folder: FolderSelection;
  noteId: string | null;
};

const historyKey = "mynotes.mobile-navigation";
const historyVersion = 1;

export type MyNotesHistoryState = {
  [historyKey]: {
    version: number;
    userId: string;
    snapshot: MobileNavigationSnapshot;
  };
};

export function isMobileViewport() {
  return window.matchMedia("(max-width: 760px)").matches;
}

export function createHistoryState(userId: string, snapshot: MobileNavigationSnapshot, currentState: unknown): MyNotesHistoryState {
  const base = currentState && typeof currentState === "object" ? currentState as Record<string, unknown> : {};
  return {
    ...base,
    [historyKey]: { version: historyVersion, userId, snapshot }
  };
}

export function readHistorySnapshot(state: unknown, userId: string): MobileNavigationSnapshot | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[historyKey];
  if (!value || typeof value !== "object") return null;
  const entry = value as { version?: unknown; userId?: unknown; snapshot?: unknown };
  if (entry.version !== historyVersion || entry.userId !== userId || !entry.snapshot || typeof entry.snapshot !== "object") return null;
  const snapshot = entry.snapshot as Partial<MobileNavigationSnapshot>;
  if ((snapshot.panel !== "folders" && snapshot.panel !== "notes" && snapshot.panel !== "editor") || typeof snapshot.folder !== "string" || (snapshot.noteId !== null && typeof snapshot.noteId !== "string")) return null;
  return { panel: snapshot.panel, folder: snapshot.folder, noteId: snapshot.noteId };
}

export function sameSnapshot(left: MobileNavigationSnapshot, right: MobileNavigationSnapshot) {
  return left.panel === right.panel && left.folder === right.folder && left.noteId === right.noteId;
}
