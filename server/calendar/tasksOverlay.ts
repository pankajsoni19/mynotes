import type { Database } from "bun:sqlite";
import { db } from "../db";
import type { ExpansionRange } from "./recurrence";

export type DueTask = { cardId: string; boardId: string; boardName: string; title: string; dueOn: string };

/** Due cards returned per request. */
export const MAX_DUE_TASKS = 200;

const hasColumn = (database: Database, table: string, column: string) =>
  (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);

/**
 * The read-only "Tasks due" overlay (WAVES_10-12.md D67): live cards with a
 * `due_on` in the range, on boards the caller can read, in columns not
 * marked done. `cards.due_on` and `board_columns.is_done` arrive with
 * migration 011 (Wave 10); until then the overlay is empty. The columns are
 * checked once, when the module loads at boot, so it activates by itself
 * after that migration runs.
 *
 * The board predicate mirrors `readableBoardPredicate` in
 * server/tasks/access.ts (WAVES_7-9.md §3.2) and must stay identical to it;
 * replace this copy with that import once the Tasks module is merged (D51).
 */
export function createDueTasksQuery(database: Database) {
  const enabled = hasColumn(database, "cards", "due_on");
  const doneFilter = enabled && hasColumn(database, "board_columns", "is_done") ? "AND COALESCE(col.is_done, 0) = 0" : "";
  const sql = `SELECT c.id AS cardId, c.board_id AS boardId, b.name AS boardName, c.title, c.due_on AS dueOn
    FROM cards c JOIN boards b ON b.id = c.board_id JOIN board_columns col ON col.id = c.column_id
    WHERE c.deleted_at IS NULL AND c.due_on >= $fromDate AND c.due_on < $toDate ${doneFilter}
      AND b.deleted_at IS NULL AND (b.owner_id = $userId OR b.visibility = 'all_users'
        OR (b.visibility = 'selected' AND EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = $userId)))
    ORDER BY c.due_on, c.title COLLATE NOCASE, c.id LIMIT $limit`;
  return {
    enabled,
    list(userId: string, range: Pick<ExpansionRange, "fromDate" | "toDate">): DueTask[] {
      if (!enabled) return [];
      return database.query(sql).all({ userId, fromDate: range.fromDate, toDate: range.toDate, limit: MAX_DUE_TASKS }) as DueTask[];
    }
  };
}

const dueTasks = createDueTasksQuery(db);

/** Due cards for `GET /api/events?include=tasks`; always empty before migration 011. */
export const listDueTasks = (userId: string, range: Pick<ExpansionRange, "fromDate" | "toDate">) => dueTasks.list(userId, range);
export const dueTasksEnabled = () => dueTasks.enabled;
