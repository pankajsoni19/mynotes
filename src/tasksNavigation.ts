// Phone column hint for Tasks board entries. The URL carries the board (and card); this payload adds
// which column the one-column phone layout was showing, updated in place with replaceState so
// swiping between columns never adds history entries.
export const MAX_COLUMN_INDEX = 19;

export type TasksNavigationHint = { boardId: string; column: number };

const historyKey = "mynotes.tasks-navigation";
const historyVersion = 1;

export type TasksHistoryState = {
  [historyKey]: { version: number; userId: string; hint: TasksNavigationHint };
};

export function createTasksHistoryState(userId: string, hint: TasksNavigationHint, currentState: unknown): TasksHistoryState {
  const base = currentState && typeof currentState === "object" ? currentState as Record<string, unknown> : {};
  const column = Math.min(MAX_COLUMN_INDEX, Math.max(0, Math.floor(hint.column)));
  return { ...base, [historyKey]: { version: historyVersion, userId, hint: { boardId: hint.boardId, column } } };
}

export function readTasksHistoryHint(state: unknown, userId: string): TasksNavigationHint | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[historyKey];
  if (!value || typeof value !== "object") return null;
  const entry = value as { version?: unknown; userId?: unknown; hint?: unknown };
  if (entry.version !== historyVersion || entry.userId !== userId || !entry.hint || typeof entry.hint !== "object") return null;
  const hint = entry.hint as Partial<TasksNavigationHint>;
  if (typeof hint.boardId !== "string" || typeof hint.column !== "number" || !Number.isInteger(hint.column) || hint.column < 0 || hint.column > MAX_COLUMN_INDEX) return null;
  return { boardId: hint.boardId, column: hint.column };
}

/** The column to show for `boardId`: the entry's hint when it is for this board, clamped to the columns that exist. */
export function columnIndexFor(state: unknown, userId: string, boardId: string, columnCount: number) {
  const hint = readTasksHistoryHint(state, userId);
  if (!hint || hint.boardId !== boardId || columnCount <= 0) return 0;
  return Math.min(hint.column, columnCount - 1);
}

/** Keeps the current entry's hint when a write (a replace or URL normalisation) stays on the same board. */
export function carriedTasksState(userId: string, boardId: string | null, currentState: unknown): TasksHistoryState | null {
  const hint = readTasksHistoryHint(currentState, userId);
  return hint && boardId && hint.boardId === boardId ? createTasksHistoryState(userId, hint, null) : null;
}
