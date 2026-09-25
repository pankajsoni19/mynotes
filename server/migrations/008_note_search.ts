import type { Migration } from "./types";

/**
 * Full-text search for notes (docs/plan/WAVES_7-9.md §2.1, D30–D34).
 *
 * One FTS5 row per (note, kind). note_search_rows maps each FTS rowid to its
 * note and records the checksum of the text it was built from, so boot
 * reconcile can detect stale rows. Purging a note cascades to
 * note_search_rows, and the trigger removes the matching FTS row.
 *
 * Filesystem-free like every migration: rows are backfilled at boot by
 * reconcileSearchIndex().
 */
export const noteSearchMigration: Migration = {
  id: 8,
  name: "note_search",
  up(db) {
    db.exec(`
      CREATE TABLE note_search_rows (
        id INTEGER PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('published','draft')),
        source_checksum TEXT NOT NULL CHECK (length(source_checksum) = 64),
        indexed_at TEXT NOT NULL, UNIQUE (note_id, kind));
      CREATE VIRTUAL TABLE note_fts USING fts5(title, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3');
      CREATE TRIGGER note_search_rows_ad AFTER DELETE ON note_search_rows
        BEGIN DELETE FROM note_fts WHERE rowid = old.id; END;
    `);
  }
};
