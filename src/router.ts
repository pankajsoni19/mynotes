// Pure URL routing for the SPA. No DOM access, so it can be unit tested directly.
import { formatBoardSearch, isDefaultBoardQuery, parseBoardSearch, type BoardQuery } from "./tasks/boardUrl";

export type Route =
  | { app: "home" }
  | { app: "notes"; folder: "all" | "shared" | string; noteId: string | null }
  | { app: "files"; folder: "all" | "shared" | string; documentId: string | null }
  // `query` (D112): a board's view, grouping, sort, and filters, carried in the URL query. It is
  // left out when it is the default, and never set without a board.
  | { app: "tasks"; boardId: string | null; cardId: string | null; query?: BoardQuery }
  | { app: "collections"; collectionId: string | null; viewId: string | null; rowId: string | null }
  | { app: "calendar"; view: "agenda" | "month"; month: string | null; eventId: string | null }
  | { app: "notifications" }
  | { app: "bin" }
  | { app: "team"; userId: string | null };

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRouteId(value: string) {
  return idPattern.test(value);
}

function parseCollection(segments: string[]): { folder: string; itemId: string | null } {
  // Server ids are lowercase; normalise so a pasted uppercase link still matches.
  const rest = segments.map((segment) => isRouteId(segment) ? segment.toLowerCase() : segment);
  const [first, second] = rest;
  if (first === undefined) return { folder: "all", itemId: null };
  if (first === "shared" && rest.length === 1) return { folder: "shared", itemId: null };
  if (first === "folder") return { folder: second !== undefined && rest.length === 2 && isRouteId(second) ? second : "all", itemId: null };
  if (rest.length === 1 && isRouteId(first)) return { folder: "all", itemId: first };
  return { folder: "all", itemId: null };
}

// /tasks, /tasks/:boardId, and /tasks/:boardId/card/:cardId. Anything malformed after a valid
// board id still opens that board; a malformed board id opens the board list.
// The query (view, filters) belongs to the board: it is kept on its cards' URLs too, so closing a
// card returns to the same view (D112).
function parseTasks(segments: string[], search: string): Route {
  const [board, kind, card] = segments;
  if (board === undefined || !isRouteId(board)) return { app: "tasks", boardId: null, cardId: null };
  const boardId = board.toLowerCase();
  const cardId = segments.length === 3 && kind === "card" && card !== undefined && isRouteId(card) ? card.toLowerCase() : null;
  const query = parseBoardSearch(search);
  return isDefaultBoardQuery(query) ? { app: "tasks", boardId, cardId } : { app: "tasks", boardId, cardId, query };
}

// /collections, /collections/:c, /collections/:c/view/:v, and /collections/:c/row/:r. Anything
// malformed after a valid collection id still opens that collection.
function parseCollections(segments: string[]): Route {
  const [collection, kind, item] = segments;
  const none = { app: "collections" as const, collectionId: null, viewId: null, rowId: null };
  if (collection === undefined || !isRouteId(collection)) return none;
  const collectionId = collection.toLowerCase();
  const itemId = segments.length === 3 && item !== undefined && isRouteId(item) ? item.toLowerCase() : null;
  return { ...none, collectionId, viewId: kind === "view" ? itemId : null, rowId: kind === "row" ? itemId : null };
}

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A `yyyy-mm` month between 1900 and 2200. */
export function isRouteMonth(value: string) {
  const match = monthPattern.exec(value);
  return match !== null && Number(match[1]) >= 1900 && Number(match[1]) <= 2200;
}

// /calendar (agenda), /calendar/month/:yyyy-mm, and /calendar/event/:eventId. A malformed month opens
// the month view at the current month (the app fills it in); anything else malformed opens the agenda.
function parseCalendar(segments: string[]): Route {
  const [kind, value] = segments;
  if (kind === "month" && segments.length <= 2) return { app: "calendar", view: "month", month: value !== undefined && isRouteMonth(value) ? value : null, eventId: null };
  if (kind === "event" && segments.length === 2 && value !== undefined && isRouteId(value)) return { app: "calendar", view: "agenda", month: null, eventId: value.toLowerCase() };
  return { app: "calendar", view: "agenda", month: null, eventId: null };
}

