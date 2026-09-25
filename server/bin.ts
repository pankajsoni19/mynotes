import { audit, db, ensureDefaultFolder, now } from "./db";
import { removeObject } from "./documentStorage";
import { storage, withResourceLock } from "./storage";
import {
  calendarBinSources,
  emptyCalendarBin,
  isCalendarBinType,
  purgeOwnedCalendarItem,
  restoreCalendarItem,
  sweepCalendarBin,
  type CalendarBinType
} from "./calendar/calendarBin";

/** Bin retention is a constant (D11), not configurable. */
export const BIN_RETENTION_MS = 30 * 86_400_000;

/** Notes and documents have bytes and folders; calendars and events use server/calendar/calendarBin.ts. */
export type StoredBinType = "note" | "document";
export type BinType = StoredBinType | CalendarBinType;
export const isBinType = (value: string | undefined): value is BinType => value === "note" || value === "document" || (value !== undefined && isCalendarBinType(value));
/**
 * Why an item was purged, as recorded in the audit metadata. "resumed" marks a
 * purge the sweeper finished after it was interrupted: the original reason
 * (user, blank, or retention) is not stored, and the start is audited through
 * the earlier delete event.
 */
export type PurgeReason = "user" | "retention" | "blank" | "resumed";
/** purged: row and bytes are gone. pending: tombstoned, bytes remain, the sweeper retries. not_found: no binned row. */
export type PurgeOutcome = "purged" | "pending" | "not_found";

export const purgeAfterFrom = (deletedAt: Date) => new Date(deletedAt.getTime() + BIN_RETENTION_MS).toISOString();

const tables = { note: "notes", document: "documents" } as const;
export const lockKey = (type: StoredBinType, id: string) => `${type}:${id}`;

/**
 * Byte removal for each type. ENOENT counts as success in both. Kept on an
 * object so tests can inject a failure without touching the filesystem.
 */
