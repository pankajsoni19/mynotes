import { addColumn, type Migration } from "./types";

const BIN_RETENTION_MS = 30 * 86_400_000;

/**
 * Shared 30-day Bin for notes (DEVELOPMENT_PLAN §5.2). Documents already have
 * the Bin columns from migration 006.
 *
 * Legacy soft-deleted notes are backfilled with one timestamp T captured here:
 * published ones become restorable for 30 days from the upgrade, and
 * never-published ones (whose files were already removed or are empty drafts)
 * are due immediately and purged by the first sweep.
 */
export const binMigration: Migration = {
  id: 7,
  name: "bin",
  up(db) {
    addColumn(db, "notes", "deleted_by", "TEXT REFERENCES users(id) ON DELETE SET NULL");
    addColumn(db, "notes", "purge_after", "TEXT");
    addColumn(db, "notes", "purge_started_at", "TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notes_bin ON notes(owner_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_notes_purge ON notes(purge_after) WHERE deleted_at IS NOT NULL;
    `);
    const migratedAt = Date.now();
    const graceEnds = new Date(migratedAt + BIN_RETENTION_MS).toISOString();
    const dueNow = new Date(migratedAt).toISOString();
    db.query("UPDATE notes SET purge_after = ?, deleted_by = owner_id WHERE deleted_at IS NOT NULL AND purge_after IS NULL AND current_version > 0")
      .run(graceEnds);
    db.query("UPDATE notes SET purge_after = ?, deleted_by = owner_id WHERE deleted_at IS NOT NULL AND purge_after IS NULL AND current_version = 0")
      .run(dueNow);
  }
};
