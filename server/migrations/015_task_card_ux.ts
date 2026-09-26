import { addColumn, type Migration } from "./types";

/**
 * The whole Wave 13 task schema (docs/plan/WAVE_13_TASK_CARD_UX.md §2.1,
 * D100–D111): an optional due time with its zone, a description excerpt, a
 * WIP limit per column, multiple assignees, typed relations, board tags, and
 * card flags. Transactional and filesystem-free.
 *
 * Verified on Bun 1.4.2 (SQLite 3.53.2) in 13B commit 1, so the plan's
 * fallbacks are not needed:
 * - a CHECK added by ADD COLUMN may refer to a sibling column (`due_time`
 *   refers to `due_tz` and `due_on`); existing rows are NULL and pass;
 * - a UNIQUE expression index over two-argument `min()`/`max()` rejects a
 *   duplicate pair in either order.
 *
 * `cards.assignee_id` stays as a legacy mirror of the first assignee (D102):
 * the backfill copies every non-NULL value, binned cards included, and leaves
 * the column unchanged. Nothing reads it after this migration, so its index
 * goes. Excerpts are filled at boot, not here (the D34 pattern).
 */
export const taskCardUxMigration: Migration = {
  id: 15,
  name: "task_card_ux",
  up(db) {
    addColumn(db, "cards", "due_tz", "TEXT CHECK (due_tz IS NULL OR length(due_tz) BETWEEN 1 AND 64)");
    addColumn(db, "cards", "due_time", `TEXT CHECK ((due_time IS NULL AND due_tz IS NULL)
      OR (due_time IS NOT NULL AND due_tz IS NOT NULL AND due_on IS NOT NULL
          AND due_time GLOB '[0-2][0-9]:[0-5][0-9]' AND due_time <= '23:59'))`);
    addColumn(db, "cards", "description_excerpt", "TEXT NOT NULL DEFAULT '' CHECK (length(description_excerpt) <= 160)");
    addColumn(db, "board_columns", "wip_limit", "INTEGER CHECK (wip_limit IS NULL OR wip_limit BETWEEN 1 AND 1000)");
    db.exec(`
      CREATE TABLE card_assignees (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (card_id, user_id));
      CREATE INDEX idx_card_assignees_user ON card_assignees(user_id, card_id);
      INSERT INTO card_assignees (card_id, user_id, assigned_by, created_at)
        SELECT id, assignee_id, NULL, updated_at FROM cards WHERE assignee_id IS NOT NULL;
      DROP INDEX IF EXISTS idx_cards_assignee;

      CREATE TABLE card_relations (
        id TEXT PRIMARY KEY,
        source_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        target_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('relates','blocks','duplicates')),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        CHECK (source_card_id <> target_card_id),
        CHECK (kind <> 'relates' OR source_card_id < target_card_id));
      CREATE UNIQUE INDEX idx_card_relations_pair ON card_relations(min(source_card_id, target_card_id), max(source_card_id, target_card_id));
      CREATE INDEX idx_card_relations_source ON card_relations(source_card_id);
      CREATE INDEX idx_card_relations_target ON card_relations(target_card_id);

      CREATE TABLE board_tags (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
        color TEXT NOT NULL DEFAULT 'gray' CHECK (color IN ('gray','red','orange','yellow','green','teal','blue','purple','pink')),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX idx_board_tags_name ON board_tags(board_id, name COLLATE NOCASE);
      CREATE TABLE card_tags (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES board_tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (card_id, tag_id));
      CREATE INDEX idx_card_tags_tag ON card_tags(tag_id, card_id);
      CREATE TABLE card_flags (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        flag TEXT NOT NULL CHECK (flag IN ('urgent','blocked','needs_review','on_hold')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (card_id, flag));
      CREATE INDEX idx_card_flags_flag ON card_flags(flag, card_id);
    `);
  }
};
