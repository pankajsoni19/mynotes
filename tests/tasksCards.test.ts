import { describe, expect, test } from "bun:test";
import { createUser, db, request, type Session } from "./support/harness";

type Column = { id: string; name: string; position: number };
type Card = { id: string; board_id: string; column_id: string; position: number; title: string; description?: string; revision: number; has_description: number; created_by: string | null; creator_name: string | null };

async function call(session: Session | undefined, method: string, path: string, body?: unknown) {
  const response = await request(`/tasks${path}`, method === "GET" ? {} : { method, body: JSON.stringify(body ?? {}) }, session);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}

async function setup(label: string) {
  const owner = await createUser(`${label} owner`);
  const member = await createUser(`${label} member`);
  const stranger = await createUser(`${label} stranger`);
  const created = await call(owner, "POST", "/boards", { name: `${label} board` });
  const board = created.body.board as { id: string };
  const columns = created.body.columns as [Column, Column, Column];
  expect((await call(owner, "PUT", `/boards/${board.id}/sharing`, { visibility: "selected", userIds: [member.userId] })).status).toBe(200);
  return { owner, member, stranger, board, columns };
}

async function addCard(session: Session, boardId: string, columnId: string, title: string, extra: Record<string, unknown> = {}) {
  const created = await call(session, "POST", `/boards/${boardId}/cards`, { columnId, title, ...extra });
  expect(created.status).toBe(201);
  return created.body.card as Card;
}

async function order(session: Session, boardId: string, columnId: string) {
  const board = (await call(session, "GET", `/boards/${boardId}`)).body;
  return (board.cards as Card[]).filter((card) => card.column_id === columnId).map((card) => card.title);
}

