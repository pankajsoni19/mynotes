import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initialMigration } from "../server/migrations/001_initial";
import { folderSharingMigration } from "../server/migrations/002_folder_sharing";
import { totpMigration } from "../server/migrations/003_totp";
import { totpRecoveryCodesMigration } from "../server/migrations/004_totp_recovery_codes";
import { mcpApiKeysMigration } from "../server/migrations/005_mcp_api_keys";
import { documentsMigration } from "../server/migrations/006_documents";
import { binMigration } from "../server/migrations/007_bin";
import { noteSearchMigration } from "../server/migrations/008_note_search";
import { taskBoardsMigration } from "../server/migrations/009_task_boards";
import { mcpKeyScopesMigration } from "../server/migrations/010_mcp_key_scopes";
import { registeredMigrationIds, runMigrations } from "../server/migrations";

const legacyMigrations = [initialMigration, folderSharingMigration, totpMigration, totpRecoveryCodesMigration, mcpApiKeysMigration];

/**
 * Every registered migration ran. Reads the registered list so the assertion
 * holds whether or not later migrations (for example 013) are present,
 * and pins the ids this branch depends on.
 */
function expectAllMigrations(ids: number[]) {
  expect(ids).toEqual([...registeredMigrationIds]);
  expect(ids).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
}

