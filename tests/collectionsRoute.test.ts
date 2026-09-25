import { expect, test } from "bun:test";
import { createAppHistoryState, readAppHistorySection } from "../src/appShellNavigation";
import { formatRoute, parseRoute } from "../src/router";
import {
  carriedCollectionsState,
  collectionsBackAction,
  collectionsRoute,
  createCollectionsHistoryState,
  parentCollectionsRoute,
  readCollectionsHistoryHint,
  readCollectionsSearch,
  underlyingViewFor,
  withCollectionsSearch
} from "../src/collectionsRoute";
import { closeTopLayer, openLayer, openLayerCount } from "../src/collections/dialogLayers";

const collectionId = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const viewId = "4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const rowId = "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d";

test("Collections URLs parse strictly, normalise, and round-trip", () => {
  const table: Array<[string, ReturnType<typeof collectionsRoute>]> = [
    ["/collections", collectionsRoute()],
    [`/collections/${collectionId}`, collectionsRoute(collectionId)],
    [`/collections/${collectionId}/view/${viewId}`, collectionsRoute(collectionId, { viewId })],
    [`/collections/${collectionId}/row/${rowId}`, collectionsRoute(collectionId, { rowId })]
  ];
  for (const [path, route] of table) {
    expect(parseRoute(path)).toEqual(route);
    expect(formatRoute(route)).toBe(path);
  }
  expect(parseRoute(`/collections/${collectionId.toUpperCase()}/ROW/${rowId}`)).toEqual(collectionsRoute(collectionId));
  expect(parseRoute(`/collections/${collectionId.toUpperCase()}/row/${rowId.toUpperCase()}/`)).toEqual(collectionsRoute(collectionId, { rowId }));
  // Malformed pieces degrade to the collection, or to the list.
  expect(parseRoute("/collections/nope")).toEqual(collectionsRoute());
  expect(parseRoute(`/collections/${collectionId}/row/nope`)).toEqual(collectionsRoute(collectionId));
  expect(parseRoute(`/collections/${collectionId}/rows/${rowId}`)).toEqual(collectionsRoute(collectionId));
  expect(parseRoute(`/collections/${collectionId}/row/${rowId}/extra`)).toEqual(collectionsRoute(collectionId));
  expect(parseRoute("/collectionsx")).toEqual({ app: "home" });
  // Formatting never escapes the origin, and a row wins over a view.
  expect(formatRoute({ app: "collections", collectionId: "../x", viewId: null, rowId })).toBe("/collections");
  expect(formatRoute({ app: "collections", collectionId, viewId: "javascript:x", rowId: null })).toBe(`/collections/${collectionId}`);
  expect(formatRoute({ app: "collections", collectionId, viewId, rowId })).toBe(`/collections/${collectionId}/row/${rowId}`);
  expect(collectionsRoute(null, { rowId })).toEqual(collectionsRoute());
  expect(readAppHistorySection(createAppHistoryState("user-1", "collections", null), "user-1")).toBe("collections");
});

test("Back steps row → view → collection → list → Home and never leaves Nook", () => {
  expect(parentCollectionsRoute(collectionsRoute(collectionId, { rowId }), viewId)).toEqual(collectionsRoute(collectionId, { viewId }));
  expect(parentCollectionsRoute(collectionsRoute(collectionId, { rowId }))).toEqual(collectionsRoute(collectionId));
  expect(parentCollectionsRoute(collectionsRoute(collectionId, { viewId }))).toEqual(collectionsRoute(collectionId));
  expect(parentCollectionsRoute(collectionsRoute(collectionId))).toEqual(collectionsRoute());
  expect(parentCollectionsRoute(collectionsRoute())).toBeNull();
  // 390 px walk: list → collection → view → row pushed 3 entries over the list (depth 1 from Home).
  let depth = 4;
  for (const route of [collectionsRoute(collectionId, { rowId }), collectionsRoute(collectionId, { viewId }), collectionsRoute(collectionId), collectionsRoute()]) {
    expect(collectionsBackAction(route, depth)).toEqual({ kind: "history" });
    depth -= 1;
  }
  // A deep link (depth 0) replaces its entry with the parent view, and goes Home from the list.
  expect(collectionsBackAction(collectionsRoute(collectionId, { rowId }), 0, viewId)).toEqual({ kind: "replace", route: collectionsRoute(collectionId, { viewId }) });
  expect(collectionsBackAction(collectionsRoute(), 0)).toEqual({ kind: "home" });
});

test("row entries remember the view they were opened over, bound to user and row", () => {
  const state = createCollectionsHistoryState("user-1", { collectionId, rowId, viewId }, { "mynotes.depth": 3, other: 1 });
  expect(readCollectionsHistoryHint(state, "user-1")).toEqual({ collectionId, rowId, viewId });
  expect(readCollectionsHistoryHint(state, "user-2")).toBeNull();
  expect((state as unknown as Record<string, unknown>)["mynotes.depth"]).toBe(3);
  expect(underlyingViewFor(state, "user-1", collectionsRoute(collectionId, { rowId }))).toBe(viewId);
  expect(underlyingViewFor(state, "user-1", collectionsRoute(collectionId, { rowId: viewId }))).toBeNull();
  expect(underlyingViewFor(state, "user-1", collectionsRoute(collectionId))).toBeNull();
  expect(carriedCollectionsState("user-1", collectionsRoute(collectionId, { rowId }), state)).not.toBeNull();
  expect(carriedCollectionsState("user-1", collectionsRoute(collectionId), state)).toBeNull();
  for (const hint of [{ collectionId, rowId, viewId: 5 }, { collectionId, viewId }, null]) {
    expect(readCollectionsHistoryHint({ "mynotes.collections-navigation": { version: 1, userId: "user-1", hint } }, "user-1")).toBeNull();
  }
});

test("the row search query rides in the list entry's history state, bound to the user", () => {
  const state = withCollectionsSearch("user-1", "saffron", { "mynotes.depth": 2 });
  expect(readCollectionsSearch(state, "user-1")).toBe("saffron");
  expect(readCollectionsSearch(state, "user-2")).toBe("");
  expect((state as Record<string, unknown>)["mynotes.depth"]).toBe(2);
  expect(readCollectionsSearch(withCollectionsSearch("user-1", "  ", state), "user-1")).toBe("");
  expect(readCollectionsSearch(withCollectionsSearch("user-1", "x".repeat(300), null), "user-1")).toHaveLength(200);
});

test("Back closes only the top-most open layer (a picker over the row panel), then nothing", () => {
  expect(openLayerCount()).toBe(0);
  const closed: string[] = [];
  const moves: string[] = [];
  const undo = (direction: "back" | "forward") => { moves.push(direction); };
  const removeSheet = openLayer(() => closed.push("sort sheet"), 3);
  openLayer(() => closed.push("picker"), 3);
  // Back from depth 3 lands on depth 2: the picker closes and the move is undone (history.go(1)).
  expect(closeTopLayer({ "mynotes.depth": 2 }, undo)).toBe(true);
  expect(closed).toEqual(["picker"]);
  expect(moves).toEqual(["back"]);
  // Forward closes the next layer the same way.
  expect(closeTopLayer({ "mynotes.depth": 4 }, undo)).toBe(true);
  expect(closed).toEqual(["picker", "sort sheet"]);
  expect(moves).toEqual(["back", "forward"]);
  removeSheet();
  // Nothing open: the popstate is left to the route handlers.
  expect(closeTopLayer({ "mynotes.depth": 1 }, undo)).toBe(false);
  expect(openLayerCount()).toBe(0);
});
