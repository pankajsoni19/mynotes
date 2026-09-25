import { readableNotePredicate } from "../access";
import { listBin } from "../bin";
import { db } from "../db";
import { recentListableDocuments } from "../documentAccess";
import { storageUsage } from "../documents";
import { hasScope, type McpScope } from "../mcpScopes";
import { checksum } from "../storage";
import { readableBoardPredicate } from "../tasks/access";
import { addDays, page, registerTodayProvider, TODAY_FETCH } from "./registry";

/**
 * The built-in Today sections (docs/plan/WAVES_10-12.md §2.2). Each one reads
 * through the owning module's predicate or list function:
 *
 * - tasks: `readableBoardPredicate` (the Tasks board list), live cards, columns not marked done
 * - notes: `readableNotePredicate` (the Notes list and search)
 * - files: `recentListableDocuments` (the Files list predicate, `purpose = 'file'`)
 * - Bin: `listBin`; storage: `storageUsage` (the upload quota's own sum)
 */

export const TASKS_DUE_DAYS = 7;
export const BIN_SOON_MS = 3 * 86_400_000;

type TaskRow = { cardId: string; boardId: string; boardName: string; title: string; dueOn: string | null; assigneeId: string | null };

const taskSelect = `
  SELECT k.id AS cardId, b.id AS boardId, b.name AS boardName, k.title, k.due_on AS dueOn, k.assignee_id AS assigneeId
  FROM cards k JOIN boards b ON b.id = k.board_id JOIN board_columns col ON col.id = k.column_id
  WHERE k.deleted_at IS NULL AND col.is_done = 0 AND ${readableBoardPredicate}`;

const taskItem = (row: TaskRow, today: string) => ({
  cardId: row.cardId, boardId: row.boardId, boardName: row.boardName, title: row.title,
  dueOn: row.dueOn, overdue: row.dueOn !== null && row.dueOn < today
});

registerTodayProvider("tasksDue", {
  mcpScope: "tasks:read",
  href: "/tasks",
  load: ({ userId, today }) => page((db.query(`${taskSelect} AND k.due_on IS NOT NULL AND k.due_on <= $horizon
      ORDER BY k.due_on, k.updated_at DESC, k.id LIMIT $limit`)
    .all({ userId, horizon: addDays(today, TASKS_DUE_DAYS), limit: TODAY_FETCH }) as TaskRow[]).map((row) => taskItem(row, today)))
});

registerTodayProvider("tasksMine", {
  mcpScope: "tasks:read",
  href: "/tasks",
  load: ({ userId, today }) => page((db.query(`${taskSelect} AND (k.assignee_id = $userId OR k.created_by = $userId)
      ORDER BY k.due_on IS NULL, k.due_on, k.updated_at DESC, k.id LIMIT $limit`)
    .all({ userId, limit: TODAY_FETCH }) as TaskRow[])
    .map((row) => ({ ...taskItem(row, today), reason: row.assigneeId === userId ? "assigned" as const : "created" as const })))
});

/**
 * Recently changed notes the caller can read. Recipients see a note only once
 * it is published (GET /api/notes/:id refuses them before that), with its
 * published title and time, so the owner's draft activity stays private.
 */
registerTodayProvider("notesRecent", {
  mcpScope: "notes:read",
  href: "/notes",
  load: ({ userId }) => page((db.query(`
      SELECT n.id, CASE WHEN n.owner_id = $userId THEN n.title ELSE v.title END AS title, u.display_name AS owner_name,
             CASE WHEN n.owner_id = $userId THEN 1 ELSE 0 END AS is_owner,
             CASE WHEN n.owner_id = $userId THEN n.updated_at ELSE v.created_at END AS updated_at
      FROM notes n JOIN users u ON u.id = n.owner_id
      LEFT JOIN note_versions v ON v.note_id = n.id AND v.version_number = n.current_version
      WHERE n.deleted_at IS NULL AND ${readableNotePredicate} AND (n.owner_id = $userId OR v.id IS NOT NULL)
      ORDER BY 5 DESC, n.id LIMIT $limit`).all({ userId, limit: TODAY_FETCH }) as Array<{ id: string; title: string; owner_name: string; is_owner: 0 | 1; updated_at: string }>))
});

