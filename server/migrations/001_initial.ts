import type { Migration } from "./types";

export const initialMigration: Migration = {
  id: 1,
  name: "initial",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, disabled_at TEXT);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, title TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'selected', 'all_users')), current_version INTEGER NOT NULL DEFAULT 0, draft_revision INTEGER, draft_checksum TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
      CREATE TABLE IF NOT EXISTS note_versions (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, version_number INTEGER NOT NULL, title TEXT NOT NULL, checksum TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(note_id, version_number));
      CREATE TABLE IF NOT EXISTS note_shares (note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(note_id, user_id));
      CREATE TABLE IF NOT EXISTS folder_shares (folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(folder_id, user_id));
      CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, note_id TEXT REFERENCES notes(id) ON DELETE SET NULL, event_type TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_folders_owner_parent ON folders(owner_id, parent_id);
      CREATE INDEX IF NOT EXISTS idx_notes_owner_folder ON notes(owner_id, folder_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_versions_note_number ON note_versions(note_id, version_number DESC);
      CREATE INDEX IF NOT EXISTS idx_shares_user_note ON note_shares(user_id, note_id);
    `);
  }
};
