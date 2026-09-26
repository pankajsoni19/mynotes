import { describe, expect, test } from "bun:test";
import {
  BOARD_TEMPLATES,
  childPlural,
  FLAT_STRUCTURE,
  levelName,
  parseStructure,
  PRESETS,
  presetOf,
  STRUCTURE_PRESETS,
  structureLabel,
  TEMPLATES,
  validateStructure
} from "../shared/boardStructure";

/** Board structure and templates (research 2026-09-26 D122, D123, D136): pure, shared by server and client. */

describe("board structure", () => {
  test("every preset validates, matches itself, and reads as its label", () => {
    for (const preset of STRUCTURE_PRESETS) {
      const { structure, label } = PRESETS[preset];
      expect(validateStructure(structure)).toEqual({ ok: true, structure });
      expect(presetOf(structure)).toBe(preset);
      expect(structureLabel(structure)).toBe(label === "Card" ? "Card" : label);
    }
    expect(structureLabel(PRESETS.sprint_task_subtask.structure)).toBe("Sprint › Task › Subtask");
    expect(presetOf({ levels: [{ name: "Goal", plural: "Goals" }, { name: "Step", plural: "Steps" }], workLevel: 0, sprints: false })).toBe("custom");
    expect(presetOf({ ...PRESETS.epic_story_subtask.structure, workLevel: 0 })).toBe("custom");
  });

  test("names, level counts, and the work level are bounded; names are trimmed", () => {
    const level = (name: string, plural = `${name}s`) => ({ name, plural });
    expect(validateStructure({ levels: [level("  Goal  ", " Goals ")], workLevel: 0, sprints: false }))
      .toEqual({ ok: true, structure: { levels: [level("Goal")], workLevel: 0, sprints: false } });
    const refused = [
      null, [], "flat", {},
      { levels: [], workLevel: 0, sprints: false },
      { levels: [level("A"), level("B"), level("C"), level("D")], workLevel: 0, sprints: false },
      { levels: [level("A")], workLevel: 1, sprints: false },
      { levels: [level("A")], workLevel: -1, sprints: false },
      { levels: [level("A")], workLevel: 0.5, sprints: false },
      { levels: [level("A")], workLevel: 0, sprints: "yes" },
      { levels: [level("A")], workLevel: 0 },
      { levels: [level("A")], workLevel: 0, sprints: false, extra: 1 },
      { levels: [{ name: "A", plural: "As", color: "red" }], workLevel: 0, sprints: false },
      { levels: [level("")], workLevel: 0, sprints: false },
      { levels: [level("   ", "x")], workLevel: 0, sprints: false },
      { levels: [level("x".repeat(25), "x")], workLevel: 0, sprints: false },
      { levels: [level("Tab\there", "x")], workLevel: 0, sprints: false },
      { levels: [level("Bidi‮", "x")], workLevel: 0, sprints: false },
      { levels: [{ name: 1, plural: "x" }], workLevel: 0, sprints: false }
    ];
    for (const input of refused) expect(validateStructure(input).ok).toBe(false);
    expect(validateStructure({ levels: [level("x".repeat(24), "y".repeat(24))], workLevel: 0, sprints: true }).ok).toBe(true);
  });

  test("stored text parses leniently to Flat; names fall back past the last level", () => {
    expect(parseStructure(null)).toEqual(FLAT_STRUCTURE);
    expect(parseStructure("not json")).toEqual(FLAT_STRUCTURE);
    expect(parseStructure('{"levels":[]}')).toEqual(FLAT_STRUCTURE);
    expect(parseStructure(JSON.stringify(PRESETS.epic_story_subtask.structure))).toEqual(PRESETS.epic_story_subtask.structure);
    const epics = PRESETS.epic_story_subtask.structure;
    expect([levelName(epics, 0), levelName(epics, 1), levelName(epics, 2), levelName(epics, 3)]).toEqual(["Epic", "Story", "Subtask", "Card"]);
    expect([childPlural(epics, 0), childPlural(epics, 1), childPlural(epics, 2)]).toEqual(["Stories", "Subtasks", "Subtasks"]);
  });

  test("templates have 2–5 columns with one done column, a valid structure, and no cards", () => {
    expect(BOARD_TEMPLATES).toEqual(["kanban", "todo", "checklist", "scrum", "epics", "triage", "content"]);
    for (const id of BOARD_TEMPLATES) {
      const template = TEMPLATES[id];
      expect(template.id).toBe(id);
      expect(template.columns.length).toBeGreaterThanOrEqual(2);
      expect(template.columns.length).toBeLessThanOrEqual(5);
      expect(template.columns.filter((column) => column.state === "done")).toHaveLength(1);
      expect(template.columns[0]!.state).toBe("todo");
      expect(validateStructure(template.structure).ok).toBe(true);
      expect(Object.keys(template)).not.toContain("cards");
    }
    expect(presetOf(TEMPLATES.epics.structure)).toBe("epic_story_subtask");
    expect(presetOf(TEMPLATES.scrum.structure)).toBe("sprint_task_subtask");
    expect(TEMPLATES.kanban.columns.map((column) => column.name)).toEqual(["To do", "Doing", "Done"]);
  });
});
