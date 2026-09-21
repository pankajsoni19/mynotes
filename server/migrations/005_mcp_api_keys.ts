import type { Migration } from "./types";

export const mcpApiKeysMigration: Migration = {
  id: 5,
  name: "mcp-api-keys",
  up(db) {
    db.exec(`
      CREATE TABLE mcp_api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX idx_mcp_api_keys_user ON mcp_api_keys(user_id, created_at DESC);
    `);
  }
};
