import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RelationAdder, RelationList, RelationsSection } from "../src/tasks/RelationsSection";
import { blockedByLabel, groupRelations, isRelationType, linkedCardIds, openBlockerCount, relatedCardPlace, relationErrorMessage, relationRow, RELATION_TYPE_ORDER } from "../src/tasks/relationsModel";
import type { CardRelation } from "../src/tasks/tasksApi";

const noop = () => undefined;
const boardId = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const otherBoard = "4f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const cardA = "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d";
const cardB = "b1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d";
const related = (id: string, type: CardRelation["type"], card: { id: string; board: string; title: string; done?: 0 | 1 }): CardRelation => ({
  id, type, restricted: false, created_at: "2026-09-26T00:00:00Z", creator_name: "Ann",
  card: { id: card.id, board_id: card.board, board_name: card.board === boardId ? "Home" : "Ops", title: card.title, column_name: card.done ? "Done" : "To do", is_done: card.done ?? 0, due_on: null }
});
const relations: CardRelation[] = [
  related("r1", "depends_on", { id: cardA, board: otherBoard, title: "Order parts" }),
  { id: "r2", type: "depends_on", restricted: true, created_at: "2026-09-26T00:00:00Z" },
  related("r3", "relates_to", { id: cardB, board: boardId, title: "Paint <b>fence</b>" }),
  related("r4", "depends_on", { id: "c4", board: boardId, title: "Buy paint", done: 1 })
];

test("relations group by type in a fixed order and keep row order", () => {
  const groups = groupRelations(relations.map(relationRow));
  expect(groups.map((group) => group.label)).toEqual(["Depends on", "Relates to"]);
  expect(groups[0]!.rows.map((row) => row.key)).toEqual(["r1", "r2", "r4"]);
  expect(RELATION_TYPE_ORDER).toEqual(["depends_on", "needed_by", "relates_to", "duplicates", "duplicated_by"]);
  expect(isRelationType("blocks")).toBe(false);
  expect(isRelationType("needed_by")).toBe(true);
});

test("open blockers count readable, open depends_on cards only (restricted and done ones do not)", () => {
  expect(openBlockerCount(relations.map(relationRow))).toBe(1);
  expect(blockedByLabel(1)).toBe("Blocked by 1 open card");
  expect(blockedByLabel(3)).toBe("Blocked by 3 open cards");
});

test("a restricted row carries nothing about the other card", () => {
  const row = relationRow(relations[1]!);
  expect(row).toEqual({ key: "r2", type: "depends_on", restricted: true });
  expect([...linkedCardIds(relations.map(relationRow))].sort()).toEqual([cardA, cardB, "c4"].sort());
});

test("the place names the other board only when it is not this one", () => {
  expect(relatedCardPlace(relationRow(relations[0]!).card!, boardId)).toBe("Ops · To do");
  expect(relatedCardPlace(relationRow(relations[2]!).card!, boardId)).toBe("To do");
});

test("refusals read plainly", () => {
  expect(relationErrorMessage("RELATION_EXISTS", "x", relations[0])).toBe("These cards are already linked (depends on). Remove that link first to change it.");
  expect(relationErrorMessage("RELATION_EXISTS", "x", null)).toBe("These cards are already linked.");
  expect(relationErrorMessage("LIMIT_REACHED", "x")).toBe("A card can have at most 50 relations.");
  expect(relationErrorMessage(undefined, "Could not link")).toBe("Could not link");
});

test("the list links readable cards to their route, shows Restricted card, and escapes titles", () => {
  const markup = renderToStaticMarkup(<RelationList rows={relations.map(relationRow)} boardId={boardId} onOpen={noop} onRemove={noop} />);
  expect(markup).toContain(`href="/tasks/${otherBoard}/card/${cardA}"`);
  expect(markup).toContain(`href="/tasks/${boardId}/card/${cardB}"`);
  expect(markup).toContain("Restricted card");
  expect(markup).toContain("On a board you cannot open");
  expect(markup).toContain('aria-label="Remove the link to the restricted card"');
  expect(markup).toContain('aria-label="Remove the link to Order parts"');
  expect(markup).toContain("Paint &lt;b&gt;fence&lt;/b&gt;");
  expect(markup).not.toContain("<b>fence</b>");
  // No link out of a restricted row: exactly the three readable cards are anchors.
  expect(markup.match(/<a /g)?.length).toBe(3);
});

test("without onOpen (the composer's staged rows) the titles are text, not links", () => {
  const markup = renderToStaticMarkup(<RelationList rows={relations.slice(0, 1).map(relationRow)} boardId={boardId} />);
  expect(markup).not.toContain("<a ");
  expect(markup).toContain("Order parts");
  expect(markup).not.toContain("Remove the link");
});

test("the section shows the blocked chip and the add button; the adder uses the shared dropdowns", () => {
  const markup = renderToStaticMarkup(<RelationsSection cardId="k1" boardId={boardId} idPrefix="t" relations={relations} onChange={noop} onOpen={noop} notify={noop} />);
  expect(markup).toContain("Blocked by 1 open card");
  expect(markup).toContain("Add relation");
  expect(markup).toContain('id="t-relations"');
  const empty = renderToStaticMarkup(<RelationsSection cardId="k1" boardId={boardId} idPrefix="t" relations={[]} onChange={noop} onOpen={noop} notify={noop} />);
  expect(empty).toContain("No related cards.");
  expect(empty).not.toContain("Blocked by");
  const adder = renderToStaticMarkup(<RelationAdder idPrefix="t" boardId={boardId} excluded={new Set()} onAdd={async () => null} onDone={noop} />);
  expect(adder).not.toContain("<select");
  expect(adder).toContain('role="combobox"');
  expect(adder).toContain('aria-label="Card to link"');
  expect(adder).toContain("Relates to");
});
