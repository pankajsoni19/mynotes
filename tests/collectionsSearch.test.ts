import { beforeEach, describe, expect, test } from "bun:test";
import { createUser, db, request, type Session } from "./support/harness";
import { addRow, call, insertNote, newCollection, shareCollection } from "./support/collections";

const { resetSearchRateLimit } = await import("../server/searchRoutes");
const { reconcileCollectionSearchIndex, rowSearchText } = await import("../server/collections/search");
const { buildSchema } = await import("../server/collections/schema");

type Hit = { rowId: string; collectionId: string; collectionName: string; title: Array<{ text: string; hit: boolean }>; snippet: Array<{ text: string; hit: boolean }> };

async function search(session: Session, q: string, extra = "") {
  const response = await request(`/search?scope=collections&q=${encodeURIComponent(q)}${extra}`, {}, session);
  const body = await response.json() as { results?: Hit[]; truncated?: boolean };
  return { status: response.status, hits: body.results ?? [], truncated: body.truncated };
}
const text = (segments: Hit["title"]) => segments.map((segment) => segment.text).join("");
const ftsParity = () => {
  const fts = (db.query("SELECT COUNT(*) AS count FROM collection_row_fts").get() as { count: number }).count;
  const mapping = (db.query("SELECT COUNT(*) AS count FROM collection_row_search").get() as { count: number }).count;
  return fts === mapping;
};

beforeEach(() => resetSearchRateLimit());