function openDb() {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

describe("database migrations", () => {
  test("a fresh database contains every registered migration", () => {
    const db = openDb();
    runMigrations(db);
    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expectAllMigrations(ids);
    db.close();
  });

  test("a v0.2.2-shaped database upgrades cleanly to the latest migration", () => {
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
    expectAllMigrations(ids);
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
    expectAllMigrations(ids);
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
    expectAllMigrations(ids);
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
  test("a v0.5.0-shaped database upgrades cleanly to migration 9 with task tables and documents.purpose", () => {
    const db = openDb();
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [...legacyMigrations, documentsMigration, binMigration, noteSearchMigration]) {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    const old = "2025-01-01T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(old);
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u2', 'member@example.test', 'Member', 'x', ?)").run(old);
    db.query("INSERT INTO folders (id, owner_id, parent_id, name, is_default, created_at, updated_at) VALUES ('f1', 'u1', NULL, 'Default', 1, ?, ?)").run(old, old);
    db.query(`INSERT INTO documents (id, owner_id, folder_id, name, mime_type, preview_kind, size_bytes, sha256, created_at, updated_at)
      VALUES ('d1', 'u1', 'f1', 'a.txt', 'text/plain', 'text', 1, ?, ?, ?)`).run("a".repeat(64), old, old);

    runMigrations(db);

    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expectAllMigrations(ids);
    // Existing documents are Files items.
    expect((db.query("SELECT purpose FROM documents WHERE id = 'd1'").get() as { purpose: string }).purpose).toBe("file");
    const insertDocument = db.query(`INSERT INTO documents (id, owner_id, folder_id, name, mime_type, preview_kind, size_bytes, sha256, created_at, updated_at, purpose)
      VALUES (?, 'u1', NULL, 'b.png', 'image/png', 'image', 1, ?, ?, ?, ?)`);
    insertDocument.run("d2", "b".repeat(64), old, old, "task_attachment");
    insertDocument.run("d3", "b".repeat(64), old, old, "collection_attachment");
    expect(() => insertDocument.run("d4", "b".repeat(64), old, old, "system")).toThrow();
    // No system folder for attachments (director review §7).
    const folderColumns = (db.query("PRAGMA table_info(folders)").all() as Array<{ name: string }>).map((row) => row.name);
    expect(folderColumns).not.toContain("system_role");

    const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('boards','board_members','board_columns','cards','card_comments','card_attachments') ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(["board_columns", "board_members", "boards", "card_attachments", "card_comments", "cards"]);

    db.query("INSERT INTO boards (id, owner_id, name, created_at, updated_at) VALUES ('b1', 'u1', 'Plan', ?, ?)").run(old, old);
    expect(() => db.query("INSERT INTO boards (id, owner_id, name, created_at, updated_at) VALUES ('b2', 'u1', '', ?, ?)").run(old, old)).toThrow();
    expect(() => db.query("INSERT INTO boards (id, owner_id, name, created_at, updated_at, deleted_at) VALUES ('b3', 'u1', 'Half binned', ?, ?, ?)").run(old, old, old)).toThrow();
    db.query("INSERT INTO board_members (board_id, user_id, created_at) VALUES ('b1', 'u2', ?)").run(old);
    db.query("INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at) VALUES ('c1', 'b1', 'To do', 1024, ?, ?)").run(old, old);
    const insertCard = db.query("INSERT INTO cards (id, board_id, column_id, position, title, created_by, created_at, updated_at, deleted_at, purge_after) VALUES (?, 'b1', ?, 1024, ?, 'u1', ?, ?, ?, ?)");
    insertCard.run("k1", "c1", "First", old, old, null, null);
    // A live card must have a column; a binned one may lose it.
    expect(() => insertCard.run("k2", null, "No column", old, old, null, null)).toThrow();
    insertCard.run("k3", "c1", "Binned", old, old, old, old);
    db.query("INSERT INTO card_comments (id, card_id, author_id, body, created_at) VALUES ('m1', 'k1', 'u2', 'Hi', ?)").run(old);
    expect(() => db.query("INSERT INTO card_comments (id, card_id, author_id, body, created_at) VALUES ('m2', 'k1', 'u2', '', ?)").run(old)).toThrow();
    db.query("INSERT INTO card_attachments (card_id, document_id, comment_id, linked_by, created_at) VALUES ('k1', 'd2', 'm1', 'u2', ?)").run(old);

    expect(() => db.query("DELETE FROM board_columns WHERE id = 'c1'").run()).toThrow();
    db.query("DELETE FROM cards WHERE id = 'k1'").run();
    expect((db.query("SELECT COUNT(*) AS count FROM card_comments").get() as { count: number }).count).toBe(0);
    expect((db.query("SELECT COUNT(*) AS count FROM card_attachments").get() as { count: number }).count).toBe(0);
    // Unlinking never removes the document itself.
    expect(db.query("SELECT 1 FROM documents WHERE id = 'd2'").get()).toBeTruthy();
    db.query("DELETE FROM board_columns WHERE id = 'c1'").run();
    expect((db.query("SELECT column_id FROM cards WHERE id = 'k3'").get() as { column_id: string | null }).column_id).toBeNull();
    db.query("DELETE FROM boards WHERE id = 'b1'").run();
    expect((db.query("SELECT COUNT(*) AS count FROM cards").get() as { count: number }).count).toBe(0);
    expect((db.query("SELECT COUNT(*) AS count FROM board_members").get() as { count: number }).count).toBe(0);
    db.close();
  });
  test("migration 010 gives existing MCP keys notes:read and adds draft_mcp_key_id, independently of 009", () => {
    const db = openDb();
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [...legacyMigrations, documentsMigration, binMigration, noteSearchMigration]) {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    const old = "2025-01-01T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(old);
    db.query("INSERT INTO mcp_api_keys (id, user_id, name, key_prefix, token_hash, created_at) VALUES ('k1', 'u1', 'Laptop', 'mynotes_abcdefgh', ?, ?)").run("h".repeat(64), old);
    db.query("INSERT INTO notes (id, owner_id, folder_id, title, current_version, created_at, updated_at) VALUES ('n1', 'u1', NULL, 'One', 1, ?, ?)").run(old, old);

    // 010 applies on an 008-shaped database without 009's tables.
    mcpKeyScopesMigration.up(db);
    expect((db.query("SELECT scopes FROM mcp_api_keys WHERE id = 'k1'").get() as { scopes: string }).scopes).toBe('["notes:read"]');
    expect((db.query("SELECT draft_mcp_key_id FROM notes WHERE id = 'n1'").get() as { draft_mcp_key_id: string | null }).draft_mcp_key_id).toBeNull();
    // Idempotent column adds, then the runner records every pending migration in id order.
    runMigrations(db);
    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expectAllMigrations(ids);

    expect(() => db.query("UPDATE mcp_api_keys SET scopes = 'not json' WHERE id = 'k1'").run()).toThrow();
    db.query("UPDATE mcp_api_keys SET scopes = ? WHERE id = 'k1'").run(JSON.stringify(["notes:read", "notes:write-draft"]));
    db.query("UPDATE notes SET draft_mcp_key_id = 'k1' WHERE id = 'n1'").run();
    expect(() => db.query("UPDATE notes SET draft_mcp_key_id = 'missing' WHERE id = 'n1'").run()).toThrow();
    db.query("DELETE FROM mcp_api_keys WHERE id = 'k1'").run();
    expect((db.query("SELECT draft_mcp_key_id FROM notes WHERE id = 'n1'").get() as { draft_mcp_key_id: string | null }).draft_mcp_key_id).toBeNull();
    db.close();
  });
  test("a v0.6.0-shaped database upgrades to migration 11 with due dates, assignees, and backfilled done columns", () => {
    const db = openDb();
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [...legacyMigrations, documentsMigration, binMigration, noteSearchMigration, taskBoardsMigration, mcpKeyScopesMigration]) {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    const old = "2025-01-01T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(old);
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u2', 'member@example.test', 'Member', 'x', ?)").run(old);
    db.query("INSERT INTO boards (id, owner_id, name, created_at, updated_at) VALUES ('b1', 'u1', 'Plan', ?, ?)").run(old, old);
    const insertColumn = db.query("INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at) VALUES (?, 'b1', ?, ?, ?, ?)");
    insertColumn.run("c1", "To do", 1024, old, old);
    insertColumn.run("c2", "Done", 2048, old, old);
    insertColumn.run("c3", "done", 3072, old, old);
    insertColumn.run("c4", "Done soon", 4096, old, old);
    insertColumn.run("c5", "DONE", 5120, old, old);
    db.query("INSERT INTO cards (id, board_id, column_id, position, title, created_by, created_at, updated_at) VALUES ('k1', 'b1', 'c1', 1024, 'First', 'u1', ?, ?)").run(old, old);

    runMigrations(db);

    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expectAllMigrations(ids);
    const done = Object.fromEntries((db.query("SELECT id, is_done FROM board_columns").all() as Array<{ id: string; is_done: number }>).map((row) => [row.id, row.is_done]));
    expect(done).toEqual({ c1: 0, c2: 1, c3: 1, c4: 0, c5: 1 });
    expect(db.query("SELECT due_on, assignee_id FROM cards WHERE id = 'k1'").get()).toEqual({ due_on: null, assignee_id: null });

    db.query("UPDATE cards SET due_on = '2026-09-30', assignee_id = 'u2' WHERE id = 'k1'").run();
    expect(() => db.query("UPDATE cards SET due_on = '30/09/2026' WHERE id = 'k1'").run()).toThrow();
    expect(() => db.query("UPDATE cards SET due_on = '2026-9-30' WHERE id = 'k1'").run()).toThrow();
    expect(() => db.query("UPDATE cards SET assignee_id = 'missing' WHERE id = 'k1'").run()).toThrow();
    expect(() => db.query("UPDATE board_columns SET is_done = 2 WHERE id = 'c1'").run()).toThrow();
    db.query("DELETE FROM users WHERE id = 'u2'").run();
    expect((db.query("SELECT assignee_id FROM cards WHERE id = 'k1'").get() as { assignee_id: string | null }).assignee_id).toBeNull();

    const indexes = (db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_cards_due','idx_cards_assignee','idx_cards_creator') ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect(indexes).toEqual(["idx_cards_assignee", "idx_cards_creator", "idx_cards_due"]);
    db.close();
  });

  test("migration 012 adds the collection tables with byte caps, Bin checks, and a row FTS cascade", () => {
    const db = openDb();
    runMigrations(db);
    const ids = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
    expectAllMigrations(ids);
    expect((db.query("SELECT name FROM schema_migrations WHERE id = 12").get() as { name: string }).name).toBe("collections");
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'collection%' AND name NOT LIKE 'collection_row_fts_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(["collection_members", "collection_row_attachments", "collection_row_fts", "collection_row_search", "collection_rows", "collection_views", "collections"]);

    const old = "2025-01-01T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(old);
    const insertCollection = db.query("INSERT INTO collections (id, owner_id, name, schema_json, created_at, updated_at, deleted_at, purge_after) VALUES (?, 'u1', ?, ?, ?, ?, ?, ?)");
    insertCollection.run("c1", "Inventory", '{"fields":[]}', old, old, null, null);
    expect(() => insertCollection.run("c2", "", "{}", old, old, null, null)).toThrow();
    expect(() => insertCollection.run("c3", "Bad", "not json", old, old, null, null)).toThrow();
    expect(() => insertCollection.run("c4", "Half binned", "{}", old, old, old, null)).toThrow();
    expect(() => db.query("INSERT INTO collections (id, owner_id, name, schema_json, created_at, updated_at, share_role) VALUES ('c5', 'u1', 'X', '{}', ?, ?, 'admin')").run(old, old)).toThrow();

    const insertRow = db.query("INSERT INTO collection_rows (id, collection_id, position, values_json, created_at, updated_at) VALUES (?, 'c1', 1024, ?, ?, ?)");
    insertRow.run("r1", '{"f_aaaaaaaa":"Mug"}', old, old);
    expect(() => insertRow.run("r2", JSON.stringify({ f_aaaaaaaa: "é".repeat(8200) }), old, old)).toThrow();
    expect(() => insertRow.run("r3", "{", old, old)).toThrow();

    const mapping = Number(db.query("INSERT INTO collection_row_search (row_id, source_revision, schema_version, indexed_at) VALUES ('r1', 1, 1, ?)").run(old).lastInsertRowid);
    db.query("INSERT INTO collection_row_fts (rowid, title, body) VALUES (?, 'Mug', 'Kitchen')").run(mapping);
    expect((db.query("SELECT COUNT(*) AS count FROM collection_row_fts WHERE collection_row_fts MATCH ?").get('"kitchen"') as { count: number }).count).toBe(1);
    db.query("DELETE FROM collections WHERE id = 'c1'").run();
    expect((db.query("SELECT COUNT(*) AS count FROM collection_rows").get() as { count: number }).count).toBe(0);
    expect((db.query("SELECT COUNT(*) AS count FROM collection_row_search").get() as { count: number }).count).toBe(0);
    expect((db.query("SELECT COUNT(*) AS count FROM collection_row_fts").get() as { count: number }).count).toBe(0);
    db.close();
  });
});
