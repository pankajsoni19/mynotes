import type { Database } from "bun:sqlite";
import { db } from "../db";
import { readableBoardPredicate } from "../tasks/access";
import { addDays, utcToZoned, zonedToUtc, type ExpansionRange } from "./recurrence";

export type DueTask = {
  cardId: string; boardId: string; boardName: string; title: string;
  /** The parent's title on the same board (task hierarchy D138), or null; the parent is readable whenever the card is. */
  parentTitle: string | null;
  /** The card's civil due date (in `dueTz` when timed). */
  dueOn: string;
  /** Wave 13 (D100): the wall time and zone, and the exact UTC instant, when the card has a time. */
  dueTime: string | null;
  dueTz: string | null;
  dueAt: string | null;
  /** The day the card falls on for the viewer: `dueOn` for date-only cards, the viewer-local date of `dueAt` otherwise. */
  date: string;
};

/** Due cards returned per request. */
export const MAX_DUE_TASKS = 200;
/**
 * Hard bound on the rows read before the exact range filter. The SQL already keeps only
 * date-only cards in range and timed cards whose wall time is within 14 hours of it, so this
 * only matters for thousands of timed cards in those two edge bands.
 */
export const MAX_DUE_SCAN = MAX_DUE_TASKS * 25;
/** How far a card's civil date can be from the viewer's local date (UTC−12 to UTC+14). */
const WIDEN_DAYS = 2;
/** The largest UTC offset either way (UTC+14), for the SQL band around the range. */
const BAND_MS = 14 * 3_600_000;
/** `YYYY-MM-DD HH:MM`, comparable as text with `due_on || ' ' || due_time`. */
const wallMinute = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

const hasColumn = (database: Database, table: string, column: string) =>
  (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);

type DueRow = { cardId: string; boardId: string; boardName: string; title: string; parentTitle: string | null; dueOn: string; dueTime: string | null; dueTz: string | null };

/**
 * The read-only "Tasks due" overlay (WAVES_10-12.md D67): live cards with a
 * due date in the range, on boards the caller can read, in columns not
 * marked done. `cards.due_on` and `board_columns.is_done` arrive with
 * migration 011 and `due_time`/`due_tz` with 015, which always run before this
 * module loads; the columns are still checked once at boot, so a database
 * without them answers an empty (or date-only) overlay rather than failing.
 *
 * Timed cards (WAVE_13_TASK_CARD_UX.md §5.2, T94) land on the viewer's local
 * day of their exact instant. Zones span UTC−12 to UTC+14 (26 hours), so a
 * card's civil date can be two days from the viewer's: the index range on
 * `due_on` widens by two days, and then, before any limit, SQL keeps date-only
 * cards whose `due_on` is in `[from, to)` exactly and timed cards whose wall
 * time is within 14 hours of the viewer's range (a necessary condition for
 * the instant to be inside it). The exact instant check runs on those rows,
 * so busy days just outside the range cannot push in-range cards out.
 *
 * Boards are filtered by the Tasks module's own `readableBoardPredicate`
 * (server/tasks/access.ts, WAVES_7-9.md §3.2; D51).
 */
export function createDueTasksQuery(database: Database) {
  const enabled = hasColumn(database, "cards", "due_on");
  const timed = enabled && hasColumn(database, "cards", "due_time");
  const doneFilter = enabled && hasColumn(database, "board_columns", "is_done") ? "AND COALESCE(col.is_done, 0) = 0" : "";
  const parentColumn = hasColumn(database, "cards", "parent_card_id")
    ? "(SELECT p.title FROM cards p WHERE p.id = c.parent_card_id AND p.board_id = c.board_id AND p.deleted_at IS NULL) AS parentTitle"
    : "NULL AS parentTitle";
  const timeColumns = timed ? "c.due_time AS dueTime, c.due_tz AS dueTz" : "NULL AS dueTime, NULL AS dueTz";
  const inRange = timed
    ? `((c.due_time IS NULL AND c.due_on >= $fromDate AND c.due_on < $toDate)
      OR (c.due_time IS NOT NULL AND c.due_on || ' ' || c.due_time >= $bandStart AND c.due_on || ' ' || c.due_time < $bandEnd))`
    : "c.due_on >= $fromDate AND c.due_on < $toDate";
  const sql = `SELECT c.id AS cardId, c.board_id AS boardId, b.name AS boardName, c.title, ${parentColumn}, c.due_on AS dueOn, ${timeColumns}
    FROM cards c JOIN boards b ON b.id = c.board_id JOIN board_columns col ON col.id = c.column_id
    WHERE c.deleted_at IS NULL AND c.due_on >= $wideFrom AND c.due_on < $wideTo AND ${inRange} ${doneFilter}
      AND ${readableBoardPredicate}
    ORDER BY c.due_on, c.title COLLATE NOCASE, c.id LIMIT $limit`;
  return {
    enabled,
    /** `viewerTz` is already validated (rangeFor); UTC when omitted. */
    list(userId: string, range: Pick<ExpansionRange, "fromDate" | "toDate">, viewerTz = "UTC"): DueTask[] {
      if (!enabled) return [];
      const startMs = zonedToUtc(`${range.fromDate}T00:00`, viewerTz);
      const endMs = zonedToUtc(`${range.toDate}T00:00`, viewerTz);
      const params = {
        userId, fromDate: range.fromDate, toDate: range.toDate,
        wideFrom: addDays(range.fromDate, -WIDEN_DAYS), wideTo: addDays(range.toDate, WIDEN_DAYS), limit: MAX_DUE_SCAN,
        ...(timed ? { bandStart: wallMinute(startMs - BAND_MS), bandEnd: wallMinute(endMs + BAND_MS) } : {})
      };
      const rows = database.query(sql).all(params) as DueRow[];
      const tasks: DueTask[] = [];
      for (const row of rows) {
        if (row.dueTime && row.dueTz) {
          const at = zonedToUtc(`${row.dueOn}T${row.dueTime}`, row.dueTz);
          if (at < startMs || at >= endMs) continue;
          tasks.push({ ...row, dueAt: new Date(at).toISOString(), date: utcToZoned(at, viewerTz).slice(0, 10) });
        } else {
          if (row.dueOn < range.fromDate || row.dueOn >= range.toDate) continue;
          tasks.push({ ...row, dueTime: null, dueTz: null, dueAt: null, date: row.dueOn });
        }
      }
      // By the viewer's day; date-only cards first, then timed ones by instant.
      tasks.sort((left, right) => left.date.localeCompare(right.date)
        || (left.dueAt ?? "").localeCompare(right.dueAt ?? "")
        || left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
        || left.cardId.localeCompare(right.cardId));
      return tasks.slice(0, MAX_DUE_TASKS);
    }
  };
}

const dueTasks = createDueTasksQuery(db);

/** Due cards for `GET /api/events?include=tasks`, placed by the viewer's zone. */
export const listDueTasks = (userId: string, range: Pick<ExpansionRange, "fromDate" | "toDate">, viewerTz: string) => dueTasks.list(userId, range, viewerTz);
export const dueTasksEnabled = () => dueTasks.enabled;
