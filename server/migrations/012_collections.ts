import type { Migration } from "./types";

/** The Bin columns and their paired CHECK, as used for documents (migration 006) and boards (009). */
const BIN = `deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  purge_after TEXT,
  purge_started_at TEXT,
  CHECK ((deleted_at IS NULL AND purge_after IS NULL) OR (deleted_at IS NOT NULL AND purge_after IS NOT NULL))`;

/**
 * Collections (docs/plan/WAVES_10-12.md §3.1, D54–D61, D68).
 *
 * Typed tables: a collection holds its schema as JSON (fields keyed by
 * server-generated ids), rows hold values keyed by field id, and saved views
 * hold sort and filter config. Attachments are documents with
 * purpose = 'collection_attachment' (or Files items the linker owns) linked
 * per row. Row search uses its own mapping and FTS5 tables, because
 * note_search_rows.note_id is a NOT NULL foreign key (D57).
 *
 * Filesystem-free: the row index is backfilled at boot by
 * reconcileCollectionSearchIndex().
 */
export const collectionsMigration: Migration = {
  id: 12,
  name: "collections",
  up(db) {
    db.exec(`
      CREATE TABLE collections (id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        icon TEXT NOT NULL DEFAULT 'table' CHECK (length(icon) <= 32),
        schema_json TEXT NOT NULL CHECK (json_valid(schema_json) AND length(schema_json) <= 65536),
        schema_version INTEGER NOT NULL DEFAULT 1,
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
        share_role TEXT NOT NULL DEFAULT 'viewer' CHECK (share_role IN ('viewer','editor')),
        template_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${BIN});
      CREATE TABLE collection_members (collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, user_id));
      CREATE TABLE collection_rows (id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        position REAL NOT NULL,
        values_json TEXT NOT NULL CHECK (json_valid(values_json) AND length(CAST(values_json AS BLOB)) <= 16384),
        prev_values_json TEXT CHECK (prev_values_json IS NULL OR length(CAST(prev_values_json AS BLOB)) <= 16384),
        revision INTEGER NOT NULL DEFAULT 1, prev_revision INTEGER,
        updated_via_key_id TEXT REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${BIN});
      CREATE TABLE collection_views (id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
        kind TEXT NOT NULL DEFAULT 'table' CHECK (kind IN ('table','board')),
        config_json TEXT NOT NULL CHECK (json_valid(config_json) AND length(config_json) <= 8192),
        position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE collection_row_attachments (
        row_id TEXT NOT NULL REFERENCES collection_rows(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        field_id TEXT NOT NULL,
        linked_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (row_id, document_id));
      CREATE TABLE collection_row_search (id INTEGER PRIMARY KEY,
        row_id TEXT NOT NULL UNIQUE REFERENCES collection_rows(id) ON DELETE CASCADE,
        source_revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, indexed_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE collection_row_fts USING fts5(title, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3');
      CREATE TRIGGER collection_row_search_ad AFTER DELETE ON collection_row_search
        BEGIN DELETE FROM collection_row_fts WHERE rowid = old.id; END;
      CREATE INDEX idx_collections_owner ON collections(owner_id, deleted_at);
      CREATE INDEX idx_collection_members_user ON collection_members(user_id, collection_id);
      CREATE INDEX idx_rows_collection ON collection_rows(collection_id, position) WHERE deleted_at IS NULL;
      CREATE INDEX idx_rows_binned ON collection_rows(collection_id, deleted_at) WHERE deleted_at IS NOT NULL;
      CREATE INDEX idx_views_collection ON collection_views(collection_id, position);
      CREATE INDEX idx_row_attachments_document ON collection_row_attachments(document_id);
    `);
  }
};
