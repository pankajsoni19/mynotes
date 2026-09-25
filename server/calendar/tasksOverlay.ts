import type { Database } from "bun:sqlite";
import { db } from "../db";
import { readableBoardPredicate } from "../tasks/access";
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
 * migration 011, which always runs before this module loads; the columns are
 * still checked once at boot, so a database without them answers an empty
 * overlay rather than failing.
 *
 * Boards are filtered by the Tasks module's own `readableBoardPredicate`
 * (server/tasks/access.ts, WAVES_7-9.md §3.2; D51).
 */
export function createDueTasksQuery(database: Database) {
  const enabled = hasColumn(database, "cards", "due_on");
  const doneFilter = enabled && hasColumn(database, "board_columns", "is_done") ? "AND COALESCE(col.is_done, 0) = 0" : "";
  const sql = `SELECT c.id AS cardId, c.board_id AS boardId, b.name AS boardName, c.title, c.due_on AS dueOn
    FROM cards c JOIN boards b ON b.id = c.board_id JOIN board_columns col ON col.id = c.column_id
    WHERE c.deleted_at IS NULL AND c.due_on >= $fromDate AND c.due_on < $toDate ${doneFilter}
      AND ${readableBoardPredicate}
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

/** Due cards for `GET /api/events?include=tasks`. */
export const listDueTasks = (userId: string, range: Pick<ExpansionRange, "fromDate" | "toDate">) => dueTasks.list(userId, range);
export const dueTasksEnabled = () => dueTasks.enabled;
