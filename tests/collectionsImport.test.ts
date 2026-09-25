import { beforeEach, describe, expect, test } from "bun:test";
import { createUser, db, request, type Session } from "./support/harness";
import { addRow, call, insertNote, insertRows, newCollection, shareCollection, type Collection, type Row } from "./support/collections";

const { resetImportRateLimit } = await import("../server/collections/importExport");
const { parseCsv } = await import("../server/collections/csv");

beforeEach(() => resetImportRateLimit());

const liveRows = (collectionId: string) => (db.query("SELECT COUNT(*) AS count FROM collection_rows WHERE collection_id = ? AND deleted_at IS NULL").get(collectionId) as { count: number }).count;

async function pantry(owner: Session) {
  return newCollection(owner, { name: "Pantry", fields: [
    { name: "Item", type: "text", required: true },
    { name: "Qty", type: "number" },
    { name: "Best before", type: "date" },
    { name: "Opened", type: "checkbox" },
    { name: "Shelf", type: "select", options: [{ label: "Top" }, { label: "Bottom" }] },
    { name: "Tags", type: "multi_select", options: [{ label: "Vegan" }, { label: "Spicy" }] },
    { name: "Scan", type: "file" }
  ] });
}

async function exportCsv(session: Session, collectionId: string, viewId?: string) {
  const response = await request(`/collections/${collectionId}/export.csv${viewId ? `?viewId=${viewId}` : ""}`, {}, session);
  // Decode with ignoreBOM so the BOM the server wrote stays visible to the assertions.
  const text = response.status === 200 ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer()) : "";
  return { status: response.status, headers: response.headers, text };
}

