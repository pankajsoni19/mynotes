/**
 * Run as a separate `bun` process by tests/searchIndex.test.ts. It builds a
 * data directory the way v0.4.x left it (schema at migration 007, notes on
 * disk, no search tables), then boots the app, which applies migration 008
 * and runs reconcileSearchIndex(). Prints one JSON line describing the index.
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialMigration } from "../../server/migrations/001_initial";
import { folderSharingMigration } from "../../server/migrations/002_folder_sharing";
import { totpMigration } from "../../server/migrations/003_totp";
import { totpRecoveryCodesMigration } from "../../server/migrations/004_totp_recovery_codes";
import { mcpApiKeysMigration } from "../../server/migrations/005_mcp_api_keys";
import { documentsMigration } from "../../server/migrations/006_documents";
import { binMigration } from "../../server/migrations/007_bin";

const dataDir = mkdtempSync(join(tmpdir(), "mynotes-search-probe-"));
const origin = "http://localhost:22028";
Object.assign(process.env, {
  DATA_DIR: dataDir,
  APP_ORIGIN: origin,
  APP_ORIGINS: origin,
  PORT: "22028",
  NODE_ENV: "test",
  COOKIE_SECURE: "false",
  TOTP_POLICY: "optional",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ALLOWED_EMAILS: "probe@example.test",
  MAX_UPLOAD_BYTES: "4194304",
  MIN_FREE_DISK_BYTES: "0"
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const ids = {
  published: crypto.randomUUID(),
  draftOnly: crypto.randomUUID(),
  both: crypto.randomUUID(),
  emptyDraft: crypto.randomUUID(),
  binned: crypto.randomUUID(),
  corrupt: crypto.randomUUID()
};

function writeNoteFile(noteId: string, relative: string, content: string) {
  const path = join(dataDir, "notes", noteId, relative);
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
}

try {
  const legacy = new Database(join(dataDir, "mynotes.sqlite"), { create: true, strict: true });
  legacy.exec("PRAGMA foreign_keys = ON");
  legacy.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of [initialMigration, folderSharingMigration, totpMigration, totpRecoveryCodesMigration, mcpApiKeysMigration, documentsMigration, binMigration]) {
    migration.up(legacy);
    legacy.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
  }
  const at = "2026-01-02T00:00:00.000Z";
  legacy.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'probe@example.test', 'Probe', 'x', ?)").run(at);
  legacy.query("INSERT INTO folders (id, owner_id, parent_id, name, is_default, created_at, updated_at) VALUES ('f1', 'u1', NULL, 'Default', 1, ?, ?)").run(at, at);
  const insertNote = legacy.query(`INSERT INTO notes (id, owner_id, folder_id, title, current_version, draft_revision, draft_checksum, created_at, updated_at, deleted_at, deleted_by, purge_after)
    VALUES (?, 'u1', 'f1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertVersion = legacy.query("INSERT INTO note_versions (id, note_id, version_number, title, checksum, author_id, created_at) VALUES (?, ?, 1, ?, ?, 'u1', ?)");

  const publishedText = "# Published aardvark\n\nBody about zebras.";
  insertNote.run(ids.published, "Published aardvark", 1, null, null, at, at, null, null, null);
  insertVersion.run(crypto.randomUUID(), ids.published, "Published aardvark", sha(publishedText), at);
  writeNoteFile(ids.published, "versions/000001.md", publishedText);
  // The mirror is stale on purpose: the index must come from the version file.
  writeNoteFile(ids.published, "current.md", "# Stale mirror mongoose");

  const draftOnlyText = "# Draft only\n\nPrivate pangolin plans.";
  insertNote.run(ids.draftOnly, "Draft only", 0, 3, sha(draftOnlyText), at, at, null, null, null);
  writeNoteFile(ids.draftOnly, "draft.md", draftOnlyText);

  const bothPublished = "# Both\n\nPublished platypus.";
  const bothDraft = "# Both\n\nDrafted dingo.";
  insertNote.run(ids.both, "Both", 1, 2, sha(bothDraft), at, at, null, null, null);
  insertVersion.run(crypto.randomUUID(), ids.both, "Both", sha(bothPublished), at);
  writeNoteFile(ids.both, "versions/000001.md", bothPublished);
  writeNoteFile(ids.both, "draft.md", bothDraft);

  insertNote.run(ids.emptyDraft, "New note", 0, 1, sha(""), at, at, null, null, null);
  writeNoteFile(ids.emptyDraft, "draft.md", "");

  const binnedText = "# Binned\n\nBinned bison.";
  insertNote.run(ids.binned, "Binned", 1, null, null, at, at, at, "u1", "2099-01-01T00:00:00.000Z");
  insertVersion.run(crypto.randomUUID(), ids.binned, "Binned", sha(binnedText), at);
  writeNoteFile(ids.binned, "versions/000001.md", binnedText);

  insertNote.run(ids.corrupt, "Corrupt", 1, null, null, at, at, null, null, null);
  insertVersion.run(crypto.randomUUID(), ids.corrupt, "Corrupt", sha("# Corrupt\n\nexpected"), at);
  writeNoteFile(ids.corrupt, "versions/000001.md", "# Corrupt\n\ntampered text");
  legacy.close();

  await import("../../server/index");
  const { db } = await import("../../server/db");
  const migrations = (db.query("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((row) => row.id);
  const rows = db.query("SELECT note_id, kind, source_checksum FROM note_search_rows ORDER BY note_id, kind").all() as Array<{ note_id: string; kind: string; source_checksum: string }>;
  const name = (noteId: string) => Object.entries(ids).find(([, id]) => id === noteId)?.[0] ?? "unknown";
  const match = (query: string) => (db.query("SELECT r.note_id, r.kind FROM note_fts JOIN note_search_rows r ON r.id = note_fts.rowid WHERE note_fts MATCH ? ORDER BY r.note_id, r.kind").all(query) as Array<{ note_id: string; kind: string }>)
    .map((row) => `${name(row.note_id)}:${row.kind}`);
  const checksumsMatch = rows.every((row) => {
    if (row.kind === "draft") return (db.query("SELECT draft_checksum FROM notes WHERE id = ?").get(row.note_id) as { draft_checksum: string }).draft_checksum === row.source_checksum;
    return (db.query("SELECT checksum FROM note_versions WHERE note_id = ? AND version_number = 1").get(row.note_id) as { checksum: string }).checksum === row.source_checksum;
  });
  const { reconcileSearchIndex } = await import("../../server/searchIndex");
  const second = await reconcileSearchIndex();
  console.log(JSON.stringify({
    migrations,
    rows: rows.map((row) => `${name(row.note_id)}:${row.kind}`).sort(),
    checksumsMatch,
    aardvark: match('"aardvark"'),
    zebras: match('"zebras"'),
    mongoose: match('"mongoose"'),
    pangolin: match('"pangolin"'),
    platypus: match('"platypus"'),
    dingo: match('"dingo"'),
    bison: match('"bison"'),
    tampered: match('"tampered"'),
    second
  }));
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
