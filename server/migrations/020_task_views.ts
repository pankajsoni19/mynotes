import { addColumn, type Migration } from "./types";

/**
 * Column state and saved cross-board task views (research
 * 2026-09-26-task-hierarchy-workflows.md §5.2, D140, D141).
 *
 * - `board_columns.state` is the normalized workflow state (todo, doing,
 *   done) shared by every board, so cross-board filters and lanes have one
 *   vocabulary. The backfill: a done column is done, otherwise a board's first
 *   column by position is todo, and the rest are doing. The service keeps
 *   `is_done = (state = 'done')` in the same statement; a sibling CHECK added
 *   by ADD COLUMN over existing rows is deliberately not used (§5.2).
 * - `task_views` stores a question, not an answer: the canonical filter
 *   (`shared/taskQuery.ts`) and display options. A view always runs as the
 *   viewer (T115). Visibility follows boards and collections, with
 *   `task_view_members` for `selected`.
 *
 * Independent of 017–019 (Team, hierarchy): it only needs 009, 011, and 015.
 * Transactional and filesystem-free.
 */
export const taskViewsMigration: Migration = {
  id: 20,
  name: "task_views",
  up(db) {
    addColumn(db, "board_columns", "state", "TEXT NOT NULL DEFAULT 'doing' CHECK (state IN ('todo','doing','done'))");
    db.exec(`
      UPDATE board_columns SET state = 'done' WHERE is_done = 1;
      UPDATE board_columns SET state = 'todo'
        WHERE is_done = 0 AND position = (SELECT MIN(x.position) FROM board_columns x WHERE x.board_id = board_columns.board_id);

      CREATE TABLE task_views (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        query TEXT NOT NULL CHECK (length(query) <= 2000),
        display_json TEXT NOT NULL CHECK (json_valid(display_json) AND json_type(display_json) = 'object' AND length(display_json) <= 2048),
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
        position REAL NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL);
      CREATE TABLE task_view_members (
        view_id TEXT NOT NULL REFERENCES task_views(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (view_id, user_id));
      CREATE INDEX idx_task_views_owner ON task_views(owner_id, position);
      CREATE INDEX idx_task_views_all_users ON task_views(visibility) WHERE visibility = 'all_users';
      CREATE INDEX idx_task_view_members_user ON task_view_members(user_id, view_id);
    `);
  }
};
