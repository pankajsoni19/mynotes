import type { Route } from "./router";

export type TasksRoute = Extract<Route, { app: "tasks" }>;

export function tasksRoute(boardId: string | null = null, cardId: string | null = null, full = false): TasksRoute {
  const card = boardId ? cardId : null;
  return card && full ? { app: "tasks", boardId, cardId: card, full: true } : { app: "tasks", boardId, cardId: card };
}

/**
 * The view one level up, used when in-app Back has no history entry of this visit to step back
 * to (a deep link): full page → card dialog → board → board list → Home (null).
 */
export function parentTasksRoute(route: TasksRoute): TasksRoute | null {
  if (route.cardId && route.full) return tasksRoute(route.boardId, route.cardId);
  if (route.cardId) return tasksRoute(route.boardId);
  if (route.boardId) return tasksRoute();
  return null;
}

/**
 * In-app Back: step back through entries this visit pushed (the `mynotes.depth` counter), so it
 * matches the browser's Back; otherwise replace the entry with the parent view, or go Home from
 * the board list. It never leaves Nook.
 */
export function tasksBackAction(route: TasksRoute, depth: number): { kind: "history" } | { kind: "replace"; route: TasksRoute } | { kind: "home" } {
  if (depth > 0) return { kind: "history" };
  const parent = parentTasksRoute(route);
  return parent ? { kind: "replace", route: parent } : { kind: "home" };
}

// The entry that Expand pushes from the card dialog carries this hint (§4.7), so Collapse and Close
// on the full page know the dialog, and the board before it, are the entries just below.
const fromDialogKey = "mynotes.tasks.fromDialog";

export function withFromDialogHint(state: unknown) {
  const base = state && typeof state === "object" ? state as Record<string, unknown> : {};
  return { ...base, [fromDialogKey]: true };
}

export function hasFromDialogHint(state: unknown) {
  return Boolean(state && typeof state === "object" && (state as Record<string, unknown>)[fromDialogKey] === true);
}

/**
 * Collapse and Close on the full page (§4.7). With the hint, step back through the entries Expand
 * came from: Collapse returns to the dialog (one back) and Close to the entry before it (two back).
 * Otherwise (a deep link, a reload of an older entry, a page opened from a relation link) replace
 * the entry, so neither ever leaves Nook.
 */
export function fullPageAction(action: "collapse" | "close", route: TasksRoute, state: unknown, depth: number): { kind: "history"; delta: number } | { kind: "replace"; route: TasksRoute } {
  const hint = hasFromDialogHint(state);
  if (action === "collapse") return hint && depth > 0 ? { kind: "history", delta: -1 } : { kind: "replace", route: tasksRoute(route.boardId, route.cardId) };
  return hint && depth >= 2 ? { kind: "history", delta: -2 } : { kind: "replace", route: tasksRoute(route.boardId) };
}
