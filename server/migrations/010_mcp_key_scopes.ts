import { addColumn, type Migration } from "./types";

/**
 * MCP key scopes (docs/plan/WAVES_7-9.md §4.1, D36–D37).
 *
 * `mcp_api_keys.scopes` is a JSON array fixed at key creation. Keys created
 * before this migration read as `["notes:read"]`, which is exactly what they
 * could do before. `notes.draft_mcp_key_id` records which key wrote the
 * current draft; it is cleared on publish or discard and powers the
 * "Draft by <key>" badge.
 *
 * Independent of migration 009 (task boards): it only touches tables from
 * migrations 001 and 005.
 */
export const mcpKeyScopesMigration: Migration = {
  id: 10,
  name: "mcp_key_scopes",
  up(db) {
    addColumn(db, "mcp_api_keys", "scopes", "TEXT NOT NULL DEFAULT '[\"notes:read\"]' CHECK (json_valid(scopes))");
    addColumn(db, "notes", "draft_mcp_key_id", "TEXT REFERENCES mcp_api_keys(id) ON DELETE SET NULL");
  }
};
