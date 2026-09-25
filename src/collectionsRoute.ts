import type { Route } from "./router";

export type CollectionsRoute = Extract<Route, { app: "collections" }>;

/** A route for the Collections app. A row wins over a view; neither exists without a collection. */
export function collectionsRoute(collectionId: string | null = null, options: { viewId?: string | null; rowId?: string | null } = {}): CollectionsRoute {
  if (!collectionId) return { app: "collections", collectionId: null, viewId: null, rowId: null };
  const rowId = options.rowId ?? null;
  return { app: "collections", collectionId, viewId: rowId ? null : options.viewId ?? null, rowId };
}

/**
 * The view one level up, used when in-app Back has no history entry of this visit to step back to
 * (a deep link): row → the view it was opened over (or the collection) → collection → list → Home (null).
 */
export function parentCollectionsRoute(route: CollectionsRoute, underlyingViewId: string | null = null): CollectionsRoute | null {
  if (route.rowId) return collectionsRoute(route.collectionId, { viewId: underlyingViewId });
  if (route.viewId) return collectionsRoute(route.collectionId);
  if (route.collectionId) return collectionsRoute();
  return null;
}

/**
 * In-app Back: step back through entries this visit pushed (the `mynotes.depth` counter), so it matches
 * the browser's Back; otherwise replace the entry with the parent view, or go Home from the list. It
 * never leaves Nook.
 */
export function collectionsBackAction(route: CollectionsRoute, depth: number, underlyingViewId: string | null = null):
  { kind: "history" } | { kind: "replace"; route: CollectionsRoute } | { kind: "home" } {
  if (depth > 0) return { kind: "history" };
  const parent = parentCollectionsRoute(route, underlyingViewId);
  return parent ? { kind: "replace", route: parent } : { kind: "home" };
}

// The row panel is drawn over the table of the view it was opened from. The row URL does not carry
// that view, so row entries record it in history state (like the Tasks column hint).
const historyKey = "mynotes.collections-navigation";
const historyVersion = 1;

export type CollectionsNavigationHint = { collectionId: string; rowId: string; viewId: string | null };
export type CollectionsHistoryState = { [historyKey]: { version: number; userId: string; hint: CollectionsNavigationHint } };

export function createCollectionsHistoryState(userId: string, hint: CollectionsNavigationHint, currentState: unknown): CollectionsHistoryState {
  const base = currentState && typeof currentState === "object" ? currentState as Record<string, unknown> : {};
  return { ...base, [historyKey]: { version: historyVersion, userId, hint: { collectionId: hint.collectionId, rowId: hint.rowId, viewId: hint.viewId } } };
}

export function readCollectionsHistoryHint(state: unknown, userId: string): CollectionsNavigationHint | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[historyKey];
  if (!value || typeof value !== "object") return null;
  const entry = value as { version?: unknown; userId?: unknown; hint?: unknown };
  if (entry.version !== historyVersion || entry.userId !== userId || !entry.hint || typeof entry.hint !== "object") return null;
  const hint = entry.hint as Partial<CollectionsNavigationHint>;
  if (typeof hint.collectionId !== "string" || typeof hint.rowId !== "string" || (hint.viewId !== null && typeof hint.viewId !== "string")) return null;
  return { collectionId: hint.collectionId, rowId: hint.rowId, viewId: hint.viewId };
}

/** The view a row entry was opened over, when the entry's hint is for this row. */
export function underlyingViewFor(state: unknown, userId: string, route: CollectionsRoute) {
  const hint = readCollectionsHistoryHint(state, userId);
  return hint && route.rowId && hint.rowId === route.rowId && hint.collectionId === route.collectionId ? hint.viewId : null;
}

// The row search on the list page keeps its query in history state (never in the URL), so Back from
// a result returns to the results (as in Notes search, WAVES_7-9.md §7 change 3).
const searchKey = "mynotes.collections-search";

export function withCollectionsSearch(userId: string, q: string, currentState: unknown) {
  const base = currentState && typeof currentState === "object" ? { ...currentState as Record<string, unknown> } : {};
  if (q.trim()) base[searchKey] = { version: historyVersion, userId, q: q.slice(0, 200) };
  else delete base[searchKey];
  return base;
}

export function readCollectionsSearch(state: unknown, userId: string) {
  if (!state || typeof state !== "object") return "";
  const value = (state as Record<string, unknown>)[searchKey] as { version?: unknown; userId?: unknown; q?: unknown } | undefined;
  return value && value.version === historyVersion && value.userId === userId && typeof value.q === "string" ? value.q.slice(0, 200) : "";
}

/** Keeps the current entry's hint when a write (a replace or URL normalisation) stays on the same row. */
export function carriedCollectionsState(userId: string, route: CollectionsRoute, currentState: unknown): CollectionsHistoryState | null {
  const hint = readCollectionsHistoryHint(currentState, userId);
  return hint && route.rowId && hint.rowId === route.rowId && hint.collectionId === route.collectionId ? createCollectionsHistoryState(userId, hint, null) : null;
}
