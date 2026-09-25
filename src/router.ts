// Pure URL routing for the SPA. No DOM access, so it can be unit tested directly.

export type Route =
  | { app: "home" }
  | { app: "notes"; folder: "all" | "shared" | string; noteId: string | null }
  | { app: "files"; folder: "all" | "shared" | string; documentId: string | null }
  | { app: "tasks"; boardId: string | null; cardId: string | null }
  | { app: "bin" };

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
function parseTasks(segments: string[]): Route {
  const [board, kind, card] = segments;
  if (board === undefined || !isRouteId(board)) return { app: "tasks", boardId: null, cardId: null };
  const boardId = board.toLowerCase();
  const cardId = segments.length === 3 && kind === "card" && card !== undefined && isRouteId(card) ? card.toLowerCase() : null;
  return { app: "tasks", boardId, cardId };
}

export function parseRoute(pathname: string): Route {
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
  if (app === "tasks") return parseTasks(rest);
  if (app === "bin" && rest.length === 0) return { app: "bin" };
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
    return route.cardId && isRouteId(route.cardId) ? `${board}/card/${route.cardId.toLowerCase()}` : board;
  }
  if (route.app === "bin") return "/bin";
  return "/";
}

export function sameRoute(left: Route, right: Route) {
  return formatRoute(left) === formatRoute(right);
}
