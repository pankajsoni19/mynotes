// Pure helpers for card relations in the UI (WAVE_13_TASK_CARD_UX.md §4.3, D104–D105). Types are
// always seen from the card on screen; the server resolves each row for the viewer.
import type { CardRelation, RelationType } from "./tasksApi";

/** The order groups are listed in, and the add-relation type choices. */
export const RELATION_TYPE_ORDER: readonly RelationType[] = ["depends_on", "needed_by", "relates_to", "duplicates", "duplicated_by"];

export const RELATION_LABELS: Record<RelationType, string> = {
  depends_on: "Depends on",
  needed_by: "Needed by",
  relates_to: "Relates to",
  duplicates: "Duplicates",
  duplicated_by: "Duplicated by"
};

/** One line under each choice in the type picker. */
export const RELATION_HINTS: Record<RelationType, string> = {
  depends_on: "That card has to be done first",
  needed_by: "This card has to be done first",
  relates_to: "Linked, no order",
  duplicates: "This card repeats that one",
  duplicated_by: "That card repeats this one"
};

export const isRelationType = (value: string): value is RelationType => (RELATION_TYPE_ORDER as readonly string[]).includes(value);

/** A row the list can show: a saved relation, or one staged in the composer. */
export type RelationRow = { key: string; type: RelationType; restricted: boolean; card?: { id: string; board_id: string; board_name: string; title: string; column_name: string | null; is_done: 0 | 1 } };

export function relationRow(relation: CardRelation): RelationRow {
  return relation.restricted
    ? { key: relation.id, type: relation.type, restricted: true }
    : { key: relation.id, type: relation.type, restricted: false, card: relation.card };
}

/** Rows grouped by type in `RELATION_TYPE_ORDER`; empty groups are left out, row order is kept. */
export function groupRelations<T extends { type: RelationType }>(rows: readonly T[]): Array<{ type: RelationType; label: string; rows: T[] }> {
  return RELATION_TYPE_ORDER
    .map((type) => ({ type, label: RELATION_LABELS[type], rows: rows.filter((row) => row.type === type) }))
    .filter((group) => group.rows.length > 0);
}

/** Readable `depends_on` cards that are not in a done column (the server's `open_blockers`). */
export function openBlockerCount(rows: readonly RelationRow[]) {
  return rows.filter((row) => row.type === "depends_on" && !row.restricted && row.card?.is_done === 0).length;
}

export const blockedByLabel = (count: number) => count === 1 ? "Blocked by 1 open card" : `Blocked by ${count} open cards`;

/** Card ids already linked, to leave out of the picker (restricted rows have none). */
export const linkedCardIds = (rows: readonly RelationRow[]) => new Set(rows.flatMap((row) => row.card ? [row.card.id] : []));

/** Where a related card sits, for its row: "Board · Column", or "Done" appended. */
export function relatedCardPlace(card: NonNullable<RelationRow["card"]>, currentBoardId: string) {
  const parts = [card.board_id === currentBoardId ? null : card.board_name, card.column_name].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

/** The error copy for a refused link (POST /cards/:k/relations or the composer's create). */
export function relationErrorMessage(code: unknown, fallback: string, existing?: CardRelation | null) {
  if (code === "RELATION_EXISTS") {
    return existing ? `These cards are already linked (${RELATION_LABELS[existing.type].toLowerCase()}). Remove that link first to change it.` : "These cards are already linked.";
  }
  if (code === "LIMIT_REACHED") return "A card can have at most 50 relations.";
  return fallback;
}
