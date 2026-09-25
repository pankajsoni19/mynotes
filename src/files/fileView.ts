// List or thumbnail grid for the Files list, remembered per signed-in user.
export type FileView = "list" | "grid";

export const DEFAULT_FILE_VIEW: FileView = "list";

/** localStorage key for the remembered view, one per signed-in user. */
export const fileViewStorageKey = (userId: string) => `mynotes:files-view:${userId}`;

export function isFileView(value: unknown): value is FileView {
  return value === "list" || value === "grid";
}

export function readFileView(storage: Pick<Storage, "getItem"> | null, userId: string): FileView {
  try {
    const value = storage?.getItem(fileViewStorageKey(userId));
    return isFileView(value) ? value : DEFAULT_FILE_VIEW;
  } catch {
    return DEFAULT_FILE_VIEW;
  }
}

export function writeFileView(storage: Pick<Storage, "setItem"> | null, userId: string, view: FileView) {
  try { storage?.setItem(fileViewStorageKey(userId), view); } catch { /* private mode or full storage: keep it for this visit only */ }
}

const moveKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * The index the selection moves to for a navigation key, or null when the key does nothing here.
 * `index` is -1 when nothing in the list is selected (a move then lands on the first item, End on the last).
 * The list view is one column and ignores ←/→. In the grid, ↓ with nothing directly below lands on
 * the last item when a later (shorter) row exists, and stays put on the last row.
 */
export function moveFileSelection(index: number, key: string, count: number, columns: number, view: FileView): number | null {
  if (count <= 0 || !moveKeys.has(key)) return null;
  if (view === "list" && (key === "ArrowLeft" || key === "ArrowRight")) return null;
  const width = view === "grid" ? Math.max(1, Math.floor(columns)) : 1;
  if (index < 0 || index >= count) return key === "End" ? count - 1 : 0;
  switch (key) {
    case "Home": return 0;
    case "End": return count - 1;
    case "ArrowLeft": return Math.max(0, index - 1);
    case "ArrowRight": return Math.min(count - 1, index + 1);
    case "ArrowUp": return index - width >= 0 ? index - width : index;
    default: {
      if (index + width < count) return index + width;
      const lastRowStart = Math.floor((count - 1) / width) * width;
      return index < lastRowStart ? count - 1 : index;
    }
  }
}

/** Column count of a CSS grid from its computed `grid-template-columns` ("160px 160px 160px"). */
export function gridColumnCount(templateColumns: string | null | undefined): number {
  const tracks = (templateColumns ?? "").trim().split(/\s+/).filter((track) => track && track !== "none");
  return Math.max(1, tracks.length);
}
