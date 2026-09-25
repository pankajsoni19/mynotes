import { expect } from "bun:test";
import { db, request, type Session } from "./harness";

/** Shared helpers for the Collections API tests. */
export type Field = { id: string; name: string; type: string; options?: Array<{ id: string; label: string }> };
export type Collection = { id: string; name: string; role: string; schema_version: number; fields: Field[]; row_count: number; is_owner: number; visibility: string; share_role: string };
export type Row = { id: string; title: string; values: Record<string, unknown>; links: Record<string, unknown>; revision: number; can_undo: boolean; position: number; files?: Record<string, Array<{ id: string; name: string }>> };

export async function call(session: Session | undefined, method: string, path: string, body?: unknown) {
  const response = await request(`/collections${path}`, method === "GET" ? {} : { method, body: typeof body === "string" ? body : JSON.stringify(body ?? {}) }, session);
  const text = await response.text();
  let parsed: Record<string, any> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

export async function newCollection(owner: Session, body: Record<string, unknown> = { name: "Things", fields: [{ name: "Name", type: "text" }, { name: "Qty", type: "number" }] }) {
  const created = await call(owner, "POST", "", body);
  expect(created.status).toBe(201);
  return created.body.collection as Collection;
}

export async function addRow(session: Session, collectionId: string, values: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const created = await call(session, "POST", `/${collectionId}/rows`, { values, ...extra });
  expect(created.status).toBe(201);
  return created.body.row as Row;
}

export async function shareCollection(owner: Session, collectionId: string, visibility: string, userIds: string[] = [], role = "viewer") {
  const result = await call(owner, "PUT", `/${collectionId}/sharing`, { visibility, userIds, role });
  expect(result.status).toBe(200);
}

export const fieldByName = (collection: Collection, name: string) => collection.fields.find((field) => field.name === name)!;

/** Inserts a published note straight into the database (collections only need the row for ACL checks). */
export function insertNote(ownerId: string, title: string, options: { visibility?: "private" | "all_users"; deleted?: boolean } = {}) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  db.query(`INSERT INTO notes (id, owner_id, folder_id, title, visibility, sharing_override, current_version, created_at, updated_at, deleted_at, purge_after)
    VALUES (?, ?, NULL, ?, ?, 1, 1, ?, ?, ?, ?)`).run(id, ownerId, title, options.visibility ?? "private", timestamp, timestamp, options.deleted ? timestamp : null, options.deleted ? timestamp : null);
  return id;
}

/** Bulk-inserts live rows without going through the API (for caps). */
export function insertRows(collectionId: string, count: number, values: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString();
  const statement = db.query("INSERT INTO collection_rows (id, collection_id, position, values_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  db.transaction(() => {
    for (let index = 0; index < count; index += 1) statement.run(crypto.randomUUID(), collectionId, 1_000_000 + index, JSON.stringify(values), timestamp, timestamp);
  })();
}
