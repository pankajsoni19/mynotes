import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppHome } from "../src/AppShell";
import { CellEditor } from "../src/collections/cells";
import { CollectionList } from "../src/collections/CollectionList";
import type { CollectionRow, FieldDefinition } from "../src/collections/collectionsApi";
import { fromDrafts, moveDraft, newFieldDraft, toDrafts, typeChoices, validateDrafts } from "../src/collections/fieldDrafts";
import { allowedTypeChanges, cardFields, displayValue, parseInput, validateCollectionName } from "../src/collections/values";

const account = { displayName: "Ada Lovelace", onSettings: () => undefined, onSignOut: () => undefined };
const fields: FieldDefinition[] = [
  { id: "f_aaaaaaaa", name: "Name", type: "text", required: true },
  { id: "f_bbbbbbbb", name: "Price", type: "number", number: { decimals: 2, unit: "EUR" } },
  { id: "f_cccccccc", name: "When", type: "date" },
  { id: "f_dddddddd", name: "Kind", type: "select", options: [{ id: "o_aaaaaa", label: "Book", color: "blue" }] },
  { id: "f_eeeeeeee", name: "Tags", type: "multi_select", options: [{ id: "o_bbbbbb", label: "x", color: "gray" }, { id: "o_cccccc", label: "y", color: "red" }] },
  { id: "f_ffffffff", name: "Note", type: "note" },
  { id: "f_gggggggg", name: "Site", type: "url" },
  { id: "f_hhhhhhhh", name: "Done", type: "checkbox" }
];
const row = (values: CollectionRow["values"], links: CollectionRow["links"] = {}): CollectionRow => ({
  id: "r", collection_id: "c", position: 1, title: String(values.f_aaaaaaaa ?? ""), values, links, revision: 1, can_undo: false,
  created_by: null, created_by_name: null, updated_by_name: null, updated_via_key_id: null, created_at: "", updated_at: ""
});

test("Home has a live Collections card", () => {
  const markup = renderToStaticMarkup(<AppHome {...account} onOpen={() => undefined} />);
  const card = markup.match(/<button class="app-card app-card-collections">(.*?)<\/button>/)?.[1] ?? "";
  expect(card).toContain("<strong>Collections</strong>");
  expect(card).toContain("Track anything in typed tables");
  expect(card).toContain("Open Collections");
});

test("the collection list starts with its loading state and a New collection action", () => {
  const markup = renderToStaticMarkup(<CollectionList onOpen={() => undefined} onOpenRow={() => undefined} notify={() => undefined} />);
  expect(markup).toContain("Loading collections…");
  expect(markup).toContain(">New collection</button>");
  expect(markup).toContain('<h1 id="collections-title">Collections</h1>');
});

test("values display per type and parse the way the server validates them", () => {
  const sample = row({ f_aaaaaaaa: "Mug", f_bbbbbbbb: 3.5, f_cccccccc: "2024-02-29", f_dddddddd: "o_aaaaaa", f_eeeeeeee: ["o_cccccc", "o_bbbbbb"], f_ffffffff: "n", f_gggggggg: "https://example.test/", f_hhhhhhhh: true }, { f_ffffffff: { id: "n", restricted: true } });
  expect(displayValue(fields[1]!, sample, "en-US")).toBe("3.50 EUR");
  expect(displayValue(fields[2]!, sample, "en-US")).toBe("Feb 29, 2024");
  expect(displayValue(fields[3]!, sample)).toBe("Book");
  expect(displayValue(fields[4]!, sample)).toBe("y, x");
  expect(displayValue(fields[5]!, sample)).toBe("Restricted note");
  expect(displayValue(fields[6]!, sample)).toBe("example.test");
  expect(displayValue(fields[7]!, sample)).toBe("Yes");
  expect(cardFields(fields, sample).map((field) => field.name)).toEqual(["Price", "When", "Kind"]);
  expect(cardFields(fields, row({ f_aaaaaaaa: "only", f_hhhhhhhh: true })).map((field) => field.name)).toEqual(["Done"]);
  expect(parseInput(fields[1]!, " 1,200.5 ")).toEqual({ ok: true, value: 1200.5 });
  expect(parseInput(fields[1]!, "12abc").ok).toBe(false);
  expect(parseInput(fields[1]!, "")).toEqual({ ok: true, value: null });
  expect(parseInput(fields[2]!, "2023-02-29").ok).toBe(false);
  expect(parseInput(fields[6]!, "javascript:alert(1)").ok).toBe(false);
  expect(validateCollectionName("  Pantry ")).toEqual({ ok: true, name: "Pantry", changed: true });
  expect(validateCollectionName("x".repeat(121)).ok).toBe(false);
  expect(allowedTypeChanges("select")).toEqual(["select", "multi_select"]);
  expect(allowedTypeChanges("number")).toEqual(["number"]);
});

test("viewers get read-only cells and editors get inputs", () => {
  const sample = row({ f_aaaaaaaa: "Mug", f_dddddddd: "o_aaaaaa" });
  const readOnly = renderToStaticMarkup(<CellEditor field={fields[0]!} row={sample} editable={false} onSave={async () => true} onOpenPicker={() => undefined} />);
  expect(readOnly).not.toContain("<input");
  expect(readOnly).toContain("Mug");
  const editable = renderToStaticMarkup(<CellEditor field={fields[0]!} row={sample} editable onSave={async () => true} onOpenPicker={() => undefined} />);
  expect(editable).toContain('<input class="cell-input cell-text"');
  const select = renderToStaticMarkup(<CellEditor field={fields[3]!} row={sample} editable onSave={async () => true} onOpenPicker={() => undefined} />);
  expect(select).toContain("<select");
  // Multi-line text is edited in the row panel, never in a single-line input that drops line breaks.
  const multiline = renderToStaticMarkup(<CellEditor field={fields[0]!} row={row({ f_aaaaaaaa: "a\nb" })} editable onSave={async () => true} onOpenPicker={() => undefined} />);
  expect(multiline).not.toContain("<input");
});

test("field drafts mirror the schema rules and build the PUT body", () => {
  const drafts = toDrafts(fields);
  expect(validateDrafts(drafts)).toBeNull();
  expect(typeChoices(drafts[0]!, ["text", "number"])).toEqual(["text", "url"]);
  expect(typeChoices(newFieldDraft(), ["text", "number"])).toEqual(["text", "number"]);
  expect(validateDrafts(moveDraft(drafts, 1, -1))).toContain("first field");
  expect(validateDrafts([...drafts, { ...newFieldDraft(), name: "name" }])).toContain("Two fields");
  expect(validateDrafts([...drafts, { ...newFieldDraft("select", "S"), options: [{ key: "1", label: "a", color: "gray" }, { key: "2", label: "A", color: "red" }] }])).toContain("two options");
  expect(validateDrafts([])).toBe("Keep at least one field");
  const body = fromDrafts([...drafts, { ...newFieldDraft("number", " Weight "), decimals: 9, unit: " kilograms" }]);
  expect(body[0]).toEqual({ id: "f_aaaaaaaa", name: "Name", type: "text", required: true });
  expect(body[3]!.options).toEqual([{ id: "o_aaaaaa", label: "Book", color: "blue" }]);
  expect(body.at(-1)).toEqual({ name: "Weight", type: "number", number: { decimals: 6, unit: "kilogram" } });
  expect(moveDraft([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  expect(moveDraft([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
});
