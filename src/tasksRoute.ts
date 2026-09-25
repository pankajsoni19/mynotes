import type { Route } from "./router";

export type TasksRoute = Extract<Route, { app: "tasks" }>;

export function tasksRoute(boardId: string | null = null, cardId: string | null = null): TasksRoute {
  return { app: "tasks", boardId, cardId: boardId ? cardId : null };
}

/**
 * The view one level up, used when in-app Back has no history entry of this visit to step back
 * to (a deep link): card → board → board list → Home (null).
 */
export function parentTasksRoute(route: TasksRoute): TasksRoute | null {
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
