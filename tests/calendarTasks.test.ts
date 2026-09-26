import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createUser, request } from "./support/harness";
import { runMigrations } from "../server/migrations";
import { createDueTasksQuery, dueTasksEnabled } from "../server/calendar/tasksOverlay";
import { linkLabel } from "../src/calendar/EventLinks";

describe("the Tasks due overlay", () => {
  test("include=tasks is on (migration 011 ran), empty for a user with no boards, and other values are refused", async () => {
    const user = await createUser("Overlay user");
    expect(dueTasksEnabled()).toBe(true);
    const withTasks = await request("/events?from=2026-05-01&to=2026-05-31&include=tasks", {}, user);
    expect(withTasks.status).toBe(200);
    expect(await withTasks.json()).toMatchObject({ occurrences: [], truncated: false, tasks: [] });
    const without = await (await request("/events?from=2026-05-01&to=2026-05-31", {}, user)).json() as Record<string, unknown>;
    expect("tasks" in without).toBe(false);
    expect((await request("/events?from=2026-05-01&to=2026-05-31&include=notes", {}, user)).status).toBe(400);
  });

  test("it lists readable, open, live cards in range", () => {
    const db = new Database(":memory:", { strict: true });
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);
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
    expect(overlay.list("member", range)).toEqual([
      { cardId: "k1", boardId: "shared", boardName: "Home", title: "Pay rent", dueOn: "2026-05-01", dueTime: null, dueTz: null, dueAt: null, date: "2026-05-01" }
    ]);
    expect(overlay.list("stranger", range)).toEqual([]);

    // Timed cards land on the viewer's local day of their exact instant (WAVE_13 §5.2, T94).
    const timed = db.query("UPDATE cards SET due_on = ?, due_time = ?, due_tz = ? WHERE id = ?");
    timed.run("2026-05-10", "23:30", "Pacific/Kiritimati", "k1"); // 2026-05-10T09:30Z
    timed.run("2026-05-10", "23:30", "Etc/GMT+12", "k6"); // 2026-05-11T11:30Z
    const day = (viewerTz: string, fromDate: string) => overlay.list("owner", { fromDate, toDate: `2026-05-${String(Number(fromDate.slice(8)) + 1).padStart(2, "0")}` }, viewerTz)
      .map((task) => [task.cardId, task.date, task.dueAt]);
    // A UTC−12 viewer sees the UTC+14 card on 9 May, a day before its civil date.
    expect(day("Etc/GMT+12", "2026-05-09")).toEqual([["k1", "2026-05-09", "2026-05-10T09:30:00.000Z"]]);
    // ...while the UTC−12 card sits on its own civil date.
    expect(day("Etc/GMT+12", "2026-05-10")).toEqual([["k6", "2026-05-10", "2026-05-11T11:30:00.000Z"]]);
    // A UTC+14 viewer sees the UTC−12 card on 12 May, two days after its civil date.
    expect(day("Pacific/Kiritimati", "2026-05-12")).toEqual([["k6", "2026-05-12", "2026-05-11T11:30:00.000Z"]]);
    expect(day("Pacific/Kiritimati", "2026-05-10")).toEqual([["k1", "2026-05-10", "2026-05-10T09:30:00.000Z"]]);
    // UTC viewers see both on their own UTC days; date-only cards sort before timed ones on a day.
    db.query("UPDATE cards SET due_on = '2026-05-10', column_id = 'todo', deleted_at = NULL, purge_after = NULL WHERE id = 'k4'").run();
    expect(overlay.list("owner", { fromDate: "2026-05-10", toDate: "2026-05-12" }, "UTC").map((task) => [task.cardId, task.date]))
      .toEqual([["k4", "2026-05-10"], ["k1", "2026-05-10"], ["k6", "2026-05-11"]]);
    // Without a zone argument the overlay uses UTC.
    expect(overlay.list("owner", { fromDate: "2026-05-11", toDate: "2026-05-12" }).map((task) => task.cardId)).toEqual(["k6"]);
    db.close();
  });

  test("busy days just outside the range never push in-range cards out", () => {
    const db = new Database(":memory:", { strict: true });
    db.exec("PRAGMA foreign_keys = ON");
    runMigrations(db);
    const at = "2026-01-01T00:00:00.000Z";
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('owner', 'o@example.test', 'owner', 'x', ?)").run(at);
    db.query("INSERT INTO boards (id, owner_id, name, visibility, created_at, updated_at) VALUES ('b', 'owner', 'Busy', 'private', ?, ?)").run(at, at);
    db.query("INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at, is_done) VALUES ('todo', 'b', 'To do', 1, ?, ?, 0)").run(at, at);
    const card = db.query("INSERT INTO cards (id, board_id, column_id, position, title, due_on, due_time, due_tz, created_at, updated_at) VALUES (?, 'b', 'todo', ?, ?, ?, ?, ?, ?, ?)");
    let position = 0;
    const add = (id: string, dueOn: string, dueTime: string | null = null, dueTz: string | null = null) =>
      card.run(id, ++position, id, dueOn, dueTime, dueTz, at, at);
    db.transaction(() => {
      // 700 date-only cards on the two days before the range, and 300 timed ones that land just
      // before it for a UTC viewer: all inside the widened ±2-day window, none in range.
      for (let index = 0; index < 700; index += 1) add(`a-edge-${String(index).padStart(3, "0")}`, index % 2 ? "2026-05-09" : "2026-05-08");
      for (let index = 0; index < 300; index += 1) add(`a-timed-${String(index).padStart(3, "0")}`, "2026-05-09", "23:00", "UTC");
      add("in-first", "2026-05-10");
      add("in-timed", "2026-05-10", "08:00", "UTC");
      add("in-last", "2026-05-11");
      // And the day after the range is just as busy.
      for (let index = 0; index < 700; index += 1) add(`z-edge-${String(index).padStart(3, "0")}`, "2026-05-12");
    })();
    const overlay = createDueTasksQuery(db);
    expect(overlay.list("owner", { fromDate: "2026-05-10", toDate: "2026-05-12" }, "UTC").map((task) => task.cardId)).toEqual(["in-first", "in-timed", "in-last"]);
    // A far-east viewer (UTC+14): the 23:00 UTC cards of 9 May fall on their 10 May and fill the
    // capped list after the one date-only card of that day.
    const east = overlay.list("owner", { fromDate: "2026-05-10", toDate: "2026-05-11" }, "Pacific/Kiritimati");
    expect(east).toHaveLength(200);
    expect(east[0]!.cardId).toBe("in-first");
    expect(east.slice(1).every((task) => task.cardId.startsWith("a-timed") && task.date === "2026-05-10")).toBe(true);
    db.close();
  });

  test("GET /api/events?include=tasks places a timed card by the viewer's tz", async () => {
    const owner = await createUser("Overlay timed");
    const created = await (await request("/tasks/boards", { method: "POST", body: JSON.stringify({ name: "Timed overlay" }) }, owner)).json() as { board: { id: string }; columns: Array<{ id: string }> };
    const card = await request(`/tasks/boards/${created.board.id}/cards`, {
      method: "POST",
      body: JSON.stringify({ columnId: created.columns[0]!.id, title: "Late call", dueOn: "2026-10-01", dueTime: "23:30", dueTz: "Pacific/Kiritimati" })
    }, owner);
    expect(card.status).toBe(201);
    const list = async (from: string, to: string, tz: string) =>
      ((await (await request(`/events?from=${from}&to=${to}&tz=${encodeURIComponent(tz)}&include=tasks`, {}, owner)).json()) as { tasks: Array<{ title: string; date: string; dueAt: string }> }).tasks;
    expect(await list("2026-09-30", "2026-10-01", "Etc/GMT+12")).toMatchObject([{ title: "Late call", date: "2026-09-30", dueAt: "2026-10-01T09:30:00.000Z" }]);
    expect(await list("2026-10-01", "2026-10-02", "Etc/GMT+12")).toEqual([]);
    expect(await list("2026-10-01", "2026-10-02", "Pacific/Kiritimati")).toMatchObject([{ title: "Late call", date: "2026-10-01" }]);
  });
});

test("restricted links never show a title", () => {
  expect(linkLabel({ targetType: "note", targetId: "x", title: "Packing list", restricted: false })).toBe("Packing list");
  expect(linkLabel({ targetType: "note", targetId: "x", title: null, restricted: true })).toBe("Note you can't open");
  expect(linkLabel({ targetType: "card", targetId: "x", title: "Leaked", restricted: true })).toBe("Task you can't open");
  expect(linkLabel({ targetType: "collection_row", targetId: "x", title: null, restricted: true })).toBe("Collection item you can't open");
});
