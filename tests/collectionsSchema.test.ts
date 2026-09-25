import { describe, expect, test } from "bun:test";
import {
  buildSchema,
  FIELD_ID,
  fieldsInput,
  hasPrototypeKeys,
  isRealDate,
  OPTION_ID,
  parseValue,
  readValues,
  rowTitle,
  safeJson,
  SchemaError,
  validateValues,
  type CollectionSchema,
  type FieldDefinition,
  type FieldInput
} from "../server/collections/schema";
import { COLLECTION_TEMPLATES, DEFAULT_FIELDS } from "../server/collections/templates";

const allow = { canLinkNote: () => true };
const deny = { canLinkNote: () => false };
const noteId = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

function schemaError(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof SchemaError) return error;
    throw error;
  }
  throw new Error("Expected a SchemaError");
}

describe("collection schema validation", () => {
  test("assigns field and option ids and canonicalises fields", () => {
    const schema = buildSchema([
      { name: "  Item  ", type: "text", required: true },
      { name: "Qty", type: "number" },
      { name: "Where", type: "select", options: [{ label: "Kitchen", color: "orange" }, { label: "Garage" }] }
    ]);
    expect(schema.fields.map((field) => field.name)).toEqual(["Item", "Qty", "Where"]);
    for (const field of schema.fields) expect(field.id).toMatch(FIELD_ID);
    expect(new Set(schema.fields.map((field) => field.id)).size).toBe(3);
    expect(schema.fields[0]).toEqual({ id: schema.fields[0]!.id, name: "Item", type: "text", required: true });
    expect(schema.fields[1]!.number).toEqual({ decimals: 0, unit: "" });
    const options = schema.fields[2]!.options!;
    for (const option of options) expect(option.id).toMatch(OPTION_ID);
    expect(options.map((option) => [option.label, option.color])).toEqual([["Kitchen", "orange"], ["Garage", "gray"]]);
  });

  test("rejects prototype keys anywhere in the input", () => {
    const polluted = JSON.parse('{"fields":[{"name":"A","type":"text","__proto__":{"admin":true}}]}');
    expect(hasPrototypeKeys(polluted)).toBe(true);
    expect(hasPrototypeKeys(JSON.parse('{"values":{"constructor":{"prototype":1}}}'))).toBe(true);
    expect(hasPrototypeKeys({ fields: [{ name: "A" }] })).toBe(false);
    const wrapped = safeJson(fieldsInput);
    expect(wrapped.safeParse(polluted.fields).success).toBe(false);
    expect(wrapped.safeParse([{ name: "A", type: "text" }]).success).toBe(true);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  test("rejects 51 fields, duplicate names, a non-text primary field, and unknown keys", () => {
    const many = Array.from({ length: 51 }, (_, index): FieldInput => ({ name: `Field ${index}`, type: "text" }));
    expect(schemaError(() => buildSchema(many)).code).toBe("INVALID_SCHEMA");
    expect(buildSchema(many.slice(0, 50)).fields).toHaveLength(50);
    expect(schemaError(() => buildSchema([{ name: "Name", type: "text" }, { name: "NAME", type: "number" }])).message).toContain("Two fields");
    expect(schemaError(() => buildSchema([{ name: "Price", type: "number" }])).message).toContain("first field");
    expect(schemaError(() => buildSchema([])).code).toBe("INVALID_SCHEMA");
    expect(() => buildSchema([{ name: "A", type: "text", extra: 1 } as unknown as FieldInput])).toThrow(SchemaError);
    expect(() => buildSchema([{ name: "A", type: "formula" } as unknown as FieldInput])).toThrow(SchemaError);
    expect(() => buildSchema([{ name: "x".repeat(61), type: "text" }])).toThrow(SchemaError);
    for (const name of ["__proto__", "constructor", "prototype", " constructor "]) {
      expect(schemaError(() => buildSchema([{ name: "A", type: "text" }, { name, type: "text" }])).code).toBe("INVALID_SCHEMA");
    }
    expect(buildSchema([{ name: "A", type: "text" }, { name: "Constructor", type: "text" }]).fields[1]!.name).toBe("Constructor");
    expect(() => buildSchema([{ name: "bad\u0007", type: "text" }])).toThrow(SchemaError);
    expect(() => buildSchema([{ name: "A", type: "text", options: [] }])).toThrow(SchemaError);
    expect(() => buildSchema([{ name: "A", type: "text" }, { name: "B", type: "select", options: [{ label: "x" }, { label: "X" }] }])).toThrow(SchemaError);
    expect(() => buildSchema([{ name: "A", type: "text" }, { name: "B", type: "select", options: Array.from({ length: 101 }, (_, index) => ({ label: `o${index}` })) }])).toThrow(SchemaError);
    expect(() => buildSchema([{ name: "A", type: "text" }, { name: "N", type: "number", number: { decimals: 7, unit: "" } }])).toThrow(SchemaError);
  });

  test("never accepts client-invented field or option ids", () => {
    expect(schemaError(() => buildSchema([{ id: "f_abcdefgh", name: "A", type: "text" }])).message).toContain("assigned by the server");
    const base = buildSchema([{ name: "A", type: "text" }, { name: "S", type: "select", options: [{ label: "one" }] }]);
    const [primary, select] = base.fields as [FieldDefinition, FieldDefinition];
    expect(() => buildSchema([{ id: primary.id, name: "A", type: "text" }, { id: select.id, name: "S", type: "select", options: [{ id: "o_zzzzzz", label: "two" }] }], base)).toThrow(SchemaError);
    expect(() => buildSchema([{ id: primary.id, name: "A", type: "text" }, { id: primary.id, name: "B", type: "text" }], base)).toThrow(SchemaError);
    const kept = buildSchema([{ id: primary.id, name: "Renamed", type: "text" }, { id: select.id, name: "S", type: "select", options: [{ id: select.options![0]!.id, label: "uno" }, { label: "dos" }] }], base);
    expect(kept.fields[0]!.id).toBe(primary.id);
    expect(kept.fields[1]!.options![0]).toMatchObject({ id: select.options![0]!.id, label: "uno" });
    expect(kept.fields[1]!.options![1]!.id).not.toBe(select.options![0]!.id);
  });

  test("allows only text↔url and select→multi_select type changes", () => {
    const base = buildSchema([{ name: "A", type: "text" }, { name: "L", type: "text" }, { name: "S", type: "select", options: [{ label: "x" }] }, { name: "N", type: "number" }]);
    const [a, l, s, n] = base.fields as FieldDefinition[];
    const keep = (changes: Partial<Record<string, FieldInput["type"]>>) => base.fields.map((field): FieldInput => ({
      id: field.id, name: field.name, type: changes[field.id] ?? field.type, ...(field.options ? { options: field.options } : {})
    }));
    expect(buildSchema(keep({ [l!.id]: "url" }), base).fields[1]!.type).toBe("url");
    expect(buildSchema(keep({ [s!.id]: "multi_select" }), base).fields[2]!.type).toBe("multi_select");
    expect(schemaError(() => buildSchema(keep({ [n!.id]: "text" }), base)).code).toBe("INCOMPATIBLE_TYPE_CHANGE");
    expect(schemaError(() => buildSchema(keep({ [a!.id]: "number" }), base)).code).toBe("INCOMPATIBLE_TYPE_CHANGE");
    const multi = buildSchema(keep({ [s!.id]: "multi_select" }), base);
    expect(schemaError(() => buildSchema(multi.fields.map((field) => ({ ...field, type: field.id === s!.id ? "select" as const : field.type })), multi)).code).toBe("INCOMPATIBLE_TYPE_CHANGE");
  });

  test("the five templates and the default fields build into valid schemas", () => {
    expect(COLLECTION_TEMPLATES.map((template) => template.id)).toEqual(["inventory", "subscriptions", "expenses", "recipes", "contacts"]);
    for (const template of COLLECTION_TEMPLATES) {
      const schema = buildSchema(template.fields);
      expect(schema.fields[0]!.type).toBe("text");
      // Templates are copied: two collections from one template get different ids.
      expect(buildSchema(template.fields).fields[0]!.id).not.toBe(schema.fields[0]!.id);
    }
    expect(buildSchema(DEFAULT_FIELDS).fields.map((field) => field.name)).toEqual(["Name", "Notes"]);
  });
});

describe("row values", () => {
  const schema: CollectionSchema = buildSchema([
    { name: "Title", type: "text", required: true },
    { name: "Count", type: "number" },
    { name: "When", type: "date" },
    { name: "Done", type: "checkbox" },
    { name: "Kind", type: "select", options: [{ label: "a" }, { label: "b" }] },
    { name: "Tags", type: "multi_select", options: [{ label: "x" }, { label: "y" }] },
    { name: "Link", type: "url" },
    { name: "Note", type: "note" },
    { name: "Files", type: "file" }
  ]);
  const [title, count, when, done, kind, tags, link, note, files] = schema.fields as FieldDefinition[];

  test("text is NFC-normalised, stripped of controls, trimmed, and capped at 4000 characters", () => {
    expect(parseValue(title!, "  Café\u0007 ‮ok\r\nline  ", allow)).toEqual({ ok: true, value: "Café ok\nline" });
    expect(parseValue(title!, "   ", allow)).toEqual({ ok: true, value: null });
    expect(parseValue(title!, "x".repeat(4000), allow).ok).toBe(true);
    expect(parseValue(title!, "x".repeat(4001), allow).ok).toBe(false);
    expect(parseValue(title!, 5, allow).ok).toBe(false);
  });

  test("numbers, dates, checkboxes, options, urls, notes, and files follow their type rules", () => {
    expect(parseValue(count!, 3.5, allow)).toEqual({ ok: true, value: 3.5 });
    for (const bad of ["3", Number.NaN, Number.POSITIVE_INFINITY, true]) expect(parseValue(count!, bad, allow).ok).toBe(false);
    expect(parseValue(when!, "2024-02-29", allow).ok).toBe(true);
    for (const bad of ["2023-02-29", "2024-13-01", "2024-1-01", "0000-01-01", "2024-01-01T00:00"]) expect(parseValue(when!, bad, allow).ok).toBe(false);
    expect(isRealDate("9999-12-31")).toBe(true);
    expect(parseValue(done!, true, allow)).toEqual({ ok: true, value: true });
    expect(parseValue(done!, false, allow)).toEqual({ ok: true, value: null });
    expect(parseValue(done!, "true", allow).ok).toBe(false);
    expect(parseValue(kind!, kind!.options![0]!.id, allow).ok).toBe(true);
    expect(parseValue(kind!, "o_nopeno", allow).ok).toBe(false);
    expect(parseValue(tags!, [tags!.options![0]!.id, tags!.options![0]!.id], allow)).toEqual({ ok: true, value: [tags!.options![0]!.id] });
    expect(parseValue(tags!, ["o_nopeno"], allow).ok).toBe(false);
    expect(parseValue(tags!, [], allow)).toEqual({ ok: true, value: null });
    expect(parseValue(link!, " https://example.test/a?b=1 ", allow)).toEqual({ ok: true, value: "https://example.test/a?b=1" });
    for (const bad of ["javascript:alert(1)", "ftp://example.test", "data:text/html,x", "https://exa mple.test", `https://example.test/${"a".repeat(2048)}`]) {
      expect(parseValue(link!, bad, allow).ok).toBe(false);
    }
    expect(parseValue(note!, noteId.toUpperCase(), allow)).toEqual({ ok: true, value: noteId });
    expect(parseValue(note!, noteId, deny).ok).toBe(false);
    expect(parseValue(note!, "not-a-uuid", allow).ok).toBe(false);
    expect(parseValue(files!, [], allow).ok).toBe(false);
  });

  test("writes are strict: unknown fields, required fields, and oversized rows are refused", () => {
    const created = validateValues(schema, { [title!.id]: "Mug", [count!.id]: 2 }, {}, allow, "create");
    expect(created).toEqual({ ok: true, values: { [title!.id]: "Mug", [count!.id]: 2 } });
    const missing = validateValues(schema, { [count!.id]: 2 }, {}, allow, "create");
    expect(missing.ok ? null : missing.fieldErrors[title!.id]).toBe("This field is required");
    const unknown = validateValues(schema, { f_zzzzzzzz: "x", [title!.id]: "ok" }, {}, allow, "create");
    expect(unknown.ok ? null : unknown.fieldErrors.f_zzzzzzzz).toBe("Unknown field");
    expect(validateValues(schema, JSON.parse(`{"__proto__":{"x":1},"${title!.id}":"a"}`), {}, allow, "create").ok).toBe(false);
    expect(validateValues(schema, [], {}, allow, "create").ok).toBe(false);
    const cleared = validateValues(schema, { [title!.id]: null }, { [title!.id]: "Mug" }, allow, "update");
    expect(cleared.ok).toBe(false);
    const merged = validateValues(schema, { [count!.id]: null, [done!.id]: true }, { [title!.id]: "Mug", [count!.id]: 2 }, allow, "update");
    expect(merged).toEqual({ ok: true, values: { [title!.id]: "Mug", [done!.id]: true } });
    const bigSchema = buildSchema([{ name: "T", type: "text" }, ...Array.from({ length: 5 }, (_, index): FieldInput => ({ name: `Long ${index}`, type: "text" }))]);
    const big = Object.fromEntries(bigSchema.fields.map((field) => [field.id, "é".repeat(4000)]));
    const tooLarge = validateValues(bigSchema, big, {}, allow, "create");
    expect(tooLarge.ok ? null : tooLarge.fieldErrors._).toBe("This row is too large");
  });

  test("reads are lenient: removed fields, removed options, and incompatible values read as empty", () => {
    const stored = {
      [title!.id]: "Mug",
      f_removed1: "gone",
      [kind!.id]: "o_gone00",
      [tags!.id]: [tags!.options![1]!.id, "o_gone00"],
      [link!.id]: "not a url",
      [count!.id]: "7",
      [done!.id]: false
    };
    expect(readValues(schema, stored)).toEqual({ [title!.id]: "Mug", [tags!.id]: [tags!.options![1]!.id] });
    expect(readValues(schema, null)).toEqual({});
    expect(readValues(schema, JSON.parse('{"__proto__":{"x":1}}'))).toEqual({});
    // select → multi_select keeps the single id.
    const multi: FieldDefinition = { ...kind!, type: "multi_select" };
    expect(readValues({ fields: [title!, multi] }, { [kind!.id]: kind!.options![0]!.id })).toEqual({ [kind!.id]: [kind!.options![0]!.id] });
    expect(rowTitle(schema, { [title!.id]: "Mug" })).toBe("Mug");
    expect(rowTitle(schema, {})).toBe("");
  });
});
