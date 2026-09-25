import { audit, db, now } from "../db";
import { withResourceLock } from "../storage";
import { calendarWriterPredicate, editableCalendarPredicate } from "./access";
import { rescheduleCalendarReminders, rescheduleEventReminders } from "./reminders";
import { MAX_CALENDARS_PER_OWNER } from "./service";

/**
 * Bin adapters for calendars and events (WAVES_10-12.md D68, the D41 rules).
 * Same tombstone and compare-and-swap restore as notes and documents, with no
 * bytes to remove. A binned calendar hides its events; purging it cascades to
 * them (and to members, links, reminders, and feeds) through foreign keys.
 *
 * - A calendar is listed, restored, and purged by its owner only.
 * - A binned event is listed for the calendar's owner and for whoever
 *   deleted it while they can still edit the calendar. Either can restore it;
 *   only the owner purges it. Restoring an event whose calendar is in the Bin
 *   returns PARENT_IN_BIN.
 */
export type CalendarBinType = "calendar" | "event";
export const CALENDAR_BIN_TYPES: readonly CalendarBinType[] = ["calendar", "event"];
export const isCalendarBinType = (value: string): value is CalendarBinType => value === "calendar" || value === "event";

type PurgeReason = "user" | "retention" | "resumed";
export type CalendarPurgeOutcome = "purged" | "not_found";

const tables = { calendar: "calendars", event: "events" } as const;
const lockKey = (type: CalendarBinType, id: string) => `${type}:${id}`;

/** Events the caller deleted and may still edit, as a predicate on `e`/`k` with `$ownerId` as the caller. */
const deleterPredicate = `(e.deleted_by = $ownerId AND ${editableCalendarPredicate.replaceAll("$userId", "$ownerId")})`;

/** The SELECTs `listBin` unions in, shaped like its other sources. */
export function calendarBinSources(type: CalendarBinType | null) {
  const calendars = `SELECT 'calendar' AS type, k.id, k.name AS title, NULL AS folder_id, NULL AS folder_name, NULL AS size_bytes,
      k.deleted_at, k.purge_after, k.purge_started_at IS NOT NULL AS purging, 1 AS can_purge
    FROM calendars k WHERE k.owner_id = $ownerId AND k.deleted_at IS NOT NULL`;
  const events = `SELECT 'event' AS type, e.id, e.title, k.id AS folder_id, k.name AS folder_name, NULL AS size_bytes,
      e.deleted_at, e.purge_after, e.purge_started_at IS NOT NULL AS purging, CASE WHEN k.owner_id = $ownerId THEN 1 ELSE 0 END AS can_purge
    FROM events e JOIN calendars k ON k.id = e.calendar_id
    WHERE e.deleted_at IS NOT NULL AND (k.owner_id = $ownerId OR ${deleterPredicate})`;
  if (type === "calendar") return [calendars];
  if (type === "event") return [events];
  return [calendars, events];
}

type BinRow = { deleted_at: string | null; purge_started_at: string | null };

/** The binned (or live) row the caller may restore: the owner, or for events also the deleter who can still edit. */
function restorableRow(type: CalendarBinType, id: string, userId: string) {
  if (type === "calendar") {
    return db.query("SELECT k.deleted_at, k.purge_started_at, k.id AS calendar_id, k.name AS calendar_name, k.deleted_at AS calendar_deleted_at FROM calendars k WHERE k.id = ? AND k.owner_id = ?")
      .get(id, userId) as (BinRow & { calendar_id: string; calendar_name: string; calendar_deleted_at: string | null }) | null;
  }
  // The deleter's access is checked against the calendar ignoring its own Bin state, so a binned
  // calendar answers PARENT_IN_BIN rather than a bare 404 for them too.
  const editable = calendarWriterPredicate.replaceAll("$userId", "$ownerId");
  return db.query(`SELECT e.deleted_at, e.purge_started_at, k.id AS calendar_id, k.name AS calendar_name, k.deleted_at AS calendar_deleted_at
      FROM events e JOIN calendars k ON k.id = e.calendar_id
      WHERE e.id = $id AND (k.owner_id = $ownerId OR ((e.deleted_by = $ownerId OR e.deleted_at IS NULL) AND ${editable}))`)
    .get({ id, ownerId: userId }) as (BinRow & { calendar_id: string; calendar_name: string; calendar_deleted_at: string | null }) | null;
}

export type CalendarRestoreOutcome =
  | { status: "restored" | "already_restored"; calendarId: string; calendarName: string }
  | { status: "purging" }
  | { status: "parent_in_bin" }
  | { status: "limit" }
  | { status: "not_found" };

export function restoreCalendarItem(type: CalendarBinType, id: string, userId: string): Promise<CalendarRestoreOutcome> {
  return withResourceLock(lockKey(type, id), async () => {
    const row = restorableRow(type, id, userId);
    if (!row) return { status: "not_found" };
    if (row.purge_started_at !== null) return { status: "purging" };
    if (row.deleted_at === null) return { status: "already_restored", calendarId: row.calendar_id, calendarName: row.calendar_name };
    if (type === "event" && row.calendar_deleted_at !== null) return { status: "parent_in_bin" };
    return db.transaction((): CalendarRestoreOutcome => {
      if (type === "calendar") {
        const live = (db.query("SELECT COUNT(*) AS count FROM calendars WHERE owner_id = ? AND deleted_at IS NULL").get(userId) as { count: number }).count;
        if (live >= MAX_CALENDARS_PER_OWNER) return { status: "limit" };
      }
      const restored = db.query(`UPDATE ${tables[type]} SET deleted_at = NULL, deleted_by = NULL, purge_after = NULL, updated_at = ?
        WHERE id = ? AND deleted_at IS NOT NULL AND purge_started_at IS NULL`).run(now(), id);
      if (restored.changes !== 1) return { status: "purging" };
      audit(userId, null, `${type}.restore`, type === "calendar" ? { calendarId: id } : { eventId: id, calendarId: row.calendar_id });
      if (type === "calendar") rescheduleCalendarReminders(id);
      else rescheduleEventReminders(id);
      return { status: "restored", calendarId: row.calendar_id, calendarName: row.calendar_name };
    })();
  });
}

