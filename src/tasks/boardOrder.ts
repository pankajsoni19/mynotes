// Pure ordering helpers for the board UI. The server computes the real positions (D40); these only
// place a card optimistically and work out the `afterCardId` / `afterColumnId` anchors to send.
type Positioned = { id: string; position: number };
type CardLike = Positioned & { column_id: string };

/** Drag type for moving a card; the payload is the card's UUID and nothing else. */
export const CARD_DRAG_TYPE = "application/x-mynotes-card";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The card id carried by a drag, or null when the payload is anything else. */
export function readCardDragPayload(value: string | null | undefined) {
  const id = value?.trim() ?? "";
  return idPattern.test(id) ? id.toLowerCase() : null;
}

export function isCardDrag(types: ArrayLike<string> | readonly string[] | null | undefined) {
  return Boolean(types) && Array.from(types as ArrayLike<string>).includes(CARD_DRAG_TYPE);
}

export const byPosition = (a: Positioned, b: Positioned) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A column's cards in board order. */
export function columnCards<T extends CardLike>(cards: readonly T[], columnId: string) {
  return cards.filter((card) => card.column_id === columnId).sort(byPosition);
}

/**
 * The anchor for dropping `cardId` at `index` of a column, where `index` counts the column's cards
 * without the dragged one: null for the top, otherwise the card just above.
 */
export function afterCardIdAt<T extends CardLike>(columnList: readonly T[], index: number, cardId: string) {
  const others = columnList.filter((card) => card.id !== cardId);
  const clamped = Math.max(0, Math.min(index, others.length));
  return clamped === 0 ? null : others[clamped - 1]!.id;
}

/** Whether moving `cardId` to after `afterCardId` in `columnId` would leave it where it is. */
export function isNoopMove<T extends CardLike>(cards: readonly T[], cardId: string, columnId: string, afterCardId: string | null) {
  const card = cards.find((item) => item.id === cardId);
  if (!card || card.column_id !== columnId) return false;
  const list = columnCards(cards, columnId);
  const index = list.findIndex((item) => item.id === cardId);
  return (index === 0 ? null : list[index - 1]!.id) === afterCardId;
}

/**
 * Moves a card locally the way the server will: after `afterCardId` (null = top) in `columnId`,
 * at the neighbours' midpoint or last + 1024. The server's answer replaces it.
 */
export function applyLocalMove<T extends CardLike>(cards: readonly T[], cardId: string, columnId: string, afterCardId: string | null): T[] {
  const card = cards.find((item) => item.id === cardId);
  if (!card) return [...cards];
  const others = columnCards(cards, columnId).filter((item) => item.id !== cardId);
  const anchor = afterCardId === null ? -1 : others.findIndex((item) => item.id === afterCardId);
  const previous = anchor >= 0 ? others[anchor] : undefined;
  const next = others[anchor + 1];
  const lower = previous ? previous.position : 0;
  const position = next ? lower + (next.position - lower) / 2 : lower + 1024;
  return cards.map((item) => item.id === cardId ? { ...item, column_id: columnId, position } : item);
}

/** Applies the server's renumbered positions for a column. */
export function applyPositions<T extends Positioned>(cards: readonly T[], positions: ReadonlyArray<Positioned>) {
  const next = new Map(positions.map((item) => [item.id, item.position]));
  return cards.map((card) => next.has(card.id) ? { ...card, position: next.get(card.id)! } : card);
}

/**
 * The card the move response returned, merged over the lane card: the response is the card's own
 * row, without board-only fields such as `relation_count` and `open_blockers`, which a move keeps.
 */
export function mergeMovedCard<T extends { id: string }>(cards: readonly T[], moved: Partial<T> & { id: string }): T[] {
  return cards.map((card) => card.id === moved.id ? { ...card, ...moved } : card);
}

/**
 * Whether a move changes other cards' blocker counts: a card with relations crossing into or out of a
 * done column opens or settles the cards that depend on it, so the board reloads its counts.
 */
export function moveChangesBlockers(cards: readonly { id: string; column_id: string; relation_count?: number }[], columns: readonly { id: string; is_done: 0 | 1 }[], cardId: string, columnId: string) {
  const card = cards.find((item) => item.id === cardId);
  if (!card?.relation_count) return false;
  const done = (id: string) => columns.find((column) => column.id === id)?.is_done === 1;
  return done(card.column_id) !== done(columnId);
}

export type MoveKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
export const isMoveKey = (key: string): key is MoveKey => key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";

/**
 * Alt+Arrow keyboard moves: up and down within the column, left and right to the neighbouring
 * column at the same index (clamped to its end). Null at an edge.
 */
export function keyboardMoveTarget<T extends CardLike>(cards: readonly T[], columns: readonly Positioned[], cardId: string, key: MoveKey): { columnId: string; afterCardId: string | null } | null {
  const card = cards.find((item) => item.id === cardId);
  if (!card) return null;
  const list = columnCards(cards, card.column_id);
  const index = list.findIndex((item) => item.id === cardId);
  if (key === "ArrowUp") {
    if (index <= 0) return null;
    return { columnId: card.column_id, afterCardId: index - 2 >= 0 ? list[index - 2]!.id : null };
  }
  if (key === "ArrowDown") {
    if (index >= list.length - 1) return null;
    return { columnId: card.column_id, afterCardId: list[index + 1]!.id };
  }
  const ordered = [...columns].sort(byPosition);
  const columnIndex = ordered.findIndex((column) => column.id === card.column_id);
  const target = ordered[columnIndex + (key === "ArrowLeft" ? -1 : 1)];
  if (columnIndex < 0 || !target) return null;
  const targetList = columnCards(cards, target.id);
  const at = Math.min(index, targetList.length);
  return { columnId: target.id, afterCardId: at === 0 ? null : targetList[at - 1]!.id };
}

/** The `afterColumnId` that moves a column one step left (-1) or right (+1); undefined at an edge. */
export function columnMoveAnchor(columns: readonly Positioned[], columnId: string, direction: -1 | 1): string | null | undefined {
  const ordered = [...columns].sort(byPosition);
  const index = ordered.findIndex((column) => column.id === columnId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return undefined;
  const others = ordered.filter((column) => column.id !== columnId);
  return target === 0 ? null : others[target - 1]!.id;
}

/** Where a card sits, for announcements: "Doing, 2 of 3". */
export function cardPlace<T extends CardLike>(cards: readonly T[], columns: ReadonlyArray<Positioned & { name: string }>, cardId: string) {
  const card = cards.find((item) => item.id === cardId);
  const column = card ? columns.find((item) => item.id === card.column_id) : undefined;
  if (!card || !column) return "";
  const list = columnCards(cards, column.id);
  return `${column.name}, ${list.findIndex((item) => item.id === cardId) + 1} of ${list.length}`;
}

/** "Move to…" with Top or Bottom of a column: the anchor to send (the moved card itself excluded). */
export function sheetMoveAnchor<T extends CardLike>(cards: readonly T[], cardId: string, columnId: string, place: "top" | "bottom") {
  if (place === "top") return null;
  const others = columnCards(cards, columnId).filter((card) => card.id !== cardId);
  return others.length ? others[others.length - 1]!.id : null;
}

/** The column a phone's one-column track shows, from its scroll offset. */
export function columnIndexFromScroll(scrollLeft: number, width: number, count: number) {
  if (count <= 0 || !(width > 0)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(scrollLeft / width)));
}
