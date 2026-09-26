import { describe, expect, test } from "bun:test";
import { createUser, db, request, type Session } from "./support/harness";

/** Board sprints (research 2026-09-26 §6, D124, D131, D132, D135, T118): the lifecycle, card assignment, and carry-over. */

type Column = { id: string; name: string; position: number; is_done: 0 | 1 };
type Card = { id: string; column_id: string; title: string; revision: number; parent_card_id: string | null; level: number; sprint_id: string | null };
type Sprint = { id: string; name: string; state: string; is_active: boolean; start_on: string | null; end_on: string | null; card_count: number; done_count: number; position: number; completed_at: string | null };

async function call(session: Session | undefined, method: string, path: string, body?: unknown) {
  const response = await request(`/tasks${path}`, method === "GET" ? {} : { method, body: JSON.stringify(body ?? {}) }, session);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

const SPRINT_TASKS = { levels: [{ name: "Task", plural: "Tasks" }, { name: "Subtask", plural: "Subtasks" }], workLevel: 0, sprints: true };

/** A shared Sprint › Task › Subtask board with To do, Doing, Done. */
async function setup(label: string, structure: object = SPRINT_TASKS) {
  const owner = await createUser(`${label} owner`);
  const member = await createUser(`${label} member`);
  const stranger = await createUser(`${label} stranger`);
  const created = await call(owner, "POST", "/boards", { name: `${label} board` });
  const boardId = created.body.board.id as string;
  const columns = created.body.columns as [Column, Column, Column];
  expect((await call(owner, "PATCH", `/boards/${boardId}`, { structure })).status).toBe(200);
  expect((await call(owner, "PUT", `/boards/${boardId}/sharing`, { visibility: "selected", userIds: [member.userId] })).status).toBe(200);
  return { owner, member, stranger, boardId, columns };
}

async function addSprint(session: Session, boardId: string, name: string, extra: Record<string, unknown> = {}) {
  const created = await call(session, "POST", `/boards/${boardId}/sprints`, { name, ...extra });
  expect(created.status).toBe(201);
  return created.body.sprint as Sprint;
}

async function addCard(session: Session, boardId: string, columnId: string, title: string, extra: Record<string, unknown> = {}) {
  const created = await call(session, "POST", `/boards/${boardId}/cards`, { columnId, title, ...extra });
  expect(created.status).toBe(201);
  return created.body.card as Card;
}

const boardOf = async (session: Session, boardId: string) => (await call(session, "GET", `/boards/${boardId}`)).body as { cards: Card[]; sprints: Sprint[] };
const lastAudit = (action: string) => {
  const row = db.query("SELECT metadata_json FROM audit_log WHERE event_type = ? ORDER BY rowid DESC LIMIT 1").get(action) as { metadata_json: string } | null;
  return row ? JSON.parse(row.metadata_json) as Record<string, unknown> : null;
};

describe("sprint lifecycle", () => {
  test("the owner creates, renames, dates, reorders, and starts sprints; readers list them; strangers get 404", async () => {
    const { owner, member, stranger, boardId } = await setup("Lifecycle");
    const first = await addSprint(owner, boardId, "Sprint 1", { goal: "Ship the checkout", startOn: "2026-10-01", endOn: "2026-10-14" });
    expect(first).toMatchObject({ name: "Sprint 1", state: "planned", is_active: false, start_on: "2026-10-01", end_on: "2026-10-14", card_count: 0, done_count: 0, completed_at: null });
    expect(lastAudit("task.sprint_create")).toEqual({ boardId, sprintId: first.id });
    const second = await addSprint(owner, boardId, "Sprint 2");
    expect(second.position).toBeGreaterThan(first.position);

    // Readers list; strangers and missing boards are 404.
    const listed = await call(member, "GET", `/boards/${boardId}/sprints`);
    expect(listed.status).toBe(200);
    expect(listed.body.sprints.map((sprint: Sprint) => sprint.name)).toEqual(["Sprint 1", "Sprint 2"]);
    expect(listed.body.nextCursor).toBeNull();
    expect((await call(stranger, "GET", `/boards/${boardId}/sprints`)).status).toBe(404);
    expect((await call(member, "GET", `/boards/${boardId}/sprints?state=closed`)).status).toBe(400);

    // Owner-only writes: members get 403, strangers 404.
    expect(await call(member, "POST", `/boards/${boardId}/sprints`, { name: "Mine" })).toMatchObject({ status: 403, body: { code: "OWNER_ONLY" } });
    expect(await call(member, "PATCH", `/sprints/${first.id}`, { name: "Renamed" })).toMatchObject({ status: 403, body: { code: "OWNER_ONLY" } });
    expect((await call(stranger, "PATCH", `/sprints/${first.id}`, { name: "Renamed" })).status).toBe(404);
    expect((await call(stranger, "DELETE", `/sprints/${second.id}`)).status).toBe(404);

    const renamed = await call(owner, "PATCH", `/sprints/${first.id}`, { name: "  Sprint 12 ", endOn: "2026-10-10" });
    expect(renamed.body.sprint).toMatchObject({ name: "Sprint 12", start_on: "2026-10-01", end_on: "2026-10-10" });
    expect(lastAudit("task.sprint_update")).toEqual({ boardId, sprintId: first.id, fields: ["name", "endOn"] });
    expect((await call(owner, "PATCH", `/sprints/${first.id}`, { endOn: "2026-09-01" })).status).toBe(400);
    expect((await call(owner, "POST", `/boards/${boardId}/sprints`, { name: "Backwards", startOn: "2026-10-14", endOn: "2026-10-01" })).status).toBe(400);
    expect((await call(owner, "POST", `/boards/${boardId}/sprints`, { name: "Bad date", startOn: "2026-02-30" })).status).toBe(400);
    expect((await call(owner, "POST", `/boards/${boardId}/sprints`, { name: "x".repeat(61) })).status).toBe(400);

    // Reorder: Sprint 2 first.
    expect((await call(owner, "PATCH", `/sprints/${second.id}`, { afterSprintId: null })).status).toBe(200);
    expect((await call(member, "GET", `/boards/${boardId}/sprints`)).body.sprints.map((sprint: Sprint) => sprint.name)).toEqual(["Sprint 2", "Sprint 12"]);

    // Start: one active sprint per board, and it lists first.
    const started = await call(owner, "PATCH", `/sprints/${first.id}`, { state: "active" });
    expect(started.body.sprint).toMatchObject({ state: "active", is_active: true });
    expect(lastAudit("task.sprint_start")).toEqual({ boardId, sprintId: first.id });
    expect(await call(owner, "PATCH", `/sprints/${second.id}`, { state: "active" })).toMatchObject({ status: 409, body: { code: "SPRINT_ACTIVE", activeSprintId: first.id } });
    expect((await call(owner, "PATCH", `/sprints/${first.id}`, { state: "completed" })).status).toBe(400);
    const board = await boardOf(member, boardId);
    expect(board.sprints.map((sprint) => [sprint.name, sprint.state])).toEqual([["Sprint 12", "active"], ["Sprint 2", "planned"]]);
  });

  test("sprints need sprints on; at most 50 open; only an empty planned sprint is deleted", async () => {
    const flat = await setup("Sprints off", { levels: [{ name: "Card", plural: "Cards" }], workLevel: 0, sprints: false });
    expect(await call(flat.owner, "POST", `/boards/${flat.boardId}/sprints`, { name: "Sprint 1" })).toMatchObject({ status: 409, body: { code: "SPRINTS_OFF" } });

    const { owner, member, boardId, columns } = await setup("Limits");
    const planned = await addSprint(owner, boardId, "Planned");
    const card = await addCard(member, boardId, columns[0].id, "Planned work", { sprintId: planned.id });
    expect(await call(owner, "DELETE", `/sprints/${planned.id}`)).toMatchObject({ status: 409, body: { code: "SPRINT_NOT_EMPTY", cardCount: 1 } });
    expect((await call(member, "PATCH", `/cards/${card.id}`, { sprintId: null, revision: card.revision })).status).toBe(200);
    expect((await call(owner, "DELETE", `/sprints/${planned.id}`)).status).toBe(200);
    expect(lastAudit("task.sprint_delete")).toEqual({ boardId, sprintId: planned.id });
    const active = await addSprint(owner, boardId, "Active");
    await call(owner, "PATCH", `/sprints/${active.id}`, { state: "active" });
    expect(await call(owner, "DELETE", `/sprints/${active.id}`)).toMatchObject({ status: 409, body: { code: "SPRINT_NOT_PLANNED" } });

    const insert = db.query("INSERT INTO board_sprints (id, board_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (let index = 1; index < 50; index += 1) insert.run(crypto.randomUUID(), boardId, `Bulk ${index}`, 5000 + index, "2026-01-01", "2026-01-01");
    expect(await call(owner, "POST", `/boards/${boardId}/sprints`, { name: "One too many" })).toMatchObject({ status: 409, body: { code: "LIMIT_REACHED" } });
    // Turning sprints off is refused while sprints are open (T120).
    expect(await call(owner, "PATCH", `/boards/${boardId}`, { structure: { ...SPRINT_TASKS, sprints: false } })).toMatchObject({ status: 409, body: { code: "SPRINTS_IN_USE" } });
  });

  test("the Scrum template starts with a planned Sprint 1 of two weeks", async () => {
    const owner = await createUser("Scrum template owner");
    const created = await call(owner, "POST", "/boards", { name: "Web app", template: "scrum" });
    expect(created.status).toBe(201);
    const { sprints } = await boardOf(owner, created.body.board.id);
    expect(sprints).toHaveLength(1);
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 13)).toISOString().slice(0, 10);
    expect(sprints[0]).toMatchObject({ name: "Sprint 1", state: "planned", start_on: today, end_on: end });
    const kanban = await call(owner, "POST", "/boards", { name: "Plain" });
    expect((await boardOf(owner, kanban.body.board.id)).sprints).toEqual([]);
  });
});