/**
 * A location's route. `search` is the location's query (`location.search`): only Tasks reads it
 * (D112), and every Tasks caller must pass it, or a reload or Back drops the board's view and
 * filters (`tests/routerSearch.test.ts` checks the call sites). A `pathname` that still carries
 * its own `?query` (an in-app href) is split first.
 */
export function parseRoute(pathname: string, search = ""): Route {
  const mark = pathname.indexOf("?");
  if (mark >= 0) {
    if (!search) search = pathname.slice(mark);
    pathname = pathname.slice(0, mark);
  }
  const segments = pathname.split("/").filter(Boolean);
  const [app, ...rest] = segments;
  if (app === "notes") {
    const { folder, itemId } = parseCollection(rest);
    return { app: "notes", folder, noteId: itemId };
  }
  if (app === "files") {
    const { folder, itemId } = parseCollection(rest);
    return { app: "files", folder, documentId: itemId };
  }
  if (app === "tasks") return parseTasks(rest, search);
  if (app === "collections") return parseCollections(rest);
  if (app === "calendar") return parseCalendar(rest);
  if (app === "notifications" && rest.length === 0) return { app: "notifications" };
  if (app === "bin" && rest.length === 0) return { app: "bin" };
  // /team and /team/:userId. A malformed id, or anything after it, opens the list.
  if (app === "team") return { app: "team", userId: rest.length === 1 && isRouteId(rest[0]!) ? rest[0]!.toLowerCase() : null };
  return { app: "home" };
}

function formatCollection(base: string, folder: string, itemId: string | null) {
  if (itemId && isRouteId(itemId)) return `${base}/${itemId.toLowerCase()}`;
  if (folder === "shared") return `${base}/shared`;
  if (folder !== "all" && isRouteId(folder)) return `${base}/folder/${folder.toLowerCase()}`;
  return base;
}

// An open item wins over its folder: the folder is derived from the item when the URL is parsed.
export function formatRoute(route: Route): string {
  if (route.app === "notes") return formatCollection("/notes", route.folder, route.noteId);
  if (route.app === "files") return formatCollection("/files", route.folder, route.documentId);
  if (route.app === "tasks") {
    if (!route.boardId || !isRouteId(route.boardId)) return "/tasks";
    const board = `/tasks/${route.boardId.toLowerCase()}`;
    const search = route.query ? formatBoardSearch(route.query) : "";
    return `${route.cardId && isRouteId(route.cardId) ? `${board}/card/${route.cardId.toLowerCase()}` : board}${search}`;
  }
  if (route.app === "collections") {
    if (!route.collectionId || !isRouteId(route.collectionId)) return "/collections";
    const collection = `/collections/${route.collectionId.toLowerCase()}`;
    // A row wins over a view: the row panel is the deeper entry.
    if (route.rowId && isRouteId(route.rowId)) return `${collection}/row/${route.rowId.toLowerCase()}`;
    return route.viewId && isRouteId(route.viewId) ? `${collection}/view/${route.viewId.toLowerCase()}` : collection;
  }
  if (route.app === "calendar") {
    if (route.eventId && isRouteId(route.eventId)) return `/calendar/event/${route.eventId.toLowerCase()}`;
    if (route.view === "month") return route.month && isRouteMonth(route.month) ? `/calendar/month/${route.month}` : "/calendar/month";
    return "/calendar";
  }
  if (route.app === "notifications") return "/notifications";
  if (route.app === "bin") return "/bin";
  if (route.app === "team") return route.userId && isRouteId(route.userId) ? `/team/${route.userId.toLowerCase()}` : "/team";
  return "/";
}

/** A location's route, with its query (the one way DOM callers should parse the current URL). */
export const routeFromLocation = (location: { pathname: string; search: string }) => parseRoute(location.pathname, location.search);

/**
 * The part of a location `formatRoute` produces, to compare against it: the path, plus the query
 * on Tasks URLs (the only app whose URLs carry one).
 */
export function locationUrl(location: { pathname: string; search: string }) {
  return /^\/tasks(\/|$)/.test(location.pathname) ? `${location.pathname}${location.search}` : location.pathname;
}

export function sameRoute(left: Route, right: Route) {
  return formatRoute(left) === formatRoute(right);
}