export const binStorage = {
  removeBytes: (type: StoredBinType, id: string) => type === "note" ? storage.removeNote(id) : removeObject(id)
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
export async function purgeLocked(type: StoredBinType, id: string, options: { reason: PurgeReason; actorId: string | null; ownerId?: string; dueBy?: string }): Promise<PurgeOutcome> {
  const table = tables[type];
  const startedAt = new Date().toISOString();
  // Sweeper purges re-check retention under the lock: an item restored and deleted
  // again since the run's snapshot has a fresh purge_after and must survive.
  const retention = options.dueBy === undefined ? "" : " AND (purge_started_at IS NOT NULL OR purge_after <= $dueBy)";
  const owner = options.ownerId === undefined ? "" : " AND owner_id = $ownerId";
  const marked = db.query(`UPDATE ${table} SET purge_started_at = COALESCE(purge_started_at, $startedAt) WHERE id = $id AND deleted_at IS NOT NULL${owner}${retention}`)
    .run({ startedAt, id, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.dueBy === undefined ? {} : { dueBy: options.dueBy }) });
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

/**
 * Delete forever (owner only). Distinguishes a live item (409 NOT_IN_BIN)
 * from a missing one (404). A row already being purged is finished here.
 */
export function purgeOwnedItem(type: BinType, id: string, ownerId: string): Promise<PurgeOutcome | "live"> {
  if (isCalendarBinType(type)) return purgeOwnedCalendarItem(type, id, ownerId);
  return withResourceLock(lockKey(type, id), async () => {
    const row = db.query(`SELECT deleted_at FROM ${tables[type]} WHERE id = ? AND owner_id = ?`).get(id, ownerId) as { deleted_at: string | null } | null;
    if (!row) return "not_found";
    if (row.deleted_at === null) return "live";
    return purgeLocked(type, id, { reason: "user", actorId: ownerId, ownerId });
  });
}

export type Visibility = "private" | "selected" | "all_users";
export type RestoreOutcome =
  | { status: "restored"; folderId: string; folderName: string; visibility: Visibility }
  | { status: "already_restored"; folderId: string | null; folderName: string | null }
  | { status: "calendar_restored"; alreadyRestored: boolean; calendarId: string; calendarName: string }
  | { status: "purging" }
  | { status: "parent_in_bin" }
  | { status: "limit" }
  | { status: "not_found" };

type RestorableRow = { folder_id: string | null; visibility: Visibility; sharing_override: number; deleted_at: string | null; purge_started_at: string | null };
type FolderRow = { id: string; name: string; visibility: Visibility };

const ownedFolder = (folderId: string | null, ownerId: string) => folderId === null
  ? null
  : db.query("SELECT id, name, visibility FROM folders WHERE id = ? AND owner_id = ?").get(folderId, ownerId) as FolderRow | null;

/**
 * Restore (owner only), DEVELOPMENT_PLAN §9.1 and D14. Compare-and-swap under
 * the resource lock; a row with a purge in progress is never restored. The
 * item returns to its original folder if the owner still has it, otherwise to
 * the owner's Default folder. Share rows were kept, so the item's previous
 * audience regains access; the response reports the effective visibility.
 */
export async function restoreItem(type: BinType, id: string, ownerId: string): Promise<RestoreOutcome> {
  if (isCalendarBinType(type)) {
    const outcome = await restoreCalendarItem(type, id, ownerId);
    return outcome.status === "restored" || outcome.status === "already_restored"
      ? { status: "calendar_restored", alreadyRestored: outcome.status === "already_restored", calendarId: outcome.calendarId, calendarName: outcome.calendarName }
      : outcome as Extract<RestoreOutcome, { status: "purging" | "parent_in_bin" | "limit" | "not_found" }>;
  }
  const table = tables[type];
  return withResourceLock(lockKey(type, id), async () => {
    const row = db.query(`SELECT folder_id, visibility, sharing_override, deleted_at, purge_started_at FROM ${table} WHERE id = ? AND owner_id = ?`)
      .get(id, ownerId) as RestorableRow | null;
    if (!row) return { status: "not_found" };
    if (row.purge_started_at !== null) return { status: "purging" };
    if (row.deleted_at === null) {
      const folder = ownedFolder(row.folder_id, ownerId);
      return { status: "already_restored", folderId: folder?.id ?? null, folderName: folder?.name ?? null };
    }
    return db.transaction((): RestoreOutcome => {
      const folder = ownedFolder(row.folder_id, ownerId) ?? ownedFolder(ensureDefaultFolder(ownerId), ownerId)!;
      const restored = db.query(`UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL, purge_after = NULL, folder_id = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL AND purge_started_at IS NULL`)
        .run(folder.id, now(), id, ownerId);
      if (restored.changes !== 1) return { status: "purging" };
      if (type === "note") audit(ownerId, id, "note.restore", { folderId: folder.id });
      else audit(ownerId, null, "document.restore", { documentId: id, folderId: folder.id });
      const visibility = row.sharing_override ? row.visibility : folder.visibility;
      return { status: "restored", folderId: folder.id, folderName: folder.name, visibility };
    })();
  });
}

export const SWEEP_BATCH_SIZE = 100;
/** Interrupted purges resumed per table and run. Kept separate so rows that keep failing never starve due ones. */
export const SWEEP_RESUME_BATCH_SIZE = 50;
export type BinSweepCounts = { purged: number; pending: number };

/**
 * Sweeper step 3 (DEVELOPMENT_PLAN §6.5). Per table and run: resume up to
 * SWEEP_RESUME_BATCH_SIZE interrupted purges, then purge up to
 * SWEEP_BATCH_SIZE rows whose retention has ended. Each budget is separate, so
 * a run is bounded and failing tombstones never block expired items.
 * Remaining rows wait for the next run.
 */
export async function sweepBin(options: { nowMs?: number } = {}): Promise<BinSweepCounts> {
  const cutoff = new Date(options.nowMs ?? Date.now()).toISOString();
  const counts: BinSweepCounts = { purged: 0, pending: 0 };
  for (const type of ["note", "document"] as const) {
    const table = tables[type];
    const resumed = db.query(`SELECT id FROM ${table} WHERE purge_started_at IS NOT NULL ORDER BY purge_started_at LIMIT ?`)
      .all(SWEEP_RESUME_BATCH_SIZE) as Array<{ id: string }>;
    const due = db.query(`SELECT id FROM ${table} WHERE deleted_at IS NOT NULL AND purge_started_at IS NULL AND purge_after <= ? ORDER BY purge_after LIMIT ?`)
      .all(cutoff, SWEEP_BATCH_SIZE) as Array<{ id: string }>;
    const work = [...resumed.map((row) => ({ id: row.id, reason: "resumed" as const })), ...due.map((row) => ({ id: row.id, reason: "retention" as const }))];
    for (const { id, reason } of work) {
      const outcome = await withResourceLock(lockKey(type, id), () => purgeLocked(type, id, { reason, actorId: null, dueBy: cutoff }));
      if (outcome === "purged") counts.purged += 1;
      else if (outcome === "pending") counts.pending += 1;
    }
  }
  const calendar = await sweepCalendarBin(cutoff, { resume: SWEEP_RESUME_BATCH_SIZE, due: SWEEP_BATCH_SIZE });
  counts.purged += calendar.purged;
  return counts;
}

export type BinItem = {
  type: BinType;
  id: string;
  title: string;
  folder_id: string | null;
  folder_name: string | null;
  size_bytes: number | null;
  deleted_at: string;
  purge_after: string;
  purging: boolean;
  /** False for an event the caller deleted on someone else's calendar: they may restore it, only the owner purges it. */
  can_purge: boolean;
};

export const BIN_LIST_LIMIT = 500;

/** The caller's own binned items, newest deletion first. Folder columns are null when the original folder is gone (restore then targets Default). */
export function listBin(ownerId: string, type: BinType | null) {
  const notes = `SELECT 'note' AS type, n.id, n.title, f.id AS folder_id, f.name AS folder_name, NULL AS size_bytes,
      n.deleted_at, n.purge_after, n.purge_started_at IS NOT NULL AS purging, 1 AS can_purge
    FROM notes n LEFT JOIN folders f ON f.id = n.folder_id AND f.owner_id = n.owner_id
    WHERE n.owner_id = $ownerId AND n.deleted_at IS NOT NULL`;
  const documents = `SELECT 'document' AS type, d.id, d.name AS title, f.id AS folder_id, f.name AS folder_name, d.size_bytes,
      d.deleted_at, d.purge_after, d.purge_started_at IS NOT NULL AS purging, 1 AS can_purge
    FROM documents d LEFT JOIN folders f ON f.id = d.folder_id AND f.owner_id = d.owner_id
    WHERE d.owner_id = $ownerId AND d.deleted_at IS NOT NULL`;
  // The Files filter shows Files items only; attachments appear under All (WAVES_7-9.md §7).
  const source = type === "note" ? notes : type === "document" ? `${documents} AND d.purpose = 'file'`
    : type !== null ? calendarBinSources(type).join(" UNION ALL ")
    : [notes, documents, ...calendarBinSources(null)].join(" UNION ALL ");
  const rows = db.query(`SELECT * FROM (${source}) ORDER BY deleted_at DESC, id LIMIT $limit`)
    .all({ ownerId, limit: BIN_LIST_LIMIT }) as Array<Omit<BinItem, "purging" | "can_purge"> & { purging: number; can_purge: number }>;
  return rows.map((row): BinItem => ({ ...row, purging: row.purging === 1, can_purge: row.can_purge === 1 }));
}

/**
 * Empty Bin: purges each of the owner's binned items independently, in
 * batches of SWEEP_BATCH_SIZE. Failed byte removals stay tombstoned for the sweeper.
 */
export async function emptyBin(ownerId: string) {
  const counts = { purged: 0, pending: 0 };
  for (const type of ["note", "document"] as const) {
    let after = "";
    for (;;) {
      const batch = db.query(`SELECT id FROM ${tables[type]} WHERE owner_id = ? AND deleted_at IS NOT NULL AND id > ? ORDER BY id LIMIT ?`)
        .all(ownerId, after, SWEEP_BATCH_SIZE) as Array<{ id: string }>;
      if (batch.length === 0) break;
      for (const { id } of batch) {
        const outcome = await withResourceLock(lockKey(type, id), () => purgeLocked(type, id, { reason: "user", actorId: ownerId, ownerId }));
        if (outcome === "purged") counts.purged += 1;
        else if (outcome === "pending") counts.pending += 1;
      }
      after = batch[batch.length - 1]!.id;
    }
  }
  const calendar = await emptyCalendarBin(ownerId, SWEEP_BATCH_SIZE);
  counts.purged += calendar.purged;
  return counts;
}
