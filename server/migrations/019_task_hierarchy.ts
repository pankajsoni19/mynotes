import { addColumn, type Migration } from "./types";

/** The Flat structure every existing and new board starts with (D122). */
export const DEFAULT_BOARD_STRUCTURE = '{"levels":[{"name":"Card","plural":"Cards"}],"workLevel":0,"sprints":false}';

/**
 * Task hierarchy and the sprint schema (research
 * 2026-09-26-task-hierarchy-workflows.md §5.1, D120–D135).
 *
 * - `cards.parent_card_id` and `cards.level` (0–2) make a card tree. The
 *   parent is on the same board and exactly one level up (D121), so a cycle
 *   is impossible by construction and the depth is at most 3 (T110). The
 *   service checks this under the board lock, and two triggers refuse any
 *   write that would break it (defence in depth): a child whose parent is
 *   missing, on another board, or not one level up, and a level change on a
 *   card that still has children. Whether the parent is live is the
 *   service's rule (a binned parent is refused as `PARENT_INVALID`).
 * - `cards.bin_root_id` tags the descendants binned together with a root
 *   card (D129), so the Bin lists the root only and one restore brings the
 *   group back. No FK: the root may be purged first.
 * - `boards.structure_json` holds the level names, the work level, and
 *   whether sprints are on (D122). Every board starts Flat.
 * - `board_sprints` and `cards.sprint_id` are the sprint schema (D124). The
 *   sprint API arrives with 17B and uses this migration unchanged.
 *
 * No backfill: every existing card is level 0 with no parent, and every board
 * is Flat. Independent of 017, 018, and 020 (it needs only 009, 011, and 015),
 * so it applies whichever of them came first. Transactional and
 * filesystem-free.
 */
export const taskHierarchyMigration: Migration = {
  id: 19,
  name: "task_hierarchy",
  up(db) {
    // The sprint table comes first: cards.sprint_id references it.
    db.exec(`
      CREATE TABLE board_sprints (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
        goal TEXT NOT NULL DEFAULT '' CHECK (length(goal) <= 500),
        start_on TEXT CHECK (start_on IS NULL OR start_on GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
        end_on TEXT CHECK (end_on IS NULL OR end_on GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
        state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','active','closed')),
        position REAL NOT NULL,
        closed_at TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (start_on IS NULL OR end_on IS NULL OR start_on <= end_on),
        CHECK ((state = 'closed') = (closed_at IS NOT NULL)));
      CREATE UNIQUE INDEX idx_sprints_one_active ON board_sprints(board_id) WHERE state = 'active';
      CREATE INDEX idx_sprints_board ON board_sprints(board_id, state, position);
    `);
    addColumn(db, "cards", "parent_card_id", "TEXT REFERENCES cards(id) ON DELETE SET NULL");
    addColumn(db, "cards", "level", "INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 2)");
    addColumn(db, "cards", "sprint_id", "TEXT REFERENCES board_sprints(id) ON DELETE SET NULL");
    addColumn(db, "cards", "bin_root_id", "TEXT");
    addColumn(db, "boards", "structure_json", `TEXT NOT NULL DEFAULT '${DEFAULT_BOARD_STRUCTURE}'
      CHECK (json_valid(structure_json) AND json_type(structure_json) = 'object' AND length(structure_json) <= 1024)`);
    db.exec(`
      CREATE INDEX idx_cards_parent ON cards(parent_card_id) WHERE parent_card_id IS NOT NULL;
      CREATE INDEX idx_cards_sprint ON cards(sprint_id) WHERE sprint_id IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX idx_cards_bin_root ON cards(bin_root_id) WHERE bin_root_id IS NOT NULL;

      -- D121: a parent is on the same board and exactly one level up.
      CREATE TRIGGER trg_cards_parent_insert BEFORE INSERT ON cards
        WHEN NEW.parent_card_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'PARENT_INVALID') WHERE NOT EXISTS (
          SELECT 1 FROM cards p WHERE p.id = NEW.parent_card_id AND p.board_id = NEW.board_id AND p.level = NEW.level - 1);
      END;
      CREATE TRIGGER trg_cards_parent_update BEFORE UPDATE OF parent_card_id, level, board_id ON cards
        WHEN NEW.parent_card_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'PARENT_INVALID') WHERE NEW.parent_card_id = NEW.id OR NOT EXISTS (
          SELECT 1 FROM cards p WHERE p.id = NEW.parent_card_id AND p.board_id = NEW.board_id AND p.level = NEW.level - 1);
      END;
      -- A card with children keeps its level and its board, so no child is ever left at the wrong depth.
      CREATE TRIGGER trg_cards_children_fixed BEFORE UPDATE OF level, board_id ON cards
        WHEN NEW.level <> OLD.level OR NEW.board_id <> OLD.board_id
      BEGIN
        SELECT RAISE(ABORT, 'HAS_CHILDREN') WHERE EXISTS (SELECT 1 FROM cards c WHERE c.parent_card_id = NEW.id);
      END;
    `);
  }
};
