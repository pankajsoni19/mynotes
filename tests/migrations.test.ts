import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initialMigration } from "../server/migrations/001_initial";
import { folderSharingMigration } from "../server/migrations/002_folder_sharing";
import { totpMigration } from "../server/migrations/003_totp";
import { totpRecoveryCodesMigration } from "../server/migrations/004_totp_recovery_codes";
import { mcpApiKeysMigration } from "../server/migrations/005_mcp_api_keys";
import { documentsMigration } from "../server/migrations/006_documents";
import { binMigration } from "../server/migrations/007_bin";
import { runMigrations } from "../server/migrations";

const legacyMigrations = [initialMigration, folderSharingMigration, totpMigration, totpRecoveryCodesMigration, mcpApiKeysMigration];

function openDb() {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

describe("database migrations", () => {
  test("a fresh database contains migrations 1 through 8", () => {
    const db = openDb();
    runMigrations(db);
    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    db.close();
  });

  test("a v0.2.2-shaped database upgrades cleanly to migration 8", () => {
    const db = openDb();
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of legacyMigrations) {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    const timestamp = "2026-01-02T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(timestamp);
    db.query("INSERT INTO folders (id, owner_id, parent_id, name, is_default, created_at, updated_at) VALUES ('f1', 'u1', NULL, 'Default', 1, ?, ?)").run(timestamp, timestamp);
    db.query("INSERT INTO notes (id, owner_id, folder_id, title, current_version, created_at, updated_at) VALUES ('n1', 'u1', 'f1', 'Kept', 1, ?, ?)").run(timestamp, timestamp);
    db.query("INSERT INTO notes (id, owner_id, folder_id, title, created_at, updated_at, deleted_at) VALUES ('n2', 'u1', 'f1', 'Deleted', ?, ?, ?)").run(timestamp, timestamp, timestamp);

    runMigrations(db);

    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((db.query("SELECT COUNT(*) AS count FROM notes").get() as { count: number }).count).toBe(2);
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'document%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(["document_shares", "documents"]);

    const insert = db.query(`INSERT INTO documents (id, owner_id, folder_id, name, mime_type, preview_kind, size_bytes, sha256, created_at, updated_at, deleted_at, purge_after)
      VALUES (?, 'u1', 'f1', 'a.txt', 'text/plain; charset=utf-8', 'text', 1, ?, ?, ?, ?, ?)`);
    insert.run("d1", "a".repeat(64), timestamp, timestamp, null, null);
    expect(() => insert.run("d2", "a".repeat(64), timestamp, timestamp, timestamp, null)).toThrow();
    expect(() => insert.run("d3", "short", timestamp, timestamp, null, null)).toThrow();
    db.query("DELETE FROM folders WHERE id = 'f1'").run();
    expect((db.query("SELECT folder_id FROM documents WHERE id = 'd1'").get() as { folder_id: string | null }).folder_id).toBeNull();
    db.close();
  });

  test("migration 007 backfills legacy soft-deleted notes into the Bin with one timestamp", () => {
    const db = openDb();
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [...legacyMigrations, documentsMigration]) {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    const old = "2025-01-01T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(old);
    db.query("INSERT INTO folders (id, owner_id, parent_id, name, is_default, created_at, updated_at) VALUES ('f1', 'u1', NULL, 'Default', 1, ?, ?)").run(old, old);
    const insertNote = db.query("INSERT INTO notes (id, owner_id, folder_id, title, current_version, created_at, updated_at, deleted_at) VALUES (?, 'u1', 'f1', ?, ?, ?, ?, ?)");
    insertNote.run("live", "Live", 1, old, old, null);
    insertNote.run("published", "Published", 2, old, old, old);
    insertNote.run("unpublished", "Unpublished", 0, old, old, old);

    const before = Date.now();
    runMigrations(db);
    const after = Date.now();

    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const rows = Object.fromEntries((db.query("SELECT id, deleted_at, deleted_by, purge_after, purge_started_at FROM notes").all() as Array<{
      id: string; deleted_at: string | null; deleted_by: string | null; purge_after: string | null; purge_started_at: string | null;
    }>).map((row) => [row.id, row]));
    expect(rows.live).toMatchObject({ deleted_at: null, deleted_by: null, purge_after: null, purge_started_at: null });
    expect(rows.published).toMatchObject({ deleted_at: old, deleted_by: "u1", purge_started_at: null });
    expect(rows.unpublished).toMatchObject({ deleted_at: old, deleted_by: "u1", purge_started_at: null });
    const unpublishedDue = Date.parse(rows.unpublished!.purge_after!);
    const publishedDue = Date.parse(rows.published!.purge_after!);
    expect(unpublishedDue).toBeGreaterThanOrEqual(before);
    expect(unpublishedDue).toBeLessThanOrEqual(after);
    // Both rows share the single migration timestamp T.
    expect(publishedDue - unpublishedDue).toBe(30 * 86_400_000);

    const indexes = (db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_notes_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_notes_bin", "idx_notes_purge"]));
    db.close();
  });
  test("migration 008 adds the note search tables, and deleting a note cascades to its FTS rows", () => {
    const db = openDb();
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [...legacyMigrations, documentsMigration, binMigration]) {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    const old = "2025-01-01T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(old);
    db.query("INSERT INTO notes (id, owner_id, folder_id, title, current_version, created_at, updated_at) VALUES ('n1', 'u1', NULL, 'One', 1, ?, ?)").run(old, old);
    db.query("INSERT INTO notes (id, owner_id, folder_id, title, current_version, created_at, updated_at) VALUES ('n2', 'u1', NULL, 'Two', 1, ?, ?)").run(old, old);

    runMigrations(db);

    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Migration 008 is filesystem-free: existing notes are backfilled at boot, not here.
    expect((db.query("SELECT COUNT(*) AS count FROM note_search_rows").get() as { count: number }).count).toBe(0);

    const insertRow = db.query("INSERT INTO note_search_rows (note_id, kind, source_checksum, indexed_at) VALUES (?, ?, ?, ?)");
    const insertFts = db.query("INSERT INTO note_fts (rowid, title, body) VALUES (?, ?, ?)");
    for (const [noteId, kind, text] of [["n1", "published", "Café crème"], ["n1", "draft", "Café draft"], ["n2", "published", "Other words"]] as const) {
      const rowid = Number(insertRow.run(noteId, kind, "a".repeat(64), old).lastInsertRowid);
      insertFts.run(rowid, noteId, text);
    }
    expect(() => insertRow.run("n2", "published", "a".repeat(64), old)).toThrow();
    expect(() => insertRow.run("n2", "draft", "short", old)).toThrow();
    expect(() => insertRow.run("n2", "other", "a".repeat(64), old)).toThrow();
    // remove_diacritics 2 folds accents and case.
    expect((db.query("SELECT COUNT(*) AS count FROM note_fts WHERE note_fts MATCH ?").get('"cafe"') as { count: number }).count).toBe(2);
    expect((db.query("SELECT COUNT(*) AS count FROM note_fts WHERE note_fts MATCH ?").get('"cr"*') as { count: number }).count).toBe(1);

    db.query("DELETE FROM notes WHERE id = 'n1'").run();

    expect((db.query("SELECT COUNT(*) AS count FROM note_search_rows WHERE note_id = 'n1'").get() as { count: number }).count).toBe(0);
    expect((db.query("SELECT COUNT(*) AS count FROM note_fts").get() as { count: number }).count).toBe(1);
    expect((db.query("SELECT COUNT(*) AS count FROM note_fts WHERE note_fts MATCH ?").get('"cafe"') as { count: number }).count).toBe(0);
    expect((db.query("SELECT COUNT(*) AS count FROM note_fts WHERE note_fts MATCH ?").get('"other"') as { count: number }).count).toBe(1);
    db.close();
  });
});
