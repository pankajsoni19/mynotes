import { describe, expect, test } from "bun:test";
import { inverseType, isRelationType, otherEnd, RELATION_TYPES, relationTypeFor, storedRelation } from "../server/tasks/relations";

/** Relation normalization (WAVE_13_TASK_CARD_UX.md §3.3), pure. */

const x = "11111111-1111-4111-8111-111111111111";
const y = "22222222-2222-4222-8222-222222222222";

describe("relation normalization", () => {
  test("the §3.3 table", () => {
    const table = [
      ["relates_to", { source: x, target: y, kind: "relates" }, "relates_to"],
      ["needed_by", { source: x, target: y, kind: "blocks" }, "depends_on"],
      ["depends_on", { source: y, target: x, kind: "blocks" }, "needed_by"],
      ["duplicates", { source: x, target: y, kind: "duplicates" }, "duplicated_by"],
      ["duplicated_by", { source: y, target: x, kind: "duplicates" }, "duplicates"]
    ] as const;
    for (const [type, row, seenFromY] of table) {
      expect(storedRelation(type, x, y)).toEqual(row);
      // Round trip: X sees what it asked for, Y sees the inverse.
      expect(relationTypeFor(row, x)).toBe(type);
      expect(relationTypeFor(row, y)).toBe(seenFromY);
      expect(inverseType(type)).toBe(seenFromY);
      expect(otherEnd(row, x)).toBe(y);
      expect(otherEnd(row, y)).toBe(x);
    }
  });

  test("both perspectives are inverses, and relates is stored in canonical order", () => {
    for (const type of RELATION_TYPES) {
      expect(inverseType(inverseType(type))).toBe(type);
      // Creating the inverse type from the other side stores the same row.
      expect(storedRelation(inverseType(type), y, x)).toEqual(storedRelation(type, x, y));
    }
    expect(storedRelation("relates_to", y, x)).toEqual({ source: x, target: y, kind: "relates" });
    expect(storedRelation("relates_to", x, y)).toEqual({ source: x, target: y, kind: "relates" });
  });

  test("refuses a self relation and a card that is not an end", () => {
    expect(() => storedRelation("relates_to", x, x)).toThrow();
    expect(() => relationTypeFor({ source: x, target: y, kind: "blocks" }, "33333333-3333-4333-8333-333333333333")).toThrow();
    expect(isRelationType("blocks")).toBe(false);
    expect(isRelationType("parent")).toBe(false);
    expect(isRelationType("depends_on")).toBe(true);
  });
});