describe("CSV import", () => {
  test("a dry run maps headers by name, previews rows, and lists errors without writing", async () => {
    const owner = await createUser("Import owner");
    const collection = await pantry(owner);
    const [item, qty, best, opened, shelf, tags] = collection.fields;
    const csv = "﻿Item,qty,Best before,Opened,Shelf,Tags,Ignored\r\nRice,2,2026-01-31,yes,top,Vegan; spicy,x\r\nBeans,,,,Bottom,,\r\n,3,,no,,,\r\nChili,many,2026-02-30,maybe,Middle,Sweet,\r\n";
    const dry = await call(owner, "POST", `/${collection.id}/import`, { csv, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, total: 4, valid: 2, errorCount: 6, mapping: [item!.id, qty!.id, best!.id, opened!.id, shelf!.id, tags!.id, null] });
    expect(dry.body.preview[0]).toEqual({ [item!.id]: "Rice", [qty!.id]: 2, [best!.id]: "2026-01-31", [opened!.id]: true, [shelf!.id]: shelf!.options![0]!.id, [tags!.id]: tags!.options!.map((option) => option.id) });
    expect(dry.body.errors.map((error: { row: number; fieldId: string | null }) => [error.row, error.fieldId])).toEqual([
      [3, item!.id], [4, qty!.id], [4, best!.id], [4, opened!.id], [4, shelf!.id], [4, tags!.id]
    ]);
    expect(liveRows(collection.id)).toBe(0);

    // All or nothing: with any error, nothing is imported.
    const refused = await call(owner, "POST", `/${collection.id}/import`, { csv, dryRun: false });
    expect([refused.status, refused.body.code, refused.body.errorCount]).toEqual([400, "IMPORT_INVALID", 6]);
    expect(liveRows(collection.id)).toBe(0);

    const good = "Item,Qty,Shelf\nRice,2,Top\nBeans,1,Bottom\n\"Oats, rolled\",3,\n";
    const imported = await call(owner, "POST", `/${collection.id}/import`, { csv: good, dryRun: false });
    expect(imported.status).toBe(200);
    expect(imported.body).toEqual({ inserted: 3 });
    const rows = (await call(owner, "POST", `/${collection.id}/query`, {})).body.rows as Row[];
    expect(rows.map((row) => row.title)).toEqual(["Rice", "Beans", "Oats, rolled"]);
    const audits = db.query("SELECT metadata_json FROM audit_log WHERE event_type = 'collection.import' AND actor_id = ?").all(owner.userId) as Array<{ metadata_json: string }>;
    expect(JSON.parse(audits[0]!.metadata_json)).toEqual({ collectionId: collection.id, count: 3 });
  });

  test("explicit mappings are validated; files cannot be imported", async () => {
    const owner = await createUser("Mapping owner");
    const collection = await pantry(owner);
    const [item, qty, , , , , scan] = collection.fields;
    const csv = "A,B\nTea,4\n";
    const mapped = await call(owner, "POST", `/${collection.id}/import`, { csv, mapping: [item!.id, qty!.id], dryRun: true });
    expect(mapped.body.preview).toEqual([{ [item!.id]: "Tea", [qty!.id]: 4 }]);
    for (const mapping of [[item!.id], [item!.id, item!.id], [item!.id, "f_zzzzzzzz"], [item!.id, scan!.id], [null, null]]) {
      resetImportRateLimit();
      const result = await call(owner, "POST", `/${collection.id}/import`, { csv, mapping, dryRun: true });
      expect([JSON.stringify(mapping), result.status, result.body.code]).toEqual([JSON.stringify(mapping), 400, "INVALID_MAPPING"]);
    }
    expect((await call(owner, "POST", `/${collection.id}/import`, { csv: 'A\n"open', dryRun: true })).body.code).toBe("INVALID_CSV");
    expect((await call(owner, "POST", `/${collection.id}/import`, { csv: "", dryRun: true })).body.code).toBe("INVALID_CSV");
    expect((await call(owner, "POST", `/${collection.id}/import`, `{"csv":"a","dryRun":true,"__proto__":{"x":1}}`)).status).toBe(400);
  });

  test("roles, size, row, column, cap, and rate limits", async () => {
    const owner = await createUser("Limit owner");
    const viewer = await createUser("Limit viewer");
    const stranger = await createUser("Limit stranger");
    const collection = await newCollection(owner, { name: "Big", fields: [{ name: "Name", type: "text" }] });
    await shareCollection(owner, collection.id, "selected", [viewer.userId], "viewer");
    expect((await call(viewer, "POST", `/${collection.id}/import`, { csv: "Name\nx", dryRun: true })).body.code).toBe("READ_ONLY");
    expect((await call(stranger, "POST", `/${collection.id}/import`, { csv: "Name\nx", dryRun: true })).status).toBe(404);

    const tooBig = await call(owner, "POST", `/${collection.id}/import`, { csv: `Name\n${"x".repeat(2_000_001)}`, dryRun: true });
    expect([tooBig.status, tooBig.body.code]).toEqual([413, "IMPORT_TOO_LARGE"]);
    const tooMany = await call(owner, "POST", `/${collection.id}/import`, { csv: `Name\n${Array.from({ length: 5001 }, (_, index) => `r${index}`).join("\n")}`, dryRun: true });
    expect([tooMany.status, tooMany.body.code]).toEqual([400, "INVALID_CSV"]);
    const wide = await call(owner, "POST", `/${collection.id}/import`, { csv: Array.from({ length: 51 }, (_, index) => `c${index}`).join(","), dryRun: true });
    expect(wide.body.code).toBe("INVALID_CSV");

    resetImportRateLimit();
    const fiveThousand = `Name\n${Array.from({ length: 5000 }, (_, index) => `r${index}`).join("\n")}`;
    insertRows(collection.id, 5001);
    const capped = await call(owner, "POST", `/${collection.id}/import`, { csv: fiveThousand, dryRun: false });
    expect([capped.status, capped.body.code]).toEqual([409, "LIMIT_REACHED"]);
    expect(liveRows(collection.id)).toBe(5001);
    db.query("DELETE FROM collection_rows WHERE collection_id = ?").run(collection.id);
    expect((await call(owner, "POST", `/${collection.id}/import`, { csv: fiveThousand, dryRun: false })).body).toEqual({ inserted: 5000 });

    resetImportRateLimit();
    for (let index = 0; index < 5; index += 1) expect((await call(owner, "POST", `/${collection.id}/import`, { csv: "Name\nx", dryRun: true })).status).toBe(200);
    const limited = await call(owner, "POST", `/${collection.id}/import`, { csv: "Name\nx", dryRun: true });
    expect([limited.status, limited.body.code]).toEqual([429, "RATE_LIMITED"]);
  });
});

