import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createUser, request } from "./support/harness";
import { runMigrations } from "../server/migrations";
import { createDueTasksQuery, dueTasksEnabled } from "../server/calendar/tasksOverlay";
import { linkLabel } from "../src/calendar/EventLinks";

describe("the Tasks due overlay", () => {
  test("include=tasks answers an empty list until cards.due_on exists, and other values are refused", async () => {
    const user = await createUser("Overlay user");
    expect(dueTasksEnabled()).toBe(false);
    const withTasks = await request("/events?from=2026-05-01&to=2026-05-31&include=tasks", {}, user);
    expect(withTasks.status).toBe(200);
    expect(await withTasks.json()).toMatchObject({ occurrences: [], truncated: false, tasks: [] });
    const without = await (await request("/events?from=2026-05-01&to=2026-05-31", {}, user)).json() as Record<string, unknown>;
    expect("tasks" in without).toBe(false);
    expect((await request("/events?from=2026-05-01&to=2026-05-31&include=notes", {}, user)).status).toBe(400);
  });

  test("after migration 011's columns exist it lists readable, open, live cards in range", () => {
    const db = new Database(":memory:", { strict: true });
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);
    // What migration 011 adds (WAVES_10-12.md §2.1); simulated here so the overlay can be tested before it lands.
    db.exec("ALTER TABLE cards ADD COLUMN due_on TEXT");
    db.exec("ALTER TABLE board_columns ADD COLUMN is_done INTEGER NOT NULL DEFAULT 0");
    const at = "2026-01-01T00:00:00.000Z";
    for (const [id, email] of [["owner", "o@example.test"], ["member", "m@example.test"], ["stranger", "s@example.test"]]) {
      db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)").run(id, email, id, at);
    }
    const board = db.query("INSERT INTO boards (id, owner_id, name, visibility, created_at, updated_at, deleted_at, purge_after) VALUES (?, 'owner', ?, ?, ?, ?, ?, ?)");
    board.run("shared", "Home", "selected", at, at, null, null);
    board.run("private", "Private", "private", at, at, null, null);
    board.run("binned", "Old", "all_users", at, at, at, at);
    db.query("INSERT INTO board_members (board_id, user_id, created_at) VALUES ('shared', 'member', ?)").run(at);
    const column = db.query("INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at, is_done) VALUES (?, ?, ?, ?, ?, ?, ?)");
    column.run("todo", "shared", "To do", 1, at, at, 0);
    column.run("done", "shared", "Done", 2, at, at, 1);
    column.run("ptodo", "private", "To do", 1, at, at, 0);
    column.run("btodo", "binned", "To do", 1, at, at, 0);
    const card = db.query("INSERT INTO cards (id, board_id, column_id, position, title, due_on, created_at, updated_at, deleted_at, purge_after) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)");
    card.run("k1", "shared", "todo", "Pay rent", "2026-05-01", at, at, null, null);
    card.run("k2", "shared", "done", "Already done", "2026-05-02", at, at, null, null);
    card.run("k3", "shared", "todo", "Binned card", "2026-05-03", at, at, at, at);
    card.run("k4", "shared", "todo", "Out of range", "2026-06-01", at, at, null, null);
    card.run("k5", "shared", "todo", "No date", null, at, at, null, null);
    card.run("k6", "private", "ptodo", "Owner only", "2026-05-04", at, at, null, null);
    card.run("k7", "binned", "btodo", "On a binned board", "2026-05-05", at, at, null, null);

    const overlay = createDueTasksQuery(db);
    expect(overlay.enabled).toBe(true);
    const range = { fromDate: "2026-05-01", toDate: "2026-06-01" };
    expect(overlay.list("owner", range).map((task) => task.cardId)).toEqual(["k1", "k6"]);
    expect(overlay.list("member", range)).toEqual([{ cardId: "k1", boardId: "shared", boardName: "Home", title: "Pay rent", dueOn: "2026-05-01" }]);
    expect(overlay.list("stranger", range)).toEqual([]);
    db.close();
  });
});

test("restricted links never show a title", () => {
  expect(linkLabel({ targetType: "note", targetId: "x", title: "Packing list", restricted: false })).toBe("Packing list");
  expect(linkLabel({ targetType: "note", targetId: "x", title: null, restricted: true })).toBe("Note you can't open");
  expect(linkLabel({ targetType: "card", targetId: "x", title: "Leaked", restricted: true })).toBe("Task you can't open");
  expect(linkLabel({ targetType: "collection_row", targetId: "x", title: null, restricted: true })).toBe("Collection item you can't open");
});
