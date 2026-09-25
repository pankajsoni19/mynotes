import { audit, db } from "./db";
import { removeObject } from "./documentStorage";
import { storage } from "./storage";

/** Bin retention is a constant (D11), not configurable. */
export const BIN_RETENTION_MS = 30 * 86_400_000;

export type BinType = "note" | "document";
export type PurgeReason = "user" | "retention" | "blank";
/** purged: row and bytes are gone. pending: tombstoned, bytes remain, the sweeper retries. not_found: no binned row. */
export type PurgeOutcome = "purged" | "pending" | "not_found";

export const purgeAfterFrom = (deletedAt: Date) => new Date(deletedAt.getTime() + BIN_RETENTION_MS).toISOString();

const tables = { note: "notes", document: "documents" } as const;
export const lockKey = (type: BinType, id: string) => `${type}:${id}`;

/**
 * Byte removal for each type. ENOENT counts as success in both. Kept on an
 * object so tests can inject a failure without touching the filesystem.
 */
export const binStorage = {
  removeBytes: (type: BinType, id: string) => type === "note" ? storage.removeNote(id) : removeObject(id)
};

/**
 * DEVELOPMENT_PLAN §9.3. The caller must hold withResourceLock(lockKey(type, id)).
 *
 * 1. Tombstone: purge_started_at is set (kept if already set). From here the
 *    row is never readable (deleted_at IS NOT NULL) or restorable.
 * 2. Remove bytes. Any error other than ENOENT leaves the tombstone for the sweeper.
 * 3. Delete the row in a transaction (cascades clear versions and shares) and
 *    audit the purge with the id in metadata, since audit_log.note_id is nulled.
 */
export async function purgeLocked(type: BinType, id: string, options: { reason: PurgeReason; actorId: string | null; ownerId?: string }): Promise<PurgeOutcome> {
  const table = tables[type];
  const startedAt = new Date().toISOString();
  const marked = options.ownerId === undefined
    ? db.query(`UPDATE ${table} SET purge_started_at = COALESCE(purge_started_at, ?) WHERE id = ? AND deleted_at IS NOT NULL`).run(startedAt, id)
    : db.query(`UPDATE ${table} SET purge_started_at = COALESCE(purge_started_at, ?) WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL`).run(startedAt, id, options.ownerId);
  if (marked.changes === 0) return "not_found";

  try {
    await binStorage.removeBytes(type, id);
  } catch (error) {
    console.error(`Bin purge could not remove ${type} bytes (${error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.name : "Unknown error"})`);
    return "pending";
  }

  db.transaction(() => {
    const removed = db.query(`DELETE FROM ${table} WHERE id = ? AND purge_started_at IS NOT NULL`).run(id);
    if (removed.changes) {
      audit(options.actorId, null, `${type}.purge`, type === "note" ? { noteId: id, reason: options.reason } : { documentId: id, reason: options.reason });
    }
  })();
  return "purged";
}