describe("planning cards in sprints", () => {
  test("only work-level cards store a sprint; subtasks inherit it on read and follow a reparent", async () => {
    const { owner, member, boardId, columns } = await setup("Assign");
    const sprint = await addSprint(owner, boardId, "Sprint 1");
    const other = await addSprint(owner, boardId, "Sprint 2");
    const task = await addCard(member, boardId, columns[0].id, "Checkout", { sprintId: sprint.id });
    expect(task.sprint_id).toBe(sprint.id);
    expect(lastAudit("task.card_create")).toMatchObject({ boardId, cardId: task.id, sprintId: sprint.id });
    const subtask = await addCard(member, boardId, columns[0].id, "Form", { parentId: task.id });
    expect(subtask.sprint_id).toBe(sprint.id);
    // A subtask stores none: 400 SPRINT_LEVEL on create and on PATCH, and nothing is written.
    expect(await call(member, "POST", `/boards/${boardId}/cards`, { columnId: columns[0].id, title: "Nope", parentId: task.id, sprintId: other.id }))
      .toMatchObject({ status: 400, body: { code: "SPRINT_LEVEL" } });
    expect(await call(member, "PATCH", `/cards/${subtask.id}`, { sprintId: other.id, revision: subtask.revision })).toMatchObject({ status: 400, body: { code: "SPRINT_LEVEL" } });
    expect((db.query("SELECT sprint_id FROM cards WHERE id = ?").get(subtask.id) as { sprint_id: string | null }).sprint_id).toBeNull();

    // Moving the task to another sprint moves the subtask with it (derived, D124).
    const moved = await call(member, "PATCH", `/cards/${task.id}`, { sprintId: other.id, revision: task.revision });
    expect(moved.body.card).toMatchObject({ sprint_id: other.id, revision: task.revision + 1 });
    expect(lastAudit("task.card_update")).toMatchObject({ cardId: task.id, sprintId: other.id });
    let cards = (await boardOf(member, boardId)).cards;
    expect(cards.find((card) => card.id === subtask.id)!.sprint_id).toBe(other.id);
    // Reparenting the subtask under a backlog task takes it out of the sprint.
    const backlog = await addCard(member, boardId, columns[0].id, "Backlog task");
    const current = cards.find((card) => card.id === subtask.id)!;
    expect((await call(member, "PATCH", `/cards/${subtask.id}`, { parentId: backlog.id, revision: current.revision })).body.card.sprint_id).toBeNull();
    // A stale revision is CARD_CHANGED.
    expect(await call(member, "PATCH", `/cards/${task.id}`, { sprintId: null, revision: task.revision })).toMatchObject({ status: 409, body: { code: "CARD_CHANGED" } });
    // Counts are work-level cards only.
    cards = (await boardOf(member, boardId)).cards;
    const summary = (await boardOf(member, boardId)).sprints.find((item) => item.id === other.id)!;
    expect(summary).toMatchObject({ card_count: 1, done_count: 0 });
    expect(cards.filter((card) => card.sprint_id === other.id).map((card) => card.title)).toEqual(["Checkout"]);
  });

  test("a sprint of another board is 404, a completed one 409, and sprints off 400; changing level clears the stored sprint", async () => {
    const { owner, member, boardId, columns } = await setup("Refusals");
    const sprint = await addSprint(owner, boardId, "Sprint 1");
    const foreign = await setup("Refusals other");
    const foreignSprint = await addSprint(foreign.owner, foreign.boardId, "Theirs");
    expect((await call(member, "POST", `/boards/${boardId}/cards`, { columnId: columns[0].id, title: "Nope", sprintId: foreignSprint.id })).status).toBe(404);
    expect((await call(member, "POST", `/boards/${boardId}/cards`, { columnId: columns[0].id, title: "Nope", sprintId: crypto.randomUUID() })).status).toBe(404);
    db.query("UPDATE board_sprints SET state = 'closed', closed_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", sprint.id);
    expect(await call(member, "POST", `/boards/${boardId}/cards`, { columnId: columns[0].id, title: "Nope", sprintId: sprint.id })).toMatchObject({ status: 409, body: { code: "SPRINT_COMPLETED" } });
    const open = await addSprint(owner, boardId, "Sprint 2");
    const task = await addCard(member, boardId, columns[0].id, "Task", { sprintId: open.id });
    // Change level: the card is now a subtask, so it no longer stores a sprint.
    const releveled = await call(member, "PATCH", `/cards/${task.id}`, { level: 1, revision: task.revision });
    expect(releveled.status).toBe(200);
    expect(releveled.body.card.sprint_id).toBeNull();
    expect((db.query("SELECT sprint_id FROM cards WHERE id = ?").get(task.id) as { sprint_id: string | null }).sprint_id).toBeNull();

    const flat = await setup("Refusals flat", { levels: [{ name: "Card", plural: "Cards" }], workLevel: 0, sprints: false });
    const flatCard = await addCard(flat.member, flat.boardId, flat.columns[0].id, "Card");
    expect(await call(flat.member, "PATCH", `/cards/${flatCard.id}`, { sprintId: open.id, revision: flatCard.revision })).toMatchObject({ status: 400, body: { code: "SPRINTS_OFF" } });
    // null is always accepted (nothing to store).
    expect((await call(flat.member, "PATCH", `/cards/${flatCard.id}`, { sprintId: null, revision: flatCard.revision })).status).toBe(200);
  });

  test("completed sprints page newest first", async () => {
    const { owner, member, boardId } = await setup("Paging");
    const insert = db.query("INSERT INTO board_sprints (id, board_id, name, state, position, closed_at, created_at, updated_at) VALUES (?, ?, ?, 'closed', ?, ?, ?, ?)");
    for (let index = 0; index < 25; index += 1) {
      const at = `2026-0${1 + Math.floor(index / 10)}-${String(10 + (index % 10)).padStart(2, "0")}T00:00:00.000Z`;
      insert.run(crypto.randomUUID(), boardId, `Old ${index}`, index, at, at, at);
    }
    await addSprint(owner, boardId, "Next");
    const first = await call(member, "GET", `/boards/${boardId}/sprints`);
    expect(first.body.sprints).toHaveLength(21);
    expect(first.body.sprints[0]).toMatchObject({ name: "Next", state: "planned" });
    expect(first.body.sprints[1]).toMatchObject({ name: "Old 24", state: "completed" });
    const second = await call(member, "GET", `/boards/${boardId}/sprints?state=completed&cursor=${first.body.nextCursor}`);
    expect(second.body.sprints.map((sprint: Sprint) => sprint.name)).toEqual(["Old 4", "Old 3", "Old 2", "Old 1", "Old 0"]);
    expect(second.body.nextCursor).toBeNull();
    expect((await call(member, "GET", `/boards/${boardId}/sprints?cursor=bad!`)).status).toBe(400);
    // The board payload carries the open sprints and the last five completed ones.
    expect((await boardOf(member, boardId)).sprints).toHaveLength(6);
  });
});
