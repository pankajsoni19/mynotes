import { dayHeading, zonedParts } from "../calendar/calendarFormat";
import { eventRoute } from "../calendarRoute";
import { collectionsRoute } from "../collectionsRoute";
import { formatBytes } from "../files/filesApi";
import { relativeTime } from "../files/format";
import { parseRoute, type Route } from "../router";
import { dueStatus } from "../tasks/taskActions";

/** One rendered row: the link text, a short second line, and where it goes. */
export type TodayRow = { key: string; label: string; meta: string; route: Route; tone?: "overdue" | "today" | "soon" };

export type TodaySectionDef = {
  title: string;
  empty: string;
  /** Turns one server item into a row; `date` is Today's date in the viewer's zone. */
  row?: (item: Record<string, any>, date: string) => TodayRow;
  /** The app the "View all" link opens, for its accessible name. */
  app: string;
};

const noteRoute = (id: string): Route => ({ app: "notes", folder: "all", noteId: id });

/** An upcoming occurrence: "Today · 09:30" in the browser's zone, or "Tomorrow · All day". */
function upcomingRow(item: Record<string, any>, date: string): TodayRow {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = item.allDay ? { date: String(item.date ?? item.start), time: "All day" } : zonedParts(item.start, zone);
  const day = start.date < date ? date : start.date;
  return { key: `${item.eventId}:${item.start}`, label: item.title || "Untitled event", meta: `${dayHeading(day, date)} · ${start.time}`, route: eventRoute(item.eventId), ...(day === date ? { tone: "today" as const } : {}) };
}

function taskRow(item: Record<string, any>, date: string): TodayRow {
  const due = dueStatus(item.dueOn ?? null, date);
  const reason = item.reason === "assigned" ? "Assigned to you" : item.reason === "created" ? "Added by you" : null;
  return {
    key: item.cardId,
    label: item.title,
    meta: [item.boardName, due?.description, reason].filter(Boolean).join(" · "),
    route: { app: "tasks", boardId: item.boardId, cardId: item.cardId },
    ...(due && due.tone !== "later" ? { tone: due.tone } : {})
  };
}

const binTypeLabel: Record<string, string> = { note: "Note", document: "File", card: "Card", board: "Board", collection: "Collection", collection_row: "Row", calendar: "Calendar", event: "Event" };

/**
 * Client copy for each Today section, in the default order. A section the
 * server does not return (its module is not installed) is not shown; a
 * section the client has no entry for is skipped. Later modules add theirs.
 */
export const TODAY_SECTIONS: Record<string, TodaySectionDef> = {
  tasksDue: { title: "Due soon", empty: "Nothing is due in the next seven days.", app: "Tasks", row: taskRow },
  tasksMine: { title: "My tasks", empty: "No open cards assigned to you or added by you.", app: "Tasks", row: taskRow },
  notesRecent: {
    title: "Recent notes", empty: "No notes yet.", app: "Notes",
    row: (item) => ({ key: item.id, label: item.title || "Untitled", meta: [item.is_owner ? null : item.owner_name, `Updated ${relativeTime(item.updated_at)}`].filter(Boolean).join(" · "), route: noteRoute(item.id) })
  },
  drafts: {
    title: "Unpublished drafts", empty: "No unpublished drafts.", app: "Notes",
    row: (item) => ({ key: item.id, label: item.title || "Untitled", meta: `${item.neverPublished ? "Never published" : "Unpublished changes"} · ${relativeTime(item.updated_at)}`, route: noteRoute(item.id) })
  },
  agentDrafts: {
    title: "Drafts from agents", empty: "No drafts written by MCP keys.", app: "Notes",
    row: (item) => ({ key: item.id, label: item.title || "Untitled", meta: `Draft by ${item.keyName} · ${relativeTime(item.updated_at)}`, route: noteRoute(item.id) })
  },
  files: {
    title: "Recent files", empty: "No files yet.", app: "Files",
    row: (item) => ({ key: item.id, label: item.name, meta: [formatBytes(item.size_bytes), item.is_owner ? null : item.owner_name, relativeTime(item.updated_at)].filter(Boolean).join(" · "), route: { app: "files", folder: "all", documentId: item.id } })
  },
  collectionsRecent: {
    title: "Recently edited rows", empty: "No rows edited yet.", app: "Collections",
    row: (item) => ({
      key: item.rowId,
      label: item.title || "Untitled",
      meta: [item.collectionName, item.changedByKey ? "Changed by an MCP key" : null, `Updated ${relativeTime(item.updated_at)}`].filter(Boolean).join(" · "),
      route: collectionsRoute(item.collectionId, { rowId: item.rowId })
    })
  },
  binSoon: {
    title: "Leaving the Bin soon", empty: "Nothing in your Bin is deleted forever in the next three days.", app: "Bin",
    row: (item) => ({ key: `${item.type}:${item.id}`, label: item.title || "Untitled", meta: `${binTypeLabel[item.type] ?? "Item"} · deleted forever ${relativeTime(item.purge_after)}`, route: { app: "bin" } })
  },
  upcoming: { title: "Upcoming", empty: "Nothing on your calendars in the next seven days.", app: "Calendar", row: upcomingRow },
  storage: { title: "Storage", empty: "", app: "Files" }
};

export const DEFAULT_SECTION_ORDER = Object.keys(TODAY_SECTIONS);

/** The "View all" route: the section's href, parsed like any other in-app URL. */
export const viewAllRoute = (href: string): Route => parseRoute(href);

export type StorageUsage = { usedBytes: number; binnedBytes: number; quotaBytes: number | null };

/** "3.2 GB of 10 GB", plus how much of it is in the Bin. */
export function storageText(usage: StorageUsage) {
  const used = formatBytes(usage.usedBytes) || "0 B";
  const summary = usage.quotaBytes ? `${used} of ${formatBytes(usage.quotaBytes)}` : `${used} used`;
  return { summary, detail: usage.binnedBytes > 0 ? `${formatBytes(usage.binnedBytes)} of it is in the Bin` : usage.quotaBytes ? "Nothing in the Bin" : "No storage limit" };
}
