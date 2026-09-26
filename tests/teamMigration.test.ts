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
import { mcpKeyScopesMigration } from "../server/migrations/010_mcp_key_scopes";
import { taskDatesMigration } from "../server/migrations/011_task_dates";
import { collectionsMigration } from "../server/migrations/012_collections";
import { calendarMigration } from "../server/migrations/013_calendar";
import { eventNextOccurrenceMigration } from "../server/migrations/014_event_next_occurrence";

/** The v0.7.0 schema: migrations 1–14. */
const v070 = [initialMigration, folderSharingMigration, totpMigration, totpRecoveryCodesMigration, mcpApiKeysMigration, documentsMigration, binMigration, noteSearchMigration, taskBoardsMigration, mcpKeyScopesMigration, taskDatesMigration, collectionsMigration, calendarMigration, eventNextOccurrenceMigration];

function v070Db() {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of v070) {
    migration.up(db);
    db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, "2026-01-01T00:00:00.000Z");
  }
  return db;
}

function addUser(db: Database, id: string, createdAt: string, disabled = false) {
  db.query("INSERT INTO users (id, email, display_name, password_hash, created_at, disabled_at) VALUES (?, ?, ?, 'x', ?, ?)")
    .run(id, `${id}@example.test`, id, createdAt, disabled ? createdAt : null);
}

const roles = (db: Database) => Object.fromEntries((db.query("SELECT id, role FROM users ORDER BY id").all() as Array<{ id: string; role: string }>).map((row) => [row.id, row.role]));
const events = (db: Database) => db.query("SELECT target_user_id, actor_id, via, action, from_role, to_role FROM team_events").all();

describe("migration 017_team_roles", () => {
  test("an empty v0.7.0 database gets the schema and no admin", () => {
    const db = v070Db();
    runMigrations(db);
    expect(db.query("SELECT name FROM schema_migrations WHERE id = 17").get()).toEqual({ name: "team_roles" });
    const columns = (db.query("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["role", "blocked_by", "block_reason", "disabled_at"]));
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'team_events'").get()).toBeTruthy();
    const triggers = (db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE '%admin%' OR name LIKE 'team_events%') ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect(triggers).toEqual(["team_events_no_delete", "team_events_no_update", "users_keep_one_admin", "users_keep_one_admin_delete"]);
    expect(events(db)).toEqual([]);
    // Re-running is a no-op.
    runMigrations(db);
    expect((db.query("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = 17").get() as { count: number }).count).toBe(1);
    db.close();
  });

  test("one user becomes the admin with one bootstrap event", () => {
    const db = v070Db();
    addUser(db, "only", "2026-01-02T00:00:00.000Z");
    runMigrations(db);
    expect(roles(db)).toEqual({ only: "admin" });
    expect(events(db)).toEqual([{ target_user_id: "only", actor_id: null, via: "migration", action: "bootstrap_admin", from_role: "member", to_role: "admin" }]);
    db.close();
  });

  test("three users and a pre-disabled one: the oldest enabled account is admin, the rest members", () => {
    const db = v070Db();
    addUser(db, "disabled-oldest", "2026-01-01T00:00:00.000Z", true);
    addUser(db, "b-second", "2026-01-03T00:00:00.000Z");
    addUser(db, "a-first", "2026-01-02T00:00:00.000Z");
    addUser(db, "c-third", "2026-01-04T00:00:00.000Z");
    runMigrations(db);
    expect(roles(db)).toEqual({ "a-first": "admin", "b-second": "member", "c-third": "member", "disabled-oldest": "member" });
    expect(events(db)).toHaveLength(1);
    expect(db.query("SELECT disabled_at IS NOT NULL AS blocked, blocked_by, block_reason FROM users WHERE id = 'disabled-oldest'").get()).toEqual({ blocked: 1, blocked_by: null, block_reason: null });
    db.close();
  });

  test("the role CHECK and the block_reason length are enforced", () => {
    const db = v070Db();
    runMigrations(db);
    addUser(db, "u1", "2026-01-02T00:00:00.000Z");
    expect(() => db.query("UPDATE users SET role = 'owner' WHERE id = 'u1'").run()).toThrow();
    expect(() => db.query("UPDATE users SET block_reason = ? WHERE id = 'u1'").run("x".repeat(201))).toThrow();
    db.query("UPDATE users SET role = 'viewer' WHERE id = 'u1'").run();
    db.query("UPDATE users SET role = 'guest' WHERE id = 'u1'").run();
    db.close();
  });

  test("the last active admin cannot be demoted, blocked, or deleted, even with direct SQL", () => {
    const db = v070Db();
    addUser(db, "admin", "2026-01-02T00:00:00.000Z");
    addUser(db, "member", "2026-01-03T00:00:00.000Z");
    runMigrations(db);
    expect(() => db.query("UPDATE users SET role = 'member' WHERE id = 'admin'").run()).toThrow("LAST_ADMIN");
    expect(() => db.query("UPDATE users SET disabled_at = '2026-02-01T00:00:00.000Z' WHERE id = 'admin'").run()).toThrow("LAST_ADMIN");
    expect(() => db.query("DELETE FROM users WHERE id = 'admin'").run()).toThrow("LAST_ADMIN");
    // Other changes to the admin row are fine.
    db.query("UPDATE users SET display_name = 'Renamed' WHERE id = 'admin'").run();
    // With a second active admin, either may step down.
    db.query("UPDATE users SET role = 'admin' WHERE id = 'member'").run();
    db.query("UPDATE users SET role = 'member' WHERE id = 'admin'").run();
    expect(roles(db)).toEqual({ admin: "member", member: "admin" });
    // A blocked admin does not count as active.
    db.query("UPDATE users SET role = 'admin', disabled_at = '2026-02-01T00:00:00.000Z' WHERE id = 'admin'").run();
    expect(() => db.query("UPDATE users SET role = 'member' WHERE id = 'member'").run()).toThrow("LAST_ADMIN");
    db.close();
  });

  test("team_events is append-only but follows user deletion", () => {
    const db = v070Db();
    addUser(db, "admin", "2026-01-02T00:00:00.000Z");
    addUser(db, "actor", "2026-01-03T00:00:00.000Z");
    addUser(db, "target", "2026-01-04T00:00:00.000Z");
    runMigrations(db);
    db.query("INSERT INTO team_events (id, target_user_id, actor_id, via, action, from_role, to_role, created_at) VALUES ('e1', 'target', 'actor', 'web', 'role_change', 'member', 'member', '2026-02-01T00:00:00.000Z')").run();
    expect(() => db.query("UPDATE team_events SET reason = 'edited' WHERE id = 'e1'").run()).toThrow("APPEND_ONLY");
    expect(() => db.query("UPDATE team_events SET actor_id = NULL WHERE id = 'e1'").run()).toThrow("APPEND_ONLY");
    expect(() => db.query("DELETE FROM team_events WHERE id = 'e1'").run()).toThrow("APPEND_ONLY");
    // Deleting the actor sets actor_id to NULL through the foreign key.
    db.query("DELETE FROM users WHERE id = 'actor'").run();
    expect(db.query("SELECT actor_id FROM team_events WHERE id = 'e1'").get()).toEqual({ actor_id: null });
    // Deleting the target removes its events through the cascade.
    db.query("DELETE FROM users WHERE id = 'target'").run();
    expect(db.query("SELECT 1 FROM team_events WHERE id = 'e1'").get()).toBeNull();
    db.close();
  });
});
