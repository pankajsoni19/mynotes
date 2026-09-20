import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { config } from "./config";

process.umask(0o077);
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
chmodSync(config.dataDir, 0o700);

export const db = new Database(config.databasePath, { create: true, strict: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    disabled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'selected', 'all_users')),
    current_version INTEGER NOT NULL DEFAULT 0,
    draft_revision INTEGER,
    draft_checksum TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS note_versions (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    checksum TEXT NOT NULL,
    author_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    UNIQUE(note_id, version_number)
  );

  CREATE TABLE IF NOT EXISTS note_shares (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(note_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS folder_shares (
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(folder_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_folders_owner_parent ON folders(owner_id, parent_id);
  CREATE INDEX IF NOT EXISTS idx_notes_owner_folder ON notes(owner_id, folder_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_versions_note_number ON note_versions(note_id, version_number DESC);
  CREATE INDEX IF NOT EXISTS idx_shares_user_note ON note_shares(user_id, note_id);
`);

const folderColumns = db.query("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
if (!folderColumns.some((column) => column.name === "is_default")) {
  db.exec("ALTER TABLE folders ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0");
}
if (!folderColumns.some((column) => column.name === "visibility")) {
  db.exec("ALTER TABLE folders ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'selected', 'all_users'))");
}
const noteColumns = db.query("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
if (!noteColumns.some((column) => column.name === "sharing_override")) {
  db.exec("ALTER TABLE notes ADD COLUMN sharing_override INTEGER NOT NULL DEFAULT 0");
}
const userColumns = db.query("PRAGMA table_info(users)").all() as Array<{ name: string }>;
if (!userColumns.some((column) => column.name === "totp_secret")) {
  db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
}
if (!userColumns.some((column) => column.name === "totp_enabled_at")) {
  db.exec("ALTER TABLE users ADD COLUMN totp_enabled_at TEXT");
}
if (!userColumns.some((column) => column.name === "totp_last_counter")) {
  db.exec("ALTER TABLE users ADD COLUMN totp_last_counter INTEGER");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_owner_default ON folders(owner_id) WHERE is_default = 1");
db.exec("CREATE INDEX IF NOT EXISTS idx_folder_shares_user_folder ON folder_shares(user_id, folder_id)");

db.exec("PRAGMA optimize");

for (const path of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) {
  if (existsSync(path)) chmodSync(path, 0o600);
}

export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: string;
  disabled_at: string | null;
  totp_secret: string | null;
  totp_enabled_at: string | null;
  totp_last_counter: number | null;
};

export type NoteRow = {
  id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  visibility: "private" | "selected" | "all_users";
  sharing_override: number;
  current_version: number;
  draft_revision: number | null;
  draft_checksum: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export const now = () => new Date().toISOString();

export function ensureDefaultFolder(userId: string) {
  const current = db.query("SELECT id FROM folders WHERE owner_id = ? AND is_default = 1").get(userId) as { id: string } | null;
  if (current) return current.id;
  const namedDefault = db.query("SELECT id FROM folders WHERE owner_id = ? AND name = ? COLLATE NOCASE ORDER BY created_at LIMIT 1").get(userId, "Default") as { id: string } | null;
  if (namedDefault) {
    db.query("UPDATE folders SET is_default = 1, parent_id = NULL, updated_at = ? WHERE id = ?").run(now(), namedDefault.id);
    return namedDefault.id;
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  db.query("INSERT INTO folders (id, owner_id, parent_id, name, is_default, created_at, updated_at) VALUES (?, ?, NULL, 'Default', 1, ?, ?)")
    .run(id, userId, timestamp, timestamp);
  return id;
}

const usersMissingDefault = db.query("SELECT u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM folders f WHERE f.owner_id = u.id AND f.is_default = 1)").all() as Array<{ id: string }>;
for (const user of usersMissingDefault) ensureDefaultFolder(user.id);

export function audit(actorId: string | null, noteId: string | null, eventType: string, metadata?: unknown) {
  db.query(
    "INSERT INTO audit_log (id, actor_id, note_id, event_type, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), actorId, noteId, eventType, metadata ? JSON.stringify(metadata) : null, now());
}