describe("task cards", () => {
  test("members create cards at the bottom, top, or after an anchor", async () => {
    const { member, owner, board, columns } = await setup("Create");
    const todo = columns[0].id;
    const a = await addCard(member, board.id, todo, "A", { description: "Some **detail**" });
    expect(a).toMatchObject({ title: "A", position: 1024, revision: 1, created_by: member.userId, creator_name: "Create member", description: "Some **detail**", has_description: 1 });
    const b = await addCard(owner, board.id, todo, "B");
    expect(b.position).toBe(2048);
    const top = await addCard(member, board.id, todo, "Top", { afterCardId: null });
    expect(top.position).toBe(512);
    const middle = await addCard(member, board.id, todo, "Middle", { afterCardId: a.id });
    expect(middle.position).toBe(1536);
    expect(await order(owner, board.id, todo)).toEqual(["Top", "A", "Middle", "B"]);
    const listed = (await call(owner, "GET", `/boards/${board.id}`)).body;
    expect(listed.board.card_count).toBe(4);
    // The board view never carries descriptions.
    expect((listed.cards as Card[]).every((card) => card.description === undefined)).toBe(true);
    const fetched = await call(member, "GET", `/cards/${a.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ card: { id: a.id, description: "Some **detail**" }, comments: [], attachments: [] });
  });

  test("validates card input", async () => {
    const { owner, board, columns } = await setup("Validate");
    const todo = columns[0].id;
    for (const body of [
      { columnId: todo, title: "" },
      { columnId: todo, title: "x".repeat(201) },
      { columnId: todo, title: "tab\tin title" },
      { columnId: todo, title: "ok", description: "é".repeat(32_769) },
      { columnId: todo, title: "ok", position: 5 },
      { columnId: "nope", title: "ok" },
      { title: "ok" }
    ]) expect((await call(owner, "POST", `/boards/${board.id}/cards`, body)).status).toBe(400);
    const card = await addCard(owner, board.id, todo, "Max", { description: "x".repeat(65_536) });
    expect(card.description!.length).toBe(65_536);
    expect((await call(owner, "PATCH", `/cards/${card.id}`, { revision: 1 })).status).toBe(400);
    expect((await call(owner, "PATCH", `/cards/${card.id}`, { title: "x", revision: 0 })).status).toBe(400);
    expect((await call(owner, "POST", `/cards/${card.id}/move`, { columnId: todo })).status).toBe(400);
  });

  test("strangers get 404 on every card route", async () => {
    const { owner, stranger, board, columns } = await setup("Stranger");
    const card = await addCard(owner, board.id, columns[0].id, "Private");
    const routes: Array<[string, string, unknown?]> = [
      ["POST", `/boards/${board.id}/cards`, { columnId: columns[0].id, title: "Sneaky" }],
      ["GET", `/cards/${card.id}`],
      ["PATCH", `/cards/${card.id}`, { title: "Hacked", revision: 1 }],
      ["POST", `/cards/${card.id}/move`, { columnId: columns[1].id, afterCardId: null }],
      ["DELETE", `/cards/${card.id}`]
    ];
    for (const [method, path, body] of routes) expect([method, path, (await call(stranger, method, path, body)).status]).toEqual([method, path, 404]);
    expect((await call(owner, "GET", `/cards/${card.id}`)).body.card.title).toBe("Private");
  });

  test("IDOR: ids from board A are rejected through board B", async () => {
    const first = await setup("Idor A");
    const second = await setup("Idor B");
    const cardA = await addCard(first.owner, first.board.id, first.columns[0].id, "A card");
    const cardB = await addCard(second.owner, second.board.id, second.columns[0].id, "B card");
    // Board B's owner, who cannot read board A:
    expect((await call(second.owner, "POST", `/boards/${second.board.id}/cards`, { columnId: first.columns[0].id, title: "x" })).status).toBe(404);
    expect((await call(second.owner, "POST", `/cards/${cardB.id}/move`, { columnId: first.columns[0].id, afterCardId: null })).status).toBe(404);
    const foreignAnchor = await call(second.owner, "POST", `/cards/${cardB.id}/move`, { columnId: second.columns[1].id, afterCardId: cardA.id });
    expect(foreignAnchor.status).toBe(409);
    expect(foreignAnchor.body).toMatchObject({ code: "STALE_POSITION", columnId: second.columns[1].id, order: [] });
    expect((await call(second.owner, "GET", `/cards/${cardA.id}`)).status).toBe(404);
    // A user who can read both boards still cannot move a card across boards.
    await call(first.owner, "PUT", `/boards/${first.board.id}/sharing`, { visibility: "all_users", userIds: [] });
    expect((await call(second.owner, "POST", `/cards/${cardB.id}/move`, { columnId: first.columns[0].id, afterCardId: null })).status).toBe(404);
    expect((await call(second.owner, "POST", `/boards/${second.board.id}/cards`, { columnId: first.columns[0].id, title: "x" })).status).toBe(404);
    expect((await call(first.owner, "GET", `/cards/${cardA.id}`)).body.card.column_id).toBe(first.columns[0].id);
    expect((db.query("SELECT board_id, column_id FROM cards WHERE id = ?").get(cardB.id) as Record<string, string>)).toEqual({ board_id: second.board.id, column_id: second.columns[0].id });
  });

  test("moves to the top, middle, bottom, and across columns", async () => {
    const { member, board, columns } = await setup("Move");
    const [todo, doing] = [columns[0].id, columns[1].id];
    const a = await addCard(member, board.id, todo, "A");
    const b = await addCard(member, board.id, todo, "B");
    const c = await addCard(member, board.id, todo, "C");
    const move = (card: Card, columnId: string, afterCardId: string | null) => call(member, "POST", `/cards/${card.id}/move`, { columnId, afterCardId });

    let result = await move(c, todo, null);
    expect(result.status).toBe(200);
    expect(result.body.card.position).toBe(512);
    expect(result.body.renormalized).toBeUndefined();
    expect(await order(member, board.id, todo)).toEqual(["C", "A", "B"]);
    result = await move(c, todo, a.id);
    expect(result.body.card.position).toBe(1536);
    expect(await order(member, board.id, todo)).toEqual(["A", "C", "B"]);
    result = await move(a, todo, b.id);
    expect(result.body.card.position).toBe(3072);
    expect(await order(member, board.id, todo)).toEqual(["C", "B", "A"]);
    result = await move(b, doing, null);
    expect(result.body.card).toMatchObject({ column_id: doing, position: 1024, revision: 1 });
    result = await move(c, doing, b.id);
    expect(result.body.card.position).toBe(2048);
    expect(await order(member, board.id, todo)).toEqual(["A"]);
    expect(await order(member, board.id, doing)).toEqual(["B", "C"]);
  });

  test("a stale anchor returns 409 STALE_POSITION with the current order", async () => {
    const { owner, member, board, columns } = await setup("Stale");
    const [todo, doing] = [columns[0].id, columns[1].id];
    const a = await addCard(owner, board.id, todo, "A");
    const b = await addCard(owner, board.id, doing, "B");
    const gone = await addCard(owner, board.id, doing, "Gone");
    expect((await call(owner, "DELETE", `/cards/${gone.id}`)).status).toBe(200);
    for (const afterCardId of [gone.id, a.id, crypto.randomUUID()]) {
      const stale = await call(member, "POST", `/cards/${a.id}/move`, { columnId: doing, afterCardId });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: "STALE_POSITION", columnId: doing, order: [b.id] });
    }
    const self = await call(member, "POST", `/cards/${a.id}/move`, { columnId: todo, afterCardId: a.id });
    expect(self.body.code).toBe("STALE_POSITION");
    const staleCreate = await call(member, "POST", `/boards/${board.id}/cards`, { columnId: todo, title: "X", afterCardId: b.id });
    expect(staleCreate.status).toBe(409);
    expect(staleCreate.body).toMatchObject({ code: "STALE_POSITION", order: [a.id] });
    expect((db.query("SELECT column_id FROM cards WHERE id = ?").get(a.id) as { column_id: string }).column_id).toBe(todo);
  });

  test("renormalises a column when a gap drops below 1e-6", async () => {
    const { owner, board, columns } = await setup("Renorm");
    const todo = columns[0].id;
    const a = await addCard(owner, board.id, todo, "A");
    const b = await addCard(owner, board.id, todo, "B");
    const c = await addCard(owner, board.id, todo, "C", { afterCardId: null });
    db.query("UPDATE cards SET position = ? WHERE id = ?").run(10, a.id);
    db.query("UPDATE cards SET position = ? WHERE id = ?").run(10 + 1e-7, b.id);
    db.query("UPDATE cards SET position = ? WHERE id = ?").run(20, c.id);
    const moved = await call(owner, "POST", `/cards/${c.id}/move`, { columnId: todo, afterCardId: a.id });
    expect(moved.status).toBe(200);
    expect(moved.body.renormalized).toBe(true);
    expect(moved.body.positions).toEqual([{ id: a.id, position: 1024 }, { id: c.id, position: 2048 }, { id: b.id, position: 3072 }]);
    expect(await order(owner, board.id, todo)).toEqual(["A", "C", "B"]);
  });

  test("edits use a revision compare-and-swap", async () => {
    const { owner, member, board, columns } = await setup("Cas");
    const card = await addCard(owner, board.id, columns[0].id, "Draft title");
    const first = await call(member, "PATCH", `/cards/${card.id}`, { title: "Member title", revision: 1 });
    expect(first.status).toBe(200);
    expect(first.body.card).toMatchObject({ title: "Member title", revision: 2 });
    const conflict = await call(owner, "PATCH", `/cards/${card.id}`, { description: "Owner text", revision: 1 });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "CARD_CHANGED", card: { title: "Member title", revision: 2, description: "" } });
    const second = await call(owner, "PATCH", `/cards/${card.id}`, { description: "Owner text", revision: 2 });
    expect(second.body.card).toMatchObject({ title: "Member title", description: "Owner text", revision: 3, has_description: 1 });
    // Moves do not bump the revision, so an open editor keeps working.
    await call(member, "POST", `/cards/${card.id}/move`, { columnId: columns[2].id, afterCardId: null });
    expect((await call(owner, "PATCH", `/cards/${card.id}`, { description: "", revision: 3 })).body.card).toMatchObject({ revision: 4, has_description: 0 });
  });

  test("any reader bins a card; binned cards disappear from the board", async () => {
    const { owner, member, board, columns } = await setup("Bin card");
    const card = await addCard(owner, board.id, columns[0].id, "Soon gone");
    const deleted = await call(member, "DELETE", `/cards/${card.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
    expect(typeof deleted.body.purgeAfter).toBe("string");
    const row = db.query("SELECT deleted_by, column_id FROM cards WHERE id = ?").get(card.id) as Record<string, string>;
    expect(row).toEqual({ deleted_by: member.userId, column_id: columns[0].id });
    for (const [method, path, body] of [["GET", `/cards/${card.id}`], ["PATCH", `/cards/${card.id}`, { title: "x", revision: 1 }], ["POST", `/cards/${card.id}/move`, { columnId: columns[1].id, afterCardId: null }], ["DELETE", `/cards/${card.id}`]] as Array<[string, string, unknown?]>) {
      expect((await call(owner, method, path, body)).status).toBe(404);
    }
    const view = (await call(owner, "GET", `/boards/${board.id}`)).body;
    expect(view.cards).toEqual([]);
    expect(view.board.card_count).toBe(0);
    // Removing a member revokes card access at once.
    const other = await addCard(owner, board.id, columns[0].id, "Still here");
    await call(owner, "PUT", `/boards/${board.id}/sharing`, { visibility: "private", userIds: [] });
    expect((await call(member, "GET", `/cards/${other.id}`)).status).toBe(404);
    expect((await call(member, "PATCH", `/cards/${other.id}`, { title: "x", revision: 1 })).status).toBe(404);
  });

  test("a board holds at most 1000 live cards", async () => {
    const { owner, board, columns } = await setup("Card cap");
    const timestamp = new Date().toISOString();
    const insert = db.query("INSERT INTO cards (id, board_id, column_id, position, title, created_at, updated_at) VALUES (?, ?, ?, ?, 'Filler', ?, ?)");
    db.transaction(() => {
      for (let index = 0; index < 999; index += 1) insert.run(crypto.randomUUID(), board.id, columns[0].id, (index + 1) * 1024, timestamp, timestamp);
    })();
    const last = await addCard(owner, board.id, columns[1].id, "Thousandth");
    const refused = await call(owner, "POST", `/boards/${board.id}/cards`, { columnId: columns[1].id, title: "One too many" });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("LIMIT_REACHED");
    await call(owner, "DELETE", `/cards/${last.id}`);
    expect((await call(owner, "POST", `/boards/${board.id}/cards`, { columnId: columns[1].id, title: "Room again" })).status).toBe(201);
  });

  test("parallel moves in one column stay strictly ordered", async () => {
    const { owner, member, board, columns } = await setup("Parallel");
    const todo = columns[0].id;
    const cards: Card[] = [];
    for (const title of ["A", "B", "C", "D", "E"]) cards.push(await addCard(owner, board.id, todo, title));
    const results = await Promise.all(cards.slice(1).map((card, index) => call(index % 2 ? member : owner, "POST", `/cards/${card.id}/move`, { columnId: todo, afterCardId: cards[0]!.id })));
    expect(results.every((result) => result.status === 200)).toBe(true);
    const positions = (db.query("SELECT position FROM cards WHERE column_id = ? AND deleted_at IS NULL ORDER BY position").all(todo) as Array<{ position: number }>).map((row) => row.position);
    expect(new Set(positions).size).toBe(5);
    expect((await order(owner, board.id, todo))[0]).toBe("A");
  });

  test("audits card changes with ids only", async () => {
    const { owner, board, columns } = await setup("Card audit");
    const card = await addCard(owner, board.id, columns[0].id, "Confidential title", { description: "Confidential body" });
    await call(owner, "PATCH", `/cards/${card.id}`, { title: "Confidential again", revision: 1 });
    await call(owner, "POST", `/cards/${card.id}/move`, { columnId: columns[1].id, afterCardId: null });
    await call(owner, "DELETE", `/cards/${card.id}`);
    const events = db.query("SELECT event_type, metadata_json FROM audit_log WHERE actor_id = ? AND event_type LIKE 'task.card_%' ORDER BY created_at, rowid").all(owner.userId) as Array<{ event_type: string; metadata_json: string }>;
    expect(events.map((event) => event.event_type)).toEqual(["task.card_create", "task.card_update", "task.card_move", "task.card_delete"]);
    for (const event of events) expect(event.metadata_json).not.toContain("Confidential");
    expect(JSON.parse(events[2]!.metadata_json)).toEqual({ boardId: board.id, cardId: card.id, columnId: columns[1].id });
  });
});
