import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../server/migrations";
import { initialMigration } from "../server/migrations/001_initial";
import { folderSharingMigration } from "../server/migrations/002_folder_sharing";
import { totpMigration } from "../server/migrations/003_totp";
import { totpRecoveryCodesMigration } from "../server/migrations/004_totp_recovery_codes";
import { mcpApiKeysMigration } from "../server/migrations/005_mcp_api_keys";
import { documentsMigration } from "../server/migrations/006_documents";
import { binMigration } from "../server/migrations/007_bin";
import { noteSearchMigration } from "../server/migrations/008_note_search";
import { taskBoardsMigration } from "../server/migrations/009_task_boards";

function openDb() {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const count = (db: Database, sql: string) => (db.query(sql).get() as { count: number }).count;
const old = "2026-01-01T00:00:00.000Z";

describe("migration 013_calendar", () => {
  test("is registered and applied on a fresh database, without assuming which of 010–012 exist", () => {
    const db = openDb();
    runMigrations(db);
    const rows = db.query("SELECT id, name FROM schema_migrations ORDER BY id").all() as Array<{ id: number; name: string }>;
    expect(rows.find((row) => row.id === 13)?.name).toBe("calendar");
    const tables = (db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
      ('calendars','calendar_members','events','event_links','reminders','notifications','push_subscriptions','calendar_feeds') ORDER BY name`).all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(["calendar_feeds", "calendar_members", "calendars", "event_links", "events", "notifications", "push_subscriptions", "reminders"]);
    const indexes = (db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_calendar_members_user','idx_events_range','idx_event_links_target','idx_reminders_due','idx_notifications_user','idx_feeds_calendar')").all() as Array<{ name: string }>);
    expect(indexes.length).toBe(6);
    // Re-running is a no-op.
    runMigrations(db);
    expect(count(db, "SELECT COUNT(*) AS count FROM schema_migrations WHERE id = 13")).toBe(1);
    db.close();
  });

  test("upgrades a database at migration 9 and enforces the calendar CHECKs and cascades", () => {
    const db = openDb();
    db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const migration of [initialMigration, folderSharingMigration, totpMigration, totpRecoveryCodesMigration, mcpApiKeysMigration, documentsMigration, binMigration, noteSearchMigration, taskBoardsMigration]) {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, old);
    }
    runMigrations(db);
    expect(db.query("SELECT 1 FROM schema_migrations WHERE id = 13").get()).toBeTruthy();

    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u1', 'owner@example.test', 'Owner', 'x', ?)").run(old);
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u2', 'member@example.test', 'Member', 'x', ?)").run(old);
    const insertCalendar = db.query("INSERT INTO calendars (id, owner_id, name, color, created_at, updated_at, deleted_at, purge_after) VALUES (?, 'u1', ?, ?, ?, ?, ?, ?)");
    insertCalendar.run("c1", "Personal", "blue", old, old, null, null);
    expect(() => insertCalendar.run("c2", "", "blue", old, old, null, null)).toThrow();
    expect(() => insertCalendar.run("c3", "Bad colour", "pink", old, old, null, null)).toThrow();
    // BIN pairing: deleted_at requires purge_after.
    expect(() => insertCalendar.run("c4", "Half binned", "red", old, old, old, null)).toThrow();
    expect(() => db.query("INSERT INTO calendars (id, owner_id, name, color, share_role, created_at, updated_at) VALUES ('c5', 'u1', 'X', 'red', 'owner', ?, ?)").run(old, old)).toThrow();
    db.query("INSERT INTO calendar_members (calendar_id, user_id, created_at) VALUES ('c1', 'u2', ?)").run(old);

    const insertEvent = db.query(`INSERT INTO events (id, calendar_id, title, all_day, start_date, end_date, start_local, tz, duration_minutes, start_utc, created_at, updated_at)
      VALUES (?, 'c1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertEvent.run("e1", "Dentist", 0, null, null, "2026-03-01T09:00", "Europe/Berlin", 60, "2026-03-01T08:00:00.000Z", old, old);
    insertEvent.run("e2", "Holiday", 1, "2026-03-02", "2026-03-03", null, null, null, "2026-03-02T00:00:00.000Z", old, old);
    // Timed events need local time, zone, and duration; all-day events need dates and no local time.
    expect(() => insertEvent.run("e3", "No tz", 0, null, null, "2026-03-01T09:00", null, 60, old, old, old)).toThrow();
    expect(() => insertEvent.run("e4", "Mixed", 1, "2026-03-02", "2026-03-03", "2026-03-01T09:00", null, null, old, old, old)).toThrow();
    expect(() => insertEvent.run("e5", "Too long", 0, null, null, "2026-03-01T09:00", "UTC", 10081, old, old, old)).toThrow();
    expect(() => db.query("UPDATE events SET rrule_json = 'not json' WHERE id = 'e1'").run()).toThrow();
    expect(() => db.query("UPDATE events SET description = ? WHERE id = 'e1'").run("x".repeat(8193))).toThrow();

    db.query("INSERT INTO event_links (event_id, target_type, target_id, linked_by, created_at) VALUES ('e1', 'note', 'n-anything', 'u1', ?)").run(old);
    // target_id has no foreign key, so card and collection-row links work without their modules.
    db.query("INSERT INTO event_links (event_id, target_type, target_id, linked_by, created_at) VALUES ('e1', 'collection_row', 'r-missing', 'u1', ?)").run(old);
    expect(() => db.query("INSERT INTO event_links (event_id, target_type, target_id, created_at) VALUES ('e1', 'folder', 'x', ?)").run(old)).toThrow();

    const insertReminder = db.query("INSERT INTO reminders (id, user_id, event_id, offset_minutes, title, tz, created_at) VALUES (?, 'u2', ?, ?, ?, 'UTC', ?)");
    insertReminder.run("r1", "e1", 15, null, old);
    insertReminder.run("r2", null, null, "Call back", old);
    expect(() => insertReminder.run("r3", "e1", 15, "Both", old)).toThrow();
    expect(() => insertReminder.run("r4", null, null, null, old)).toThrow();
    db.query("INSERT INTO notifications (id, user_id, reminder_id, event_id, created_at) VALUES ('n1', 'u2', 'r1', 'e1', ?)").run(old);
    expect(() => db.query("INSERT INTO calendar_feeds (id, calendar_id, user_id, token_hash, token_prefix, detail, created_at) VALUES ('f1', 'c1', 'u2', 'short', 'x', 'full', ?)").run(old)).toThrow();
    db.query("INSERT INTO calendar_feeds (id, calendar_id, user_id, token_hash, token_prefix, detail, created_at) VALUES ('f1', 'c1', 'u2', ?, 'x', 'busy', ?)").run("a".repeat(64), old);

    db.query("DELETE FROM events WHERE id = 'e1'").run();
    expect(count(db, "SELECT COUNT(*) AS count FROM event_links")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM reminders WHERE event_id IS NOT NULL")).toBe(0);
    // Notifications outlive their reminder and event; titles are resolved live.
    expect(db.query("SELECT reminder_id, event_id FROM notifications WHERE id = 'n1'").get()).toEqual({ reminder_id: null, event_id: null });
    db.query("DELETE FROM calendars WHERE id = 'c1'").run();
    expect(count(db, "SELECT COUNT(*) AS count FROM events")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM calendar_members")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS count FROM calendar_feeds")).toBe(0);
    db.close();
  });
});
