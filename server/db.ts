import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { config } from "./config";
import { runMigrations } from "./migrations";

process.umask(0o077);
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
chmodSync(config.dataDir, 0o700);

export const db = new Database(config.databasePath, { create: true, strict: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

runMigrations(db);

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
  totp_recovery_codes: string | null;
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
  deleted_by: string | null;
  purge_after: string | null;
  purge_started_at: string | null;
};

export type DocumentRow = {
  id: string;
  owner_id: string;
  folder_id: string | null;
  name: string;
  mime_type: string;
  preview_kind: "image" | "pdf" | "text" | "audio" | "video" | "none";
  size_bytes: number;
  sha256: string;
  visibility: "private" | "selected" | "all_users";
  sharing_override: number;
  upload_key: string | null;
  purpose: "file" | "task_attachment" | "collection_attachment";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  purge_after: string | null;
  purge_started_at: string | null;
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
