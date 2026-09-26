/**
 * Typed card relations, pure normalization (WAVE_13_TASK_CARD_UX.md D104, §3.3). No database.
 *
 * Three kinds are stored and five types are shown, always from the viewed card's side:
 *
 * | Type seen from X toward Y | Stored (source, target, kind) | How Y sees it  |
 * | ------------------------- | ----------------------------- | -------------- |
 * | relates_to                | (min, max, relates)           | relates_to     |
 * | needed_by (X blocks Y)    | (X, Y, blocks)                | depends_on     |
 * | depends_on (Y blocks X)   | (Y, X, blocks)                | needed_by      |
 * | duplicates                | (X, Y, duplicates)            | duplicated_by  |
 * | duplicated_by             | (Y, X, duplicates)            | duplicates     |
 *
 * `relates` is symmetric and stored with `source < target` (the migration 015 CHECK). There is one
 * relation per unordered pair, whatever its kind (the unique min/max index).
 */
export type RelationKind = "relates" | "blocks" | "duplicates";
export type RelationType = "relates_to" | "depends_on" | "needed_by" | "duplicates" | "duplicated_by";

export const RELATION_TYPES: readonly RelationType[] = ["relates_to", "depends_on", "needed_by", "duplicates", "duplicated_by"];
export const isRelationType = (value: string): value is RelationType => (RELATION_TYPES as readonly string[]).includes(value);

export type StoredRelation = { source: string; target: string; kind: RelationKind };

/** The row to store when card `from` gets relation `type` toward card `to`. The ids must differ. */
export function storedRelation(type: RelationType, from: string, to: string): StoredRelation {
  if (from === to) throw new Error("A card cannot relate to itself");
  switch (type) {
    case "relates_to": return from < to ? { source: from, target: to, kind: "relates" } : { source: to, target: from, kind: "relates" };
    case "needed_by": return { source: from, target: to, kind: "blocks" };
    case "depends_on": return { source: to, target: from, kind: "blocks" };
    case "duplicates": return { source: from, target: to, kind: "duplicates" };
    case "duplicated_by": return { source: to, target: from, kind: "duplicates" };
  }
}

/** How card `viewedCardId` (one end of the stored row) sees the relation. */
export function relationTypeFor(row: StoredRelation, viewedCardId: string): RelationType {
  const isSource = row.source === viewedCardId;
  if (!isSource && row.target !== viewedCardId) throw new Error("The card is not an end of this relation");
  if (row.kind === "relates") return "relates_to";
  if (row.kind === "blocks") return isSource ? "needed_by" : "depends_on";
  return isSource ? "duplicates" : "duplicated_by";
}

/** The other end of the stored row, seen from `viewedCardId`. */
export const otherEnd = (row: StoredRelation, viewedCardId: string) => (row.source === viewedCardId ? row.target : row.source);

/** The type the other card sees for a type seen from this card. */
export function inverseType(type: RelationType): RelationType {
  switch (type) {
    case "relates_to": return "relates_to";
    case "depends_on": return "needed_by";
    case "needed_by": return "depends_on";
    case "duplicates": return "duplicated_by";
    case "duplicated_by": return "duplicates";
  }
}
