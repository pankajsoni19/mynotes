import { describe, expect, test } from "bun:test";
import { createUser, db, request, type Session } from "./support/harness";

/** Card hierarchy (research 2026-09-26 §6, D120–D135, T110–T114): parent and level, roll-ups, Bin subtrees, structure. */

type Column = { id: string; name: string; position: number; is_done: 0 | 1 };
type Card = { id: string; board_id: string; column_id: string; title: string; revision: number; parent_card_id: string | null; level: number; child_count: number; done_child_count: number };

async function call(session: Session | undefined, method: string, path: string, body?: unknown) {
  const response = await request(path.startsWith("/bin") ? path : `/tasks${path}`, method === "GET" ? {} : { method, body: JSON.stringify(body ?? {}) }, session);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

const EPICS = { levels: [{ name: "Epic", plural: "Epics" }, { name: "Story", plural: "Stories" }, { name: "Subtask", plural: "Subtasks" }], workLevel: 1, sprints: false };

/** A shared board with three levels (set in the database, before the structure endpoint is used). */
async function setup(label: string, structure: object = EPICS) {
  const owner = await createUser(`${label} owner`);
  const member = await createUser(`${label} member`);
  const stranger = await createUser(`${label} stranger`);
  const created = await call(owner, "POST", "/boards", { name: `${label} board` });
  const boardId = created.body.board.id as string;
  const columns = created.body.columns as [Column, Column, Column];
  db.query("UPDATE boards SET structure_json = ? WHERE id = ?").run(JSON.stringify(structure), boardId);
  expect((await call(owner, "PUT", `/boards/${boardId}/sharing`, { visibility: "selected", userIds: [member.userId] })).status).toBe(200);
  return { owner, member, stranger, boardId, columns };
}

async function addCard(session: Session, boardId: string, columnId: string, title: string, extra: Record<string, unknown> = {}) {
  const created = await call(session, "POST", `/boards/${boardId}/cards`, { columnId, title, ...extra });
  expect(created.status).toBe(201);
  return created.body.card as Card;
}

const boardCards = async (session: Session, boardId: string) => (await call(session, "GET", `/boards/${boardId}`)).body.cards as Card[];
const lastAudit = (action: string) => db.query("SELECT metadata_json FROM audit_log WHERE event_type = ? ORDER BY rowid DESC LIMIT 1").get(action) as { metadata_json: string } | null;

describe("card parent and level", () => {
  test("levels default to the parent's plus one, else the work level; orphans are allowed at any level", async () => {
    const { member, boardId, columns } = await setup("Levels");
    const todo = columns[0].id;
    const story = await addCard(member, boardId, todo, "Orphan story");
    expect(story).toMatchObject({ level: 1, parent_card_id: null, child_count: 0, done_child_count: 0 });
    const epic = await addCard(member, boardId, todo, "Epic", { level: 0 });
    expect(epic.level).toBe(0);
    const child = await addCard(member, boardId, todo, "Story", { parentId: epic.id });
    expect(child).toMatchObject({ level: 1, parent_card_id: epic.id });
    const subtask = await addCard(member, boardId, todo, "Subtask", { parentId: child.id, level: 2 });
    expect(subtask).toMatchObject({ level: 2, parent_card_id: child.id });
    const orphanSubtask = await addCard(member, boardId, todo, "Loose subtask", { level: 2 });
    expect(orphanSubtask.parent_card_id).toBeNull();
    const audit = JSON.parse(lastAudit("task.card_create")!.metadata_json);
    expect(audit).toMatchObject({ boardId, level: 2 });
    expect(audit.parentId).toBeUndefined();
  });

  test("every invalid parent is the same 400 PARENT_INVALID, and nothing is written (T113)", async () => {
    const { owner, member, stranger, boardId, columns } = await setup("Invalid parent");
    const todo = columns[0].id;
    const epic = await addCard(member, boardId, todo, "Epic", { level: 0 });
    const story = await addCard(member, boardId, todo, "Story", { parentId: epic.id });
    const subtask = await addCard(member, boardId, todo, "Subtask", { parentId: story.id });
    const other = await call(stranger, "POST", "/boards", { name: "Stranger board" });
    db.query("UPDATE boards SET structure_json = ? WHERE id = ?").run(JSON.stringify(EPICS), other.body.board.id);
    const foreign = await addCard(stranger, other.body.board.id, other.body.columns[0].id, "Foreign epic", { level: 0 });
    const binned = await addCard(member, boardId, todo, "Binned epic", { level: 0 });
    expect((await call(member, "DELETE", `/cards/${binned.id}`)).status).toBe(200);
    const before = (await boardCards(owner, boardId)).length;
    const attempts: Array<Record<string, unknown>> = [
      { parentId: crypto.randomUUID() },       // unknown
      { parentId: foreign.id },                // another board, even one the caller cannot read
      { parentId: binned.id },                 // binned
      { parentId: epic.id, level: 2 },         // skips a level
      { parentId: story.id, level: 1 },        // same level
      { parentId: subtask.id }                 // below the last level
    ];
    for (const extra of attempts) {
      const response = await call(member, "POST", `/boards/${boardId}/cards`, { columnId: todo, title: "Nope", ...extra });
      expect(response).toMatchObject({ status: 400, body: { code: "PARENT_INVALID", error: "Choose a card one level up on this board as the parent" } });
    }
    expect((await call(member, "POST", `/boards/${boardId}/cards`, { columnId: todo, title: "Too deep", level: 3 })).status).toBe(400);
    expect(await boardCards(owner, boardId)).toHaveLength(before);
    // A flat board has one level.
    const flat = await setup("Flat levels", { levels: [{ name: "Card", plural: "Cards" }], workLevel: 0, sprints: false });
    expect(await call(flat.member, "POST", `/boards/${flat.boardId}/cards`, { columnId: flat.columns[0].id, title: "Level 1", level: 1 }))
      .toMatchObject({ status: 400, body: { code: "LEVEL_INVALID" } });
  });

  test("reparent with a revision compare-and-swap; the level stays unless it is changed", async () => {
    const { member, owner, boardId, columns } = await setup("Reparent");
    const todo = columns[0].id;
    const first = await addCard(member, boardId, todo, "First epic", { level: 0 });
    const second = await addCard(member, boardId, todo, "Second epic", { level: 0 });
    const story = await addCard(member, boardId, todo, "Story", { parentId: first.id });
    const moved = await call(member, "PATCH", `/cards/${story.id}`, { parentId: second.id, revision: story.revision });
    expect(moved).toMatchObject({ status: 200, body: { card: { parent_card_id: second.id, level: 1, revision: story.revision + 1 } } });
    expect(JSON.parse(lastAudit("task.card_reparent")!.metadata_json)).toEqual({ boardId, cardId: story.id, parentId: second.id });
    // A stale revision is CARD_CHANGED with the current card.
    const stale = await call(owner, "PATCH", `/cards/${story.id}`, { parentId: first.id, revision: story.revision });
    expect(stale).toMatchObject({ status: 409, body: { code: "CARD_CHANGED", card: { parent_card_id: second.id } } });
    // Detach.
    const detached = await call(member, "PATCH", `/cards/${story.id}`, { parentId: null, revision: story.revision + 1 });
    expect(detached.body.card).toMatchObject({ parent_card_id: null, level: 1 });
    // A story cannot sit under a story, or under itself.
    expect((await call(member, "PATCH", `/cards/${story.id}`, { parentId: story.id, revision: detached.body.card.revision })).body.code).toBe("PARENT_INVALID");
    const other = await addCard(member, boardId, todo, "Other story");
    expect((await call(member, "PATCH", `/cards/${story.id}`, { parentId: other.id, revision: detached.body.card.revision })).body.code).toBe("PARENT_INVALID");
  });

  test("change level: allowed without children, refused with HAS_CHILDREN, and a parent must follow the new level", async () => {
    const { member, boardId, columns } = await setup("Change level");
    const todo = columns[0].id;
    const epic = await addCard(member, boardId, todo, "Epic", { level: 0 });
    const story = await addCard(member, boardId, todo, "Story", { parentId: epic.id });
    const refused = await call(member, "PATCH", `/cards/${epic.id}`, { level: 1, revision: epic.revision });
    expect(refused).toMatchObject({ status: 409, body: { code: "HAS_CHILDREN", childCount: 1 } });
    // Story → subtask under another story needs the new level and a parent one level up.
    const host = await addCard(member, boardId, todo, "Host story");
    expect((await call(member, "PATCH", `/cards/${story.id}`, { level: 2, revision: story.revision })).body.code).toBe("PARENT_INVALID");
    const changed = await call(member, "PATCH", `/cards/${story.id}`, { level: 2, parentId: host.id, revision: story.revision });
    expect(changed).toMatchObject({ status: 200, body: { card: { level: 2, parent_card_id: host.id } } });
    expect(JSON.parse(lastAudit("task.card_level")!.metadata_json)).toEqual({ boardId, cardId: story.id, level: 2 });
    // The epic has no children now and may change level.
    expect((await call(member, "PATCH", `/cards/${epic.id}`, { level: 1, revision: epic.revision })).body.card.level).toBe(1);
  });

  test("a card has at most 100 direct children (T111)", async () => {
    const { member, boardId, columns } = await setup("Width", { levels: [{ name: "Task", plural: "Tasks" }, { name: "Subtask", plural: "Subtasks" }], workLevel: 0, sprints: false });
    const todo = columns[0].id;
    const parent = await addCard(member, boardId, todo, "Parent");
    const insert = db.query(`INSERT INTO cards (id, board_id, column_id, position, title, parent_card_id, level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
    for (let index = 0; index < 100; index += 1) insert.run(crypto.randomUUID(), boardId, todo, 10_000 + index, `Child ${index}`, parent.id);
    expect(await call(member, "POST", `/boards/${boardId}/cards`, { columnId: todo, title: "One too many", parentId: parent.id }))
      .toMatchObject({ status: 409, body: { code: "LIMIT_REACHED" } });
    const loose = await addCard(member, boardId, todo, "Loose", { level: 1 });
    expect((await call(member, "PATCH", `/cards/${loose.id}`, { parentId: parent.id, revision: loose.revision })).body.code).toBe("LIMIT_REACHED");
  });

  test("GET /cards/:k carries parent, ancestors, and children from the same board; strangers get 404", async () => {
    const { member, stranger, boardId, columns } = await setup("Detail");
    const [todo, doing, done] = [columns[0].id, columns[1].id, columns[2].id];
    const epic = await addCard(member, boardId, todo, "Epic", { level: 0 });
    const story = await addCard(member, boardId, doing, "Story", { parentId: epic.id });
    const subtaskDone = await addCard(member, boardId, done, "Done subtask", { parentId: story.id });
    const subtaskOpen = await addCard(member, boardId, todo, "Open subtask", { parentId: story.id });
    const view = (await call(member, "GET", `/cards/${story.id}`)).body.card;
    expect(view.parent).toEqual({ id: epic.id, title: "Epic", level: 0 });
    expect(view.ancestors).toEqual([{ id: epic.id, title: "Epic", level: 0 }]);
    // Children by column position, then card position.
    expect(view.children.map((child: { id: string }) => child.id)).toEqual([subtaskOpen.id, subtaskDone.id]);
    expect(view.children[1]).toMatchObject({ title: "Done subtask", column_name: "Done", is_done: 1, level: 2 });
    expect(view).toMatchObject({ child_count: 2, done_child_count: 1 });
    const leaf = (await call(member, "GET", `/cards/${subtaskOpen.id}`)).body.card;
    expect(leaf.ancestors.map((item: { title: string }) => item.title)).toEqual(["Epic", "Story"]);
    expect((await call(member, "GET", `/cards/${story.id}/children`)).body.children).toHaveLength(2);
    expect((await call(stranger, "GET", `/cards/${story.id}/children`)).status).toBe(404);
  });
});

describe("roll-ups", () => {
  test("the board payload counts live direct children and those in a done column, with one grouped query (D134)", async () => {
    const { owner, member, boardId, columns } = await setup("Rollup");
    const [todo, doing, done] = [columns[0].id, columns[1].id, columns[2].id];
    const epic = await addCard(member, boardId, todo, "Epic", { level: 0 });
    const story = await addCard(member, boardId, doing, "Story", { parentId: epic.id });
    const subtasks = [];
    for (const title of ["One", "Two", "Three"]) subtasks.push(await addCard(member, boardId, todo, title, { parentId: story.id }));
    const find = async (id: string) => (await boardCards(owner, boardId)).find((card) => card.id === id)!;
    expect(await find(epic.id)).toMatchObject({ child_count: 1, done_child_count: 0 });
    expect(await find(story.id)).toMatchObject({ child_count: 3, done_child_count: 0 });
    // Checking a subtask is a move to the done column; the parent's count follows.
    expect((await call(member, "POST", `/cards/${subtasks[0]!.id}/move`, { columnId: done, afterCardId: null })).status).toBe(200);
    expect((await call(member, "POST", `/cards/${subtasks[1]!.id}/move`, { columnId: done, afterCardId: null })).status).toBe(200);
    expect(await find(story.id)).toMatchObject({ child_count: 3, done_child_count: 2 });
    // Unchecking moves it back; binning a child drops it from the counts; direct children only.
    expect((await call(member, "POST", `/cards/${subtasks[1]!.id}/move`, { columnId: todo, afterCardId: null })).status).toBe(200);
    expect((await call(member, "DELETE", `/cards/${subtasks[2]!.id}`)).status).toBe(200);
    expect(await find(story.id)).toMatchObject({ child_count: 2, done_child_count: 1 });
    expect(await find(epic.id)).toMatchObject({ child_count: 1, done_child_count: 0 });
    // A done column turned off counts as open again.
    expect((await call(owner, "PATCH", `/columns/${done}`, { isDone: false })).status).toBe(200);
    expect(await find(story.id)).toMatchObject({ child_count: 2, done_child_count: 0 });
    // The board carries its structure.
    const board = (await call(member, "GET", `/boards/${boardId}`)).body.board;
    expect(board.structure).toEqual(EPICS);
    expect((await call(member, "GET", "/boards")).body.boards.find((item: { id: string }) => item.id === boardId).structure).toEqual(EPICS);
  });
});