/**
 * Tombstone, then delete (DEVELOPMENT_PLAN §9.3 without the byte step). The
 * caller holds the lock. `ownerId` limits user-initiated purges to the
 * calendar's owner; `dueBy` re-checks retention for the sweeper.
 */
function purgeLocked(type: CalendarBinType, id: string, options: { reason: PurgeReason; actorId: string | null; ownerId?: string; dueBy?: string }): CalendarPurgeOutcome {
  const owner = options.ownerId === undefined ? ""
    : type === "calendar" ? " AND owner_id = $ownerId" : " AND calendar_id IN (SELECT id FROM calendars WHERE owner_id = $ownerId)";
  const retention = options.dueBy === undefined ? "" : " AND (purge_started_at IS NOT NULL OR purge_after <= $dueBy)";
  const marked = db.query(`UPDATE ${tables[type]} SET purge_started_at = COALESCE(purge_started_at, $startedAt) WHERE id = $id AND deleted_at IS NOT NULL${owner}${retention}`)
    .run({ startedAt: now(), id, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.dueBy === undefined ? {} : { dueBy: options.dueBy }) });
  if (marked.changes === 0) return "not_found";
  db.transaction(() => {
    const removed = db.query(`DELETE FROM ${tables[type]} WHERE id = ? AND purge_started_at IS NOT NULL`).run(id);
    if (removed.changes) audit(options.actorId, null, `${type}.purge`, type === "calendar" ? { calendarId: id, reason: options.reason } : { eventId: id, reason: options.reason });
  })();
  return "purged";
}

/** Delete forever by the calendar's owner: 404 when missing or not theirs, "live" when not in the Bin. */
export function purgeOwnedCalendarItem(type: CalendarBinType, id: string, ownerId: string): Promise<CalendarPurgeOutcome | "live"> {
  return withResourceLock(lockKey(type, id), async () => {
    const row = type === "calendar"
      ? db.query("SELECT deleted_at FROM calendars WHERE id = ? AND owner_id = ?").get(id, ownerId) as { deleted_at: string | null } | null
      : db.query("SELECT e.deleted_at FROM events e JOIN calendars k ON k.id = e.calendar_id WHERE e.id = ? AND k.owner_id = ?").get(id, ownerId) as { deleted_at: string | null } | null;
    if (!row) return "not_found";
    if (row.deleted_at === null) return "live";
    return purgeLocked(type, id, { reason: "user", actorId: ownerId, ownerId });
  });
}

/** Sweeper step for calendars and events, with the same per-table budgets as notes and documents. */
export async function sweepCalendarBin(cutoff: string, budgets: { resume: number; due: number }) {
  let purged = 0;
  // Events first, so a calendar and its binned events never race within one run.
  for (const type of ["event", "calendar"] as const) {
    const table = tables[type];
    const resumed = db.query(`SELECT id FROM ${table} WHERE purge_started_at IS NOT NULL ORDER BY purge_started_at LIMIT ?`).all(budgets.resume) as Array<{ id: string }>;
    const due = db.query(`SELECT id FROM ${table} WHERE deleted_at IS NOT NULL AND purge_started_at IS NULL AND purge_after <= ? ORDER BY purge_after LIMIT ?`)
      .all(cutoff, budgets.due) as Array<{ id: string }>;
    for (const { id, reason } of [...resumed.map((row) => ({ id: row.id, reason: "resumed" as const })), ...due.map((row) => ({ id: row.id, reason: "retention" as const }))]) {
      const outcome = await withResourceLock(lockKey(type, id), async () => purgeLocked(type, id, { reason, actorId: null, dueBy: cutoff }));
      if (outcome === "purged") purged += 1;
    }
  }
  return { purged, pending: 0 };
}

/** Empty Bin: the owner's binned calendars and binned events on calendars they own. */
export async function emptyCalendarBin(ownerId: string, batchSize: number) {
  let purged = 0;
  const sources = {
    event: "SELECT e.id FROM events e JOIN calendars k ON k.id = e.calendar_id WHERE k.owner_id = ? AND e.deleted_at IS NOT NULL AND e.id > ? ORDER BY e.id LIMIT ?",
    calendar: "SELECT id FROM calendars WHERE owner_id = ? AND deleted_at IS NOT NULL AND id > ? ORDER BY id LIMIT ?"
  } as const;
  for (const type of ["event", "calendar"] as const) {
    let after = "";
    for (;;) {
      const batch = db.query(sources[type]).all(ownerId, after, batchSize) as Array<{ id: string }>;
      if (!batch.length) break;
      for (const { id } of batch) {
        const outcome = await withResourceLock(lockKey(type, id), async () => purgeLocked(type, id, { reason: "user", actorId: ownerId, ownerId }));
        if (outcome === "purged") purged += 1;
      }
      after = batch[batch.length - 1]!.id;
    }
  }
  return { purged, pending: 0 };
}