const EMPTY_CHECKSUM = checksum("");

/** The caller's own drafts that differ from what is published (blank never-published drafts are not drafts). */
registerTodayProvider("drafts", {
  mcpScope: "notes:read",
  href: "/notes",
  load: ({ userId }) => page((db.query(`
      SELECT n.id, n.title, n.updated_at, n.current_version = 0 AS neverPublished
      FROM notes n
      WHERE n.owner_id = $userId AND n.deleted_at IS NULL AND n.draft_revision IS NOT NULL AND n.draft_mcp_key_id IS NULL
        AND ((n.current_version = 0 AND n.draft_checksum <> $empty) OR EXISTS (
          SELECT 1 FROM note_versions v WHERE v.note_id = n.id AND v.version_number = n.current_version AND v.checksum <> n.draft_checksum))
      ORDER BY n.updated_at DESC, n.id LIMIT $limit`).all({ userId, empty: EMPTY_CHECKSUM, limit: TODAY_FETCH }) as Array<{ id: string; title: string; updated_at: string; neverPublished: number }>)
    .map((row) => ({ ...row, neverPublished: row.neverPublished === 1 })))
});

/** Whether migration 010 (MCP key scopes, W8) is present: without it there are no agent drafts, and the section is absent. */
const hasAgentDrafts = () => (db.query("PRAGMA table_info(notes)").all() as Array<{ name: string }>).some((column) => column.name === "draft_mcp_key_id");

registerTodayProvider("agentDrafts", {
  mcpScope: "notes:read",
  href: "/notes",
  available: hasAgentDrafts,
  load: ({ userId }) => page(db.query(`
      SELECT n.id, n.title, k.name AS keyName, n.updated_at
      FROM notes n JOIN mcp_api_keys k ON k.id = n.draft_mcp_key_id
      WHERE n.owner_id = $userId AND n.deleted_at IS NULL AND n.draft_revision IS NOT NULL
      ORDER BY n.updated_at DESC, n.id LIMIT $limit`).all({ userId, limit: TODAY_FETCH }) as Array<{ id: string; title: string; keyName: string; updated_at: string }>)
});

registerTodayProvider("files", {
  mcpScope: "files:read",
  href: "/files",
  load: ({ userId }) => page(recentListableDocuments(userId, TODAY_FETCH).map((document) => ({
    id: document.id, name: document.name, mime_type: document.mime_type, preview_kind: document.preview_kind, size_bytes: document.size_bytes,
    owner_name: document.owner_name, is_owner: document.is_owner, updated_at: document.updated_at
  })))
});

/**
 * The module read scope an MCP key needs to see a Bin item of each type in get_today (T74).
 * Types without an entry (Collections: there is no collections:read scope yet) are left out
 * for MCP callers. A signed-in session sees every type, as in the Bin itself.
 */
export const BIN_TYPE_MCP_SCOPE: Partial<Record<string, McpScope>> = { note: "notes:read", document: "files:read", card: "tasks:read", board: "tasks:read" };

export function binItemVisible(type: string, scopes: readonly McpScope[] | undefined) {
  if (!scopes) return true;
  const needed = BIN_TYPE_MCP_SCOPE[type];
  return needed !== undefined && hasScope(scopes, needed);
}

/** Items in the caller's Bin that are purged within three days, soonest first. */
registerTodayProvider("binSoon", {
  href: "/bin",
  load: ({ userId, now, scopes }) => {
    const cutoff = new Date(now.getTime() + BIN_SOON_MS).toISOString();
    return page(listBin(userId, null)
      .filter((item) => !item.purging && item.purge_after <= cutoff && binItemVisible(item.type, scopes))
      .sort((a, b) => a.purge_after.localeCompare(b.purge_after) || (a.id < b.id ? -1 : 1))
      .slice(0, TODAY_FETCH)
      .map((item) => ({ type: item.type, id: item.id, title: item.title, purge_after: item.purge_after })));
  }
});

registerTodayProvider("storage", {
  href: "/files",
  load: ({ userId }) => ({ items: [storageUsage(userId)], more: false })
});
