import { addColumn, type Migration } from "./types";

/** The Bin columns and their paired CHECK, as used for documents (migration 006). */
const BIN = `deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  purge_after TEXT,
  purge_started_at TEXT,
  CHECK ((deleted_at IS NULL AND purge_after IS NULL) OR (deleted_at IS NOT NULL AND purge_after IS NOT NULL))`;

/**
 * Task Boards (docs/plan/WAVES_7-9.md §3.1, D38–D44, and the director's §7
 * review). Boards, members, columns, cards, comments, and card attachments.
 *
 * There is no system folder for attachments: `documents.purpose` marks a
 * document as a Files item ('file'), a task attachment, or a Collections
 * attachment (reserved for Wave 11; a CHECK cannot be widened later without
 * rebuilding the table). Non-file documents live at folder_id = NULL and are
 * excluded from every Files list, count, and the Files Bin filter.
 */
export const taskBoardsMigration: Migration = {
  id: 9,
  name: "task_boards",
  up(db) {
    db.exec(`
      CREATE TABLE boards (id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${BIN});
      CREATE TABLE board_members (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL,
        PRIMARY KEY (board_id, user_id));
      CREATE TABLE board_columns (id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
        position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE cards (id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        column_id TEXT REFERENCES board_columns(id) ON DELETE SET NULL,
        position REAL NOT NULL,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        description TEXT NOT NULL DEFAULT '' CHECK (length(CAST(description AS BLOB)) <= 65536),
        revision INTEGER NOT NULL DEFAULT 1,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${BIN},
        CHECK (deleted_at IS NOT NULL OR column_id IS NOT NULL));
      CREATE TABLE card_comments (id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL CHECK (length(body) >= 1 AND length(CAST(body AS BLOB)) <= 16384),
        created_at TEXT NOT NULL, edited_at TEXT);
      CREATE TABLE card_attachments (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        comment_id TEXT REFERENCES card_comments(id) ON DELETE CASCADE,
        linked_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (card_id, document_id));
      CREATE INDEX idx_boards_owner ON boards(owner_id, deleted_at);
      CREATE INDEX idx_cards_board ON cards(board_id, deleted_at);
      CREATE INDEX idx_board_members_user ON board_members(user_id, board_id);
      CREATE INDEX idx_columns_board ON board_columns(board_id, position);
      CREATE INDEX idx_cards_column ON cards(column_id, position) WHERE deleted_at IS NULL;
      CREATE INDEX idx_comments_card ON card_comments(card_id, created_at);
      CREATE INDEX idx_card_attachments_document ON card_attachments(document_id);
    `);
    addColumn(db, "documents", "purpose", "TEXT NOT NULL DEFAULT 'file' CHECK (purpose IN ('file','task_attachment','collection_attachment'))");
  }
};