describe("CSV export", () => {
  test("exports a UTF-8 BOM, neutralizes formulas in text only, and round-trips through import", async () => {
    const owner = await createUser("Export owner");
    const reader = await createUser("Export reader");
    const collection = await newCollection(owner, { name: "Ledger =risky", fields: [
      { name: "=Name", type: "text" },
      { name: "Amount", type: "number" },
      { name: "Kind", type: "select", options: [{ label: "+plus" }] },
      { name: "Note", type: "note" },
      { name: "Link", type: "url" }
    ] });
    const [name, amount, kind, note] = collection.fields;
    const privateNote = insertNote(owner.userId, "Owner's private note");
    await addRow(owner, collection.id, { [name!.id]: "=HYPERLINK(\"http://evil.test\")", [amount!.id]: -5, [kind!.id]: kind!.options![0]!.id, [note!.id]: privateNote });
    await addRow(owner, collection.id, { [name!.id]: "@SUM(1)" });
    await addRow(owner, collection.id, { [name!.id]: "Plain, with comma" });

    const exported = await exportCsv(owner, collection.id);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(exported.headers.get("content-disposition")).toContain("attachment;");
    expect(exported.headers.get("cache-control")).toContain("no-store");
    expect(exported.text.startsWith("﻿")).toBe(true);
    const records = parseCsv(exported.text, { maxRecords: 100, maxColumns: 50 });
    expect(records[0]).toEqual(["'=Name", "Amount", "Kind", "Note", "Link"]);
    expect(records[1]).toEqual(["'=HYPERLINK(\"http://evil.test\")", "-5", "'+plus", "Owner's private note", ""]);
    expect(records[2]![0]).toBe("'@SUM(1)");
    expect(records[3]![0]).toBe("Plain, with comma");

    // Another reader never sees the title of a note they cannot read.
    await shareCollection(owner, collection.id, "all_users");
    const forReader = parseCsv((await exportCsv(reader, collection.id)).text, { maxRecords: 100, maxColumns: 50 });
    expect(forReader[1]![3]).toBe("");
    expect((await exportCsv(await createUser("Export stranger"), collection.id)).status).toBe(200);
    await shareCollection(owner, collection.id, "private");
    expect((await exportCsv(reader, collection.id)).status).toBe(404);

    // Importing the export into a fresh copy restores the neutralized text.
    const copy = await newCollection(owner, { name: "Copy", fields: [{ name: "=Name", type: "text" }, { name: "Amount", type: "number" }, { name: "Kind", type: "select", options: [{ label: "+plus" }] }] });
    const imported = await call(owner, "POST", `/${copy.id}/import`, { csv: exported.text, dryRun: false });
    expect(imported.body).toEqual({ inserted: 3 });
    const rows = (await call(owner, "POST", `/${copy.id}/query`, {})).body.rows as Row[];
    expect(rows.map((row) => row.title)).toEqual(["=HYPERLINK(\"http://evil.test\")", "@SUM(1)", "Plain, with comma"]);
    expect(rows[0]!.values[copy.fields[1]!.id]).toBe(-5);
  });

  test("an export is exactly the rows the view's query returns, in order, with its fields", async () => {
    const owner = await createUser("Export view owner");
    const collection = await newCollection(owner, { name: "Books", fields: [{ name: "Title", type: "text" }, { name: "Pages", type: "number" }, { name: "Secret", type: "text" }] });
    const [title, pages, secret] = collection.fields as Collection["fields"];
    for (const [name, count] of [["A", 100], ["B", 400], ["C", 250], ["D", 50]] as const) await addRow(owner, collection.id, { [title!.id]: name, [pages!.id]: count, [secret!.id]: "hidden text" });
    const view = (await call(owner, "POST", `/${collection.id}/views`, { name: "Long", config: { filters: [{ fieldId: pages!.id, op: "gte", value: 100 }], sort: [{ fieldId: pages!.id, direction: "desc" }], hiddenFieldIds: [secret!.id] } })).body.view;
    const queried = ((await call(owner, "POST", `/${collection.id}/query`, { viewId: view.id })).body.rows as Row[]).map((row) => row.title);
    const records = parseCsv((await exportCsv(owner, collection.id, view.id)).text, { maxRecords: 100, maxColumns: 50 });
    expect(records[0]).toEqual(["Title", "Pages"]);
    expect(records.slice(1).map((record) => record[0])).toEqual(queried);
    expect(queried).toEqual(["B", "C", "A"]);
    expect(records.flat().join(" ")).not.toContain("hidden text");
    const other = await newCollection(owner, { name: "Other" });
    expect((await exportCsv(owner, other.id, view.id)).status).toBe(404);
    expect((await exportCsv(owner, collection.id, "not-a-uuid")).status).toBe(400);
  });
});
