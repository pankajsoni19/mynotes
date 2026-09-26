import { db } from "../db";
import type { SprintState } from "../../shared/sprintPlan";

/**
 * Sprint reads shared by the card service and the sprint lifecycle (research 2026-09-26 D124,
 * D134, §6.1). No imports from the service, so both can use it without a cycle.
 *
 * - Only work-level cards store `cards.sprint_id`; a card below the work level has the sprint of
 *   its ancestor, derived on every read and never stored (D124). `EFFECTIVE_SPRINT_SQL` is that
 *   rule over a card `k`: its own, its parent's, or its grandparent's (depth ≤ 2, no recursion).
 * - Counts are one grouped query per board over live cards (D134), never a per-sprint subquery.
 * - The database state `closed` is `completed` in the API.
 */

export const SPRINT_LIMITS = {
  /** Planned plus active sprints per board (D135); completed ones are unbounded but paged. */
  openPerBoard: 50,
  /** Completed sprints the board payload carries (the switcher's recent history). */
  recentCompleted: 5,
  /** A page of completed sprints in `GET /boards/:b/sprints`. */
  page: 20
} as const;

/** The effective sprint of card `k`: stored on the work level, inherited below it (D124). */
export const EFFECTIVE_SPRINT_SQL = `COALESCE(k.sprint_id,
  (SELECT sp.sprint_id FROM cards sp WHERE sp.id = k.parent_card_id),
  (SELECT sg.sprint_id FROM cards sp JOIN cards sg ON sg.id = sp.parent_card_id WHERE sp.id = k.parent_card_id))`;

export type SprintRow = {
  id: string;
  board_id: string;
  name: string;
  goal: string;
  start_on: string | null;
  end_on: string | null;
  state: "planned" | "active" | "closed";
  position: number;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SprintSummary = {
  id: string;
  board_id: string;
  name: string;
  goal: string;
  start_on: string | null;
  end_on: string | null;
  state: SprintState;
  is_active: boolean;
  position: number;
  completed_at: string | null;
  /** Live work-level cards in the sprint, and those in a done column (subtasks are not counted). */
  card_count: number;
  done_count: number;
  created_at: string;
  updated_at: string;
};

export const apiState = (state: SprintRow["state"]): SprintState => state === "closed" ? "completed" : state;

const sprintColumns = "s.id, s.board_id, s.name, s.goal, s.start_on, s.end_on, s.state, s.position, s.closed_at, s.created_by, s.created_at, s.updated_at";

/** Stored-sprint counts for one board: live cards per sprint and those in a done column. */
export function sprintCounts(boardId: string) {
  const rows = db.query(`SELECT k.sprint_id, COUNT(*) AS card_count, COALESCE(SUM(col.is_done), 0) AS done_count
    FROM cards k JOIN board_columns col ON col.id = k.column_id
    WHERE k.board_id = ? AND k.deleted_at IS NULL AND k.sprint_id IS NOT NULL
    GROUP BY k.sprint_id`).all(boardId) as Array<{ sprint_id: string; card_count: number; done_count: number }>;
  return new Map(rows.map((row) => [row.sprint_id, { card_count: row.card_count, done_count: row.done_count }]));
}

export function toSummary(row: SprintRow, counts: Map<string, { card_count: number; done_count: number }>): SprintSummary {
  const count = counts.get(row.id) ?? { card_count: 0, done_count: 0 };
  return {
    id: row.id, board_id: row.board_id, name: row.name, goal: row.goal, start_on: row.start_on, end_on: row.end_on,
    state: apiState(row.state), is_active: row.state === "active", position: row.position, completed_at: row.closed_at,
    card_count: count.card_count, done_count: count.done_count, created_at: row.created_at, updated_at: row.updated_at
  };
}

/** Open sprints: the active one first, then planned ones by position. */
export function openSprintRows(boardId: string) {
  return db.query(`SELECT ${sprintColumns} FROM board_sprints s WHERE s.board_id = ? AND s.state IN ('active', 'planned')
    ORDER BY CASE s.state WHEN 'active' THEN 0 ELSE 1 END, s.position, s.id`).all(boardId) as SprintRow[];
}

/** Completed sprints, newest first, after an optional `(closed_at, id)` keyset. */
export function completedSprintRows(boardId: string, limit: number, after?: { closedAt: string; id: string }) {
  if (after) {
    return db.query(`SELECT ${sprintColumns} FROM board_sprints s WHERE s.board_id = $boardId AND s.state = 'closed'
        AND (s.closed_at < $closedAt OR (s.closed_at = $closedAt AND s.id < $id))
      ORDER BY s.closed_at DESC, s.id DESC LIMIT $limit`).all({ boardId, closedAt: after.closedAt, id: after.id, limit }) as SprintRow[];
  }
  return db.query(`SELECT ${sprintColumns} FROM board_sprints s WHERE s.board_id = $boardId AND s.state = 'closed'
    ORDER BY s.closed_at DESC, s.id DESC LIMIT $limit`).all({ boardId, limit }) as SprintRow[];
}

/** The board payload's sprints (§6.1): every open sprint plus the latest completed ones. */
export function boardSprints(boardId: string): SprintSummary[] {
  const counts = sprintCounts(boardId);
  return [...openSprintRows(boardId), ...completedSprintRows(boardId, SPRINT_LIMITS.recentCompleted)].map((row) => toSummary(row, counts));
}

/** A sprint of `boardId`, looked up by id and board together (an id from another board is not found). */
export function sprintOfBoard(sprintId: string, boardId: string) {
  return db.query(`SELECT ${sprintColumns} FROM board_sprints s WHERE s.id = ? AND s.board_id = ?`).get(sprintId, boardId) as SprintRow | null;
}

export function sprintById(sprintId: string) {
  return db.query(`SELECT ${sprintColumns} FROM board_sprints s WHERE s.id = ?`).get(sprintId) as SprintRow | null;
}

/** Names of a board's sprints by id, for MCP listings. */
export function sprintNames(boardId: string) {
  return new Map((db.query("SELECT id, name FROM board_sprints WHERE board_id = ?").all(boardId) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
}
