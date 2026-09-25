import { describe, expect, test } from "bun:test";
import { createUser, db, request } from "./support/harness";
import { addRow, call, fieldByName, insertNote, insertRows, newCollection, type Collection, type Row } from "./support/collections";

describe("collections API", () => {
  test("creates from fields, a template, or the default schema, and lists templates", async () => {
    const owner = await createUser("Collector");
    const blank = await newCollection(owner, { name: "  Blank  " });
    expect(blank).toMatchObject({ name: "Blank", role: "owner", is_owner: 1, visibility: "private", share_role: "viewer", schema_version: 1, row_count: 0 });
    expect(blank.fields.map((field) => field.name)).toEqual(["Name", "Notes"]);
    const fromTemplate = await newCollection(owner, { name: "Stuff", templateId: "inventory" });
    expect(fromTemplate.fields[0]).toMatchObject({ name: "Item", type: "text", required: true });
    expect((fromTemplate as unknown as { icon: string }).icon).toBe("package");
    const templates = await call(owner, "GET", "/templates");
    expect(templates.body.templates.map((template: { id: string }) => template.id)).toEqual(["inventory", "subscriptions", "expenses", "recipes", "contacts"]);
    expect((await call(owner, "POST", "", { name: "X", templateId: "nope" })).status).toBe(400);
    expect((await call(owner, "POST", "", { name: "X", templateId: "inventory", fields: [{ name: "A", type: "text" }] })).status).toBe(400);
    const listed = await call(owner, "GET", "");
    expect(listed.body.collections.filter((collection: Collection) => collection.is_owner === 1).map((collection: Collection) => collection.name)).toEqual(["Blank", "Stuff"]);
    expect(listed.body.collections[0].fields).toBeUndefined();
  });

  test("validates schemas strictly, including prototype keys", async () => {
    const owner = await createUser("Schema validator");
    const invalid = async (body: unknown, code = "INVALID_SCHEMA") => {
      const result = await call(owner, "POST", "", body);
      expect(result.status).toBe(400);
      if (code) expect(result.body.code).toBe(code);
    };
    await invalid({ name: "X", fields: Array.from({ length: 51 }, (_, index) => ({ name: `F${index}`, type: "text" })) });
    await invalid({ name: "X", fields: [{ name: "A", type: "text" }, { name: "a", type: "text" }] });
    await invalid({ name: "X", fields: [{ name: "A", type: "number" }] });
    await invalid({ name: "X", fields: [{ id: "f_abcdefgh", name: "A", type: "text" }] });
    await invalid({ name: "X", fields: [{ name: "A", type: "formula" }] });
    await invalid('{"name":"X","fields":[{"name":"A","type":"text","__proto__":{"polluted":true}}]}', "");
    await invalid('{"name":"X","__proto__":{"polluted":true}}', "");
    await invalid({ name: "", fields: [{ name: "A", type: "text" }] }, "");
    await invalid({ name: "X", extra: true }, "");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await call(owner, "POST", "", { name: "X", icon: "../etc" })).status).toBe(400);
  });

  test("strangers get 404 on every collection and row route", async () => {
    const owner = await createUser("Private owner");
    const stranger = await createUser("Nosy stranger");
    const collection = await newCollection(owner);
    const row = await addRow(owner, collection.id, { [collection.fields[0]!.id]: "Secret" });
    const routes: Array<[string, string, unknown?]> = [
      ["GET", `/${collection.id}`],
      ["PATCH", `/${collection.id}`, { name: "Mine" }],
      ["DELETE", `/${collection.id}`],
      ["PUT", `/${collection.id}/schema`, { fields: [{ name: "A", type: "text" }], schemaVersion: 1 }],
      ["POST", `/${collection.id}/query`, {}],
      ["POST", `/${collection.id}/rows`, { values: {} }],
      ["GET", `/rows/${row.id}`],
      ["PATCH", `/rows/${row.id}`, { values: {}, revision: 1 }],
      ["POST", `/rows/${row.id}/undo`, { revision: 1 }],
      ["DELETE", `/rows/${row.id}`]
    ];
    for (const [method, path, body] of routes) {
      const result = await call(stranger, method, path, body);
      expect([path, result.status]).toEqual([path, 404]);
      expect(JSON.stringify(result.body)).not.toContain("Secret");
    }
    expect((await call(stranger, "GET", "")).body.collections.some((item: Collection) => item.id === collection.id)).toBe(false);
    expect((await call(owner, "GET", "/not-a-uuid")).status).toBe(400);
    expect((await call(owner, "GET", `/rows/${crypto.randomUUID()}`)).status).toBe(404);
  });

  test("rows: create at the bottom, top, or after a row; strict values; CAS and one-step undo", async () => {
    const owner = await createUser("Row writer");
    const collection = await newCollection(owner, { name: "Pantry", fields: [{ name: "Item", type: "text", required: true }, { name: "Qty", type: "number" }, { name: "Link", type: "url" }] });
    const item = fieldByName(collection, "Item").id;
    const qty = fieldByName(collection, "Qty").id;
    const link = fieldByName(collection, "Link").id;
    const first = await addRow(owner, collection.id, { [item]: "Rice", [qty]: 2 });
    expect(first).toMatchObject({ title: "Rice", values: { [item]: "Rice", [qty]: 2 }, revision: 1, can_undo: false, position: 1024 });
    const top = await addRow(owner, collection.id, { [item]: "Beans" }, { afterRowId: null });
    const middle = await addRow(owner, collection.id, { [item]: "Lentils" }, { afterRowId: top.id });
    expect(top.position).toBeLessThan(middle.position);
    expect(middle.position).toBeLessThan(first.position);
    expect((await call(owner, "POST", `/${collection.id}/rows`, { values: { [item]: "X" }, afterRowId: crypto.randomUUID() })).status).toBe(404);

    const invalid = await call(owner, "POST", `/${collection.id}/rows`, { values: { [qty]: "two", [link]: "javascript:alert(1)", f_zzzzzzzz: 1 } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_VALUES");
    expect(Object.keys(invalid.body.fieldErrors).sort()).toEqual([item, qty, link, "f_zzzzzzzz"].sort());
    expect((await call(owner, "POST", `/${collection.id}/rows`, `{"values":{"__proto__":{"x":1}}}`)).status).toBe(400);

    const patched = await call(owner, "PATCH", `/rows/${first.id}`, { values: { [qty]: 5, [link]: "https://rice.test" }, revision: 1 });
    expect(patched.status).toBe(200);
    expect(patched.body.row).toMatchObject({ values: { [item]: "Rice", [qty]: 5, [link]: "https://rice.test" }, revision: 2, can_undo: true });
    const stale = await call(owner, "PATCH", `/rows/${first.id}`, { values: { [qty]: 6 }, revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("ROW_CHANGED");
    expect(stale.body.row.values[qty]).toBe(5);
    expect((await call(owner, "PATCH", `/rows/${first.id}`, { values: { [item]: null }, revision: 2 })).body.code).toBe("INVALID_VALUES");

    expect((await call(owner, "POST", `/rows/${first.id}/undo`, { revision: 1 })).body.code).toBe("ROW_CHANGED");
    const undone = await call(owner, "POST", `/rows/${first.id}/undo`, { revision: 2 });
    expect(undone.status).toBe(200);
    expect(undone.body.row).toMatchObject({ values: { [item]: "Rice", [qty]: 2 }, revision: 3, can_undo: false });
    const again = await call(owner, "POST", `/rows/${first.id}/undo`, { revision: 3 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("NOTHING_TO_UNDO");

    expect((await call(owner, "GET", `/rows/${first.id}`)).body).toMatchObject({ role: "owner", schemaVersion: 1, row: { id: first.id } });
    const binned = await call(owner, "DELETE", `/rows/${first.id}`);
    expect(binned.status).toBe(200);
    expect(binned.body.purgeAfter).toBeTruthy();
    expect((await call(owner, "GET", `/rows/${first.id}`)).status).toBe(404);
    expect((await call(owner, "GET", `/${collection.id}`)).body.collection.row_count).toBe(2);
    const events = db.query("SELECT event_type, metadata_json FROM audit_log WHERE actor_id = ? AND event_type LIKE 'collection.%' ORDER BY created_at").all(owner.userId) as Array<{ event_type: string; metadata_json: string }>;
    expect(events.map((event) => event.event_type)).toEqual(expect.arrayContaining(["collection.create", "collection.row_create", "collection.row_update", "collection.row_undo", "collection.row_delete"]));
    // Audit metadata carries ids and counts only, never values.
    expect(events.map((event) => event.metadata_json).join(" ")).not.toMatch(/Rice|rice\.test|Lentils/);
  });

  test("schema changes use a version CAS, refuse incompatible types, and drop removed values lazily", async () => {
    const owner = await createUser("Schema editor");
    const collection = await newCollection(owner, { name: "Links", fields: [{ name: "Name", type: "text" }, { name: "Site", type: "text" }, { name: "Qty", type: "number" }, { name: "Kind", type: "select", options: [{ label: "a" }, { label: "b" }] }] });
    const [name, site, qty, kind] = collection.fields;
    const row = await addRow(owner, collection.id, { [name!.id]: "One", [site!.id]: "not a url", [qty!.id]: 3, [kind!.id]: kind!.options![0]!.id });

    const incompatible = await call(owner, "PUT", `/${collection.id}/schema`, { schemaVersion: 1, fields: [name, site, { ...qty, type: "date" }, kind] });
    expect(incompatible.status).toBe(400);
    expect(incompatible.body.code).toBe("INCOMPATIBLE_TYPE_CHANGE");

    const changed = await call(owner, "PUT", `/${collection.id}/schema`, { schemaVersion: 1, fields: [name, { ...site, type: "url" }, { ...kind, type: "multi_select" }, { name: "Added", type: "checkbox" }] });
    expect(changed.status).toBe(200);
    expect(changed.body.collection.schema_version).toBe(2);
    const stale = await call(owner, "PUT", `/${collection.id}/schema`, { schemaVersion: 1, fields: [name] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("SCHEMA_CHANGED");
    expect(stale.body.collection.schema_version).toBe(2);

    // Lenient reads: the removed number and the non-url text read as empty; select became a list.
    const read = (await call(owner, "GET", `/rows/${row.id}`)).body.row as Row;
    expect(read.values).toEqual({ [name!.id]: "One", [kind!.id]: [kind!.options![0]!.id] });
    // Stored values are untouched until the row's next write, which drops them.
    expect(JSON.parse((db.query("SELECT values_json FROM collection_rows WHERE id = ?").get(row.id) as { values_json: string }).values_json)[qty!.id]).toBe(3);
    const written = await call(owner, "PATCH", `/rows/${row.id}`, { values: { [name!.id]: "Uno" }, revision: 1 });
    expect(written.status).toBe(200);
    const stored = JSON.parse((db.query("SELECT values_json FROM collection_rows WHERE id = ?").get(row.id) as { values_json: string }).values_json);
    expect(stored).toEqual({ [name!.id]: "Uno", [kind!.id]: [kind!.options![0]!.id] });
    // Undo restores the previous values projected onto today's schema: the removed field stays gone.
    const undone = await call(owner, "POST", `/rows/${row.id}/undo`, { revision: 2 });
    expect(undone.body.row.values).toEqual({ [name!.id]: "One", [kind!.id]: [kind!.options![0]!.id] });
  });

  test("query: filters, sorts, q, pages with a cursor bound to the schema version", async () => {
    const owner = await createUser("Querier");
    const collection = await newCollection(owner, { name: "Books", fields: [{ name: "Title", type: "text" }, { name: "Pages", type: "number" }] });
    const [title, pages] = collection.fields;
    for (let index = 1; index <= 7; index += 1) await addRow(owner, collection.id, { [title!.id]: `Book ${index}`, [pages!.id]: index * 100 });
    const filtered = await call(owner, "POST", `/${collection.id}/query`, { filters: [{ fieldId: pages!.id, op: "gte", value: 300 }], sort: [{ fieldId: pages!.id, direction: "desc" }], limit: 2 });
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(5);
    expect(filtered.body.rows.map((row: Row) => row.title)).toEqual(["Book 7", "Book 6"]);
    const second = await call(owner, "POST", `/${collection.id}/query`, { filters: [{ fieldId: pages!.id, op: "gte", value: 300 }], sort: [{ fieldId: pages!.id, direction: "desc" }], limit: 2, cursor: filtered.body.nextCursor });
    expect(second.body.rows.map((row: Row) => row.title)).toEqual(["Book 5", "Book 4"]);
    // A cursor is bound to its spec.
    expect((await call(owner, "POST", `/${collection.id}/query`, { limit: 2, cursor: filtered.body.nextCursor })).body.code).toBe("INVALID_CURSOR");
    expect((await call(owner, "POST", `/${collection.id}/query`, { cursor: "garbage" })).status).toBe(400);
    expect((await call(owner, "POST", `/${collection.id}/query`, { q: "book 3" })).body.rows.map((row: Row) => row.title)).toEqual(["Book 3"]);
    for (const body of [
      { filters: [{ fieldId: "f_zzzzzzzz", op: "empty" }] },
      { filters: [{ fieldId: title!.id, op: "gt", value: 1 }] },
      { filters: [{ fieldId: title!.id, op: "drop table", value: 1 }] },
      { sort: [{ fieldId: `${title!.id}'`, direction: "asc" }] },
      { sort: Array.from({ length: 4 }, () => ({ fieldId: title!.id, direction: "asc" })) },
      { filters: Array.from({ length: 11 }, () => ({ fieldId: title!.id, op: "empty" })) },
      { limit: 101 },
      { extra: 1 }
    ]) {
      expect((await call(owner, "POST", `/${collection.id}/query`, body)).status).toBe(400);
    }
    const fields = collection.fields.map((field) => ({ id: field.id, name: field.name, type: field.type }));
    expect((await call(owner, "PUT", `/${collection.id}/schema`, { schemaVersion: 1, fields: [...fields, { name: "More", type: "text" }] })).status).toBe(200);
    const afterChange = await call(owner, "POST", `/${collection.id}/query`, { filters: [{ fieldId: pages!.id, op: "gte", value: 300 }], sort: [{ fieldId: pages!.id, direction: "desc" }], limit: 2, cursor: filtered.body.nextCursor });
    expect(afterChange.status).toBe(409);
    expect(afterChange.body.code).toBe("SCHEMA_CHANGED");
  });

  test("note links resolve per viewer and only readable notes can be linked", async () => {
    const owner = await createUser("Linker");
    const other = await createUser("Note keeper");
    const collection = await newCollection(owner, { name: "Reading", fields: [{ name: "Name", type: "text" }, { name: "Note", type: "note" }] });
    const [name, note] = collection.fields;
    const mine = insertNote(owner.userId, "My note");
    const theirs = insertNote(other.userId, "Private note of theirs");
    const binnedNote = insertNote(owner.userId, "Binned note", { deleted: true });
    expect((await call(owner, "POST", `/${collection.id}/rows`, { values: { [name!.id]: "x", [note!.id]: theirs } })).body.fieldErrors?.[note!.id]).toBeTruthy();
    expect((await call(owner, "POST", `/${collection.id}/rows`, { values: { [name!.id]: "x", [note!.id]: binnedNote } })).status).toBe(400);
    const row = await addRow(owner, collection.id, { [name!.id]: "x", [note!.id]: mine });
    expect(row.links[note!.id]).toEqual({ id: mine, title: "My note" });
    // Once the note is binned, the link stays but its title is withheld.
    db.query("UPDATE notes SET deleted_at = ?, purge_after = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), mine);
    expect((await call(owner, "GET", `/rows/${row.id}`)).body.row.links[note!.id]).toEqual({ id: mine, restricted: true });
  });

  test("undo re-checks required fields and note readability for the values it restores", async () => {
    const owner = await createUser("Undo checker");
    const collection = await newCollection(owner, { name: "Undo rules", fields: [{ name: "Name", type: "text" }, { name: "Qty", type: "number" }, { name: "Note", type: "note" }] });
    const [name, qty, note] = collection.fields;

    // Qty was empty before the edit; after Qty becomes required, undoing to the empty value is refused.
    const row = await addRow(owner, collection.id, { [name!.id]: "Rice" });
    expect((await call(owner, "PATCH", `/rows/${row.id}`, { values: { [qty!.id]: 3 }, revision: 1 })).status).toBe(200);
    const fields = collection.fields.map((field) => ({ id: field.id, name: field.name, type: field.type, ...(field.id === qty!.id ? { required: true } : {}) }));
    expect((await call(owner, "PUT", `/${collection.id}/schema`, { schemaVersion: 1, fields })).status).toBe(200);
    const refused = await call(owner, "POST", `/rows/${row.id}/undo`, { revision: 2 });
    expect([refused.status, refused.body.code]).toEqual([400, "INVALID_VALUES"]);
    expect(refused.body.fieldErrors[qty!.id]).toBe("This field is required");
    expect((await call(owner, "GET", `/rows/${row.id}`)).body.row).toMatchObject({ values: { [qty!.id]: 3 }, revision: 2, can_undo: true });

    // A note linked before the edit that the caller can no longer read is not linked again by undo.
    const linked = insertNote(owner.userId, "Soon binned");
    const other = await addRow(owner, collection.id, { [name!.id]: "Beans", [qty!.id]: 1, [note!.id]: linked });
    expect((await call(owner, "PATCH", `/rows/${other.id}`, { values: { [note!.id]: null }, revision: 1 })).status).toBe(200);
    db.query("UPDATE notes SET deleted_at = ?, purge_after = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), linked);
    const unreadable = await call(owner, "POST", `/rows/${other.id}/undo`, { revision: 2 });
    expect([unreadable.status, unreadable.body.code]).toEqual([400, "INVALID_VALUES"]);
    expect(unreadable.body.fieldErrors[note!.id]).toBe("You can't link this note");
    // Once the note is readable again, the same undo goes through.
    db.query("UPDATE notes SET deleted_at = NULL, purge_after = NULL WHERE id = ?").run(linked);
    const undone = await call(owner, "POST", `/rows/${other.id}/undo`, { revision: 2 });
    expect(undone.status).toBe(200);
    expect(undone.body.row.values[note!.id]).toBe(linked);
  });

  test("caps: 100 collections per owner and 10,000 live rows per collection", async () => {
    const owner = await createUser("Hoarder");
    const timestamp = new Date().toISOString();
    const insert = db.query("INSERT INTO collections (id, owner_id, name, schema_json, created_at, updated_at) VALUES (?, ?, 'Filler', ?, ?, ?)");
    for (let index = 0; index < 99; index += 1) insert.run(crypto.randomUUID(), owner.userId, JSON.stringify({ fields: [{ id: "f_aaaaaaaa", name: "Name", type: "text" }] }), timestamp, timestamp);
    const last = await newCollection(owner, { name: "Hundredth" });
    const over = await call(owner, "POST", "", { name: "One too many" });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("LIMIT_REACHED");
    insertRows(last.id, 9_999);
    await addRow(owner, last.id, { [last.fields[0]!.id]: "10,000th" });
    const full = await call(owner, "POST", `/${last.id}/rows`, { values: { [last.fields[0]!.id]: "Overflow" } });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("LIMIT_REACHED");
  });

  test("JSON-only, CSRF, and Origin rules apply", async () => {
    const owner = await createUser("Careful");
    const noCsrf = await request("/collections", { method: "POST", body: JSON.stringify({ name: "X" }), headers: { "X-CSRF-Token": "wrong" } }, owner);
    expect(noCsrf.status).toBe(403);
    const form = await request("/collections", { method: "POST", body: "name=X", headers: { "Content-Type": "application/x-www-form-urlencoded" } }, owner);
    expect(form.status).toBe(415);
    const badOrigin = await request("/collections", { method: "POST", body: JSON.stringify({ name: "X" }), headers: { Origin: "https://evil.example" } }, owner);
    expect(badOrigin.status).toBe(403);
  });
});
