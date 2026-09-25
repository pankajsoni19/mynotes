// Pure URL routing for the SPA. No DOM access, so it can be unit tested directly.

export type Route =
  | { app: "home" }
  | { app: "notes"; folder: "all" | "shared" | string; noteId: string | null }
  | { app: "files"; folder: "all" | "shared" | string; documentId: string | null }
  | { app: "calendar"; view: "agenda" | "month"; month: string | null; eventId: string | null }
  | { app: "notifications" }
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
  if (app === "calendar") return parseCalendar(rest);
  if (app === "notifications" && rest.length === 0) return { app: "notifications" };
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
  if (route.app === "calendar") {
    if (route.eventId && isRouteId(route.eventId)) return `/calendar/event/${route.eventId.toLowerCase()}`;
    if (route.view === "month") return route.month && isRouteMonth(route.month) ? `/calendar/month/${route.month}` : "/calendar/month";
    return "/calendar";
  }
  if (route.app === "notifications") return "/notifications";
  if (route.app === "bin") return "/bin";
  return "/";
}

export function sameRoute(left: Route, right: Route) {
  return formatRoute(left) === formatRoute(right);
}
