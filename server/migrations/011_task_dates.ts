import { addColumn, type Migration } from "./types";

/**
 * Task due dates, assignees, and done columns (docs/plan/WAVES_10-12.md §2.1,
 * D53). `due_on` is a calendar date (YYYY-MM-DD, validated as a real date by
 * the API; the CHECK only pins the shape). `assignee_id` must be a board
 * reader, enforced by the API. `is_done` is backfilled for columns named
 * "Done" (case-insensitive); owners can mark other columns later.
 */
export const taskDatesMigration: Migration = {
  id: 11,
  name: "task_dates",
  up(db) {
    addColumn(db, "cards", "due_on", "TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]')");
    addColumn(db, "cards", "assignee_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
    addColumn(db, "board_columns", "is_done", "INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0,1))");
    db.exec(`
      UPDATE board_columns SET is_done = 1 WHERE name = 'Done' COLLATE NOCASE;
      CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due_on) WHERE deleted_at IS NULL AND due_on IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_cards_assignee ON cards(assignee_id, updated_at) WHERE deleted_at IS NULL AND assignee_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_cards_creator ON cards(created_by, updated_at) WHERE deleted_at IS NULL;
    `);
  }
};