describe("collection row search", () => {
  test("indexes the primary field as the title and other values, labels included, as the body; never note titles", () => {
    const schema = buildSchema([
      { name: "Name", type: "text" },
      { name: "Kind", type: "select", options: [{ label: "Kitchenware" }] },
      { name: "Tags", type: "multi_select", options: [{ label: "fragile" }, { label: "heavy" }] },
      { name: "Price", type: "number" },
      { name: "Bought", type: "date" },
      { name: "Link", type: "url" },
      { name: "Note", type: "note" },
      { name: "Files", type: "file" }
    ]);
    const [name, kind, tags, price, bought, link, note] = schema.fields;
    const values = { [name!.id]: "Teapot\u0002x", [kind!.id]: kind!.options![0]!.id, [tags!.id]: tags!.options!.map((option) => option.id), [price!.id]: 12.5, [bought!.id]: "2024-05-01", [link!.id]: "https://shop.test/teapot", [note!.id]: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" };
    expect(rowSearchText(schema, values)).toEqual({ title: "Teapotx", body: "Kitchenware\nfragile heavy\n12.5\n2024-05-01\nhttps://shop.test/teapot" });
  });

  test("finds readable rows only, with the ACL applied before the limit, and follows unsharing and the Bin", async () => {
    const owner = await createUser("Search owner");
    const reader = await createUser("Search reader");
    const stranger = await createUser("Search stranger");
    const mine = await newCollection(owner, { name: "Pantry", fields: [{ name: "Item", type: "text" }, { name: "Where", type: "select", options: [{ label: "Cupboard" }] }, { name: "Note", type: "note" }] });
    const [item, where, noteField] = mine.fields;
    const secretNote = insertNote(owner.userId, "Zanzibar spice secret");
    const saffron = await addRow(owner, mine.id, { [item!.id]: "Zanzibar saffron", [where!.id]: where!.options![0]!.id, [noteField!.id]: secretNote });
    await addRow(owner, mine.id, { [item!.id]: "Zanzibar cloves" });
    // Many matches in a collection the reader cannot see must not crowd out their own hits.
    const hidden = await newCollection(stranger, { name: "Hidden", fields: [{ name: "Item", type: "text" }] });
    for (let index = 0; index < 30; index += 1) await addRow(stranger, hidden.id, { [hidden.fields[0]!.id]: `Zanzibar ${index}` });

    expect((await search(reader, "zanzibar")).hits).toEqual([]);
    await shareCollection(owner, mine.id, "selected", [reader.userId], "viewer");
    const found = await search(reader, "zanzibar", "&limit=2");
    expect(found.status).toBe(200);
    expect(found.hits.map((hit) => text(hit.title)).sort()).toEqual(["Zanzibar cloves", "Zanzibar saffron"]);
    expect(found.hits.every((hit) => hit.collectionName === "Pantry" && hit.collectionId === mine.id)).toBe(true);
    expect(found.hits[0]!.title.some((segment) => segment.hit)).toBe(true);
    // Option labels are searchable; note titles never are.
    expect((await search(reader, "cupboard")).hits.map((hit) => hit.rowId)).toEqual([saffron.id]);
    expect((await search(owner, "spice")).hits).toEqual([]);
    // Filter to one collection; bad ids are 400.
    expect((await search(stranger, "zanzibar", `&collection=${mine.id}`)).hits).toEqual([]);
    expect((await search(stranger, "zanzibar", `&collection=${hidden.id}&limit=50`)).hits).toHaveLength(30);
    expect((await search(reader, "zanzibar", "&collection=nope")).status).toBe(400);

    // A binned row drops out and comes back on restore; unsharing removes every hit.
    await call(owner, "DELETE", `/rows/${saffron.id}`);
    expect((await search(reader, "saffron")).hits).toEqual([]);
    expect((await request(`/bin/collection_row/${saffron.id}/restore`, { method: "POST", body: "{}" }, owner)).status).toBe(200);
    expect((await search(reader, "saffron")).hits).toHaveLength(1);
    await shareCollection(owner, mine.id, "private");
    expect((await search(reader, "zanzibar")).hits).toEqual([]);
    expect(ftsParity()).toBe(true);
  });

  test("row writes, undo, and schema changes keep the index in step", async () => {
    const owner = await createUser("Index owner");
    const collection = await newCollection(owner, { name: "Plants", fields: [{ name: "Name", type: "text" }, { name: "Spot", type: "select", options: [{ label: "Windowsill" }] }] });
    const [name, spot] = collection.fields;
    const row = await addRow(owner, collection.id, { [name!.id]: "Basil", [spot!.id]: spot!.options![0]!.id });
    expect((await search(owner, "basil")).hits).toHaveLength(1);
    await call(owner, "PATCH", `/rows/${row.id}`, { values: { [name!.id]: "Mint" }, revision: 1 });
    expect((await search(owner, "basil")).hits).toEqual([]);
    expect((await search(owner, "mint")).hits).toHaveLength(1);
    await call(owner, "POST", `/rows/${row.id}/undo`, { revision: 2 });
    expect((await search(owner, "basil")).hits).toHaveLength(1);
    // Renaming an option reindexes the collection in the schema transaction.
    const fields = [{ id: name!.id, name: "Name", type: "text" }, { id: spot!.id, name: "Spot", type: "select", options: [{ id: spot!.options![0]!.id, label: "Balcony" }] }];
    expect((await call(owner, "PUT", `/${collection.id}/schema`, { schemaVersion: 1, fields })).status).toBe(200);
    expect((await search(owner, "windowsill")).hits).toEqual([]);
    expect((await search(owner, "balcony")).hits).toHaveLength(1);
    const mapping = db.query("SELECT source_revision, schema_version FROM collection_row_search WHERE row_id = ?").get(row.id);
    expect(mapping).toEqual({ source_revision: 3, schema_version: 2 });
  });

  test("boot reconcile rebuilds missing and stale entries and removes orphans", async () => {
    const owner = await createUser("Reconcile owner");
    const collection = await newCollection(owner, { name: "Tools", fields: [{ name: "Name", type: "text" }] });
    const hammer = await addRow(owner, collection.id, { [collection.fields[0]!.id]: "Hammer" });
    const saw = await addRow(owner, collection.id, { [collection.fields[0]!.id]: "Saw" });
    db.query("DELETE FROM collection_row_search WHERE row_id = ?").run(hammer.id);
    db.query("UPDATE collection_rows SET values_json = ?, revision = revision + 1 WHERE id = ?").run(JSON.stringify({ [collection.fields[0]!.id]: "Chisel" }), saw.id);
    db.query("INSERT INTO collection_row_fts (rowid, title, body) VALUES (987654321, 'orphan', '')").run();
    const counts = reconcileCollectionSearchIndex();
    expect(counts.indexed).toBeGreaterThanOrEqual(2);
    expect(counts.removed).toBeGreaterThanOrEqual(1);
    expect((await search(owner, "hammer")).hits).toHaveLength(1);
    expect((await search(owner, "chisel")).hits).toHaveLength(1);
    expect((await search(owner, "saw")).hits).toEqual([]);
    expect((await search(owner, "orphan")).hits).toEqual([]);
    expect(ftsParity()).toBe(true);
    expect(reconcileCollectionSearchIndex().indexed).toBe(0);
  });
});
