import type { Migration } from "./types";

export const documentsMigration: Migration = {
  id: 6,
  name: "documents",
  up(db) {
    db.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
        mime_type TEXT NOT NULL,
        preview_kind TEXT NOT NULL CHECK (preview_kind IN ('image','pdf','text','audio','video','none')),
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
        sharing_override INTEGER NOT NULL DEFAULT 0 CHECK (sharing_override IN (0,1)),
        upload_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        purge_after TEXT,
        purge_started_at TEXT,
        CHECK ((deleted_at IS NULL AND purge_after IS NULL) OR (deleted_at IS NOT NULL AND purge_after IS NOT NULL))
      );
      CREATE TABLE document_shares (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (document_id, user_id)
      );
      CREATE INDEX idx_documents_owner_folder ON documents(owner_id, folder_id, updated_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX idx_documents_folder_live ON documents(folder_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_documents_bin ON documents(owner_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
      CREATE INDEX idx_documents_purge ON documents(purge_after) WHERE deleted_at IS NOT NULL;
      CREATE UNIQUE INDEX idx_documents_upload_key ON documents(owner_id, upload_key) WHERE upload_key IS NOT NULL;
      CREATE INDEX idx_document_shares_user ON document_shares(user_id, document_id);
    `);
  }
};
