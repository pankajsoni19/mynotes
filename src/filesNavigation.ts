// Phone panel hint for Files history entries. Mirrors src/mobileNavigation.ts: the URL carries the
// folder and document, this payload adds which panel was showing and the folder a file was opened from.
export type FilesPanel = "folders" | "files" | "preview";

export type FilesNavigationSnapshot = {
  panel: FilesPanel;
  folder: string | "all" | "shared";
  documentId: string | null;
};

const historyKey = "mynotes.files-navigation";
const historyVersion = 1;

export type FilesHistoryState = {
  [historyKey]: { version: number; userId: string; snapshot: FilesNavigationSnapshot };
};

export function createFilesHistoryState(userId: string, snapshot: FilesNavigationSnapshot, currentState: unknown): FilesHistoryState {
  const base = currentState && typeof currentState === "object" ? currentState as Record<string, unknown> : {};
  return { ...base, [historyKey]: { version: historyVersion, userId, snapshot } };
}

export function readFilesHistorySnapshot(state: unknown, userId: string): FilesNavigationSnapshot | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[historyKey];
  if (!value || typeof value !== "object") return null;
  const entry = value as { version?: unknown; userId?: unknown; snapshot?: unknown };
  if (entry.version !== historyVersion || entry.userId !== userId || !entry.snapshot || typeof entry.snapshot !== "object") return null;
  const snapshot = entry.snapshot as Partial<FilesNavigationSnapshot>;
  if ((snapshot.panel !== "folders" && snapshot.panel !== "files" && snapshot.panel !== "preview") || typeof snapshot.folder !== "string" || (snapshot.documentId !== null && typeof snapshot.documentId !== "string")) return null;
  return { panel: snapshot.panel, folder: snapshot.folder, documentId: snapshot.documentId };
}

export function sameFilesSnapshot(left: FilesNavigationSnapshot, right: FilesNavigationSnapshot) {
  return left.panel === right.panel && left.folder === right.folder && left.documentId === right.documentId;
}
