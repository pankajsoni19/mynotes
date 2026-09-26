import { db } from "../db";
import { HIERARCHY_LIMITS, parseStructure, type BoardStructure } from "../../shared/boardStructure";

/**
 * Card hierarchy reads (research 2026-09-26 D120–D135, §6.3). A card's parent
 * is on the same board and exactly one level up, so every walk here is at
 * most two steps and never recursive (T110). Roll-ups are one grouped query
 * per board (D134, T111). The rules that refuse a write live in the service
 * (`service.ts`), which calls these under the board lock.
 */

export type Rollup = { child_count: number; done_child_count: number };
const NO_CHILDREN: Rollup = { child_count: 0, done_child_count: 0 };

/** The board's structure (Flat when the stored text is unusable). */
export function boardStructure(boardId: string): BoardStructure {
  const row = db.query("SELECT structure_json FROM boards WHERE id = ?").get(boardId) as { structure_json: string } | null;
  return parseStructure(row?.structure_json);
}

/** Direct live children per parent on one board, and how many sit in a done column (one grouped query). */
export function rollupsForBoard(boardId: string) {
  const rows = db.query(`SELECT k.parent_card_id AS parent_id, COUNT(*) AS child_count, COALESCE(SUM(col.is_done), 0) AS done_child_count
    FROM cards k JOIN board_columns col ON col.id = k.column_id
    WHERE k.board_id = ? AND k.deleted_at IS NULL AND k.parent_card_id IS NOT NULL
    GROUP BY k.parent_card_id`).all(boardId) as Array<Rollup & { parent_id: string }>;
  return new Map(rows.map((row) => [row.parent_id, { child_count: row.child_count, done_child_count: row.done_child_count }]));
}

export function rollupFor(cardId: string): Rollup {
  const row = db.query(`SELECT COUNT(*) AS child_count, COALESCE(SUM(col.is_done), 0) AS done_child_count
    FROM cards k JOIN board_columns col ON col.id = k.column_id
    WHERE k.parent_card_id = ? AND k.deleted_at IS NULL`).get(cardId) as Rollup | null;
  return row ?? NO_CHILDREN;
}

export const liveChildCount = (cardId: string) =>
  (db.query("SELECT COUNT(*) AS count FROM cards WHERE parent_card_id = ? AND deleted_at IS NULL").get(cardId) as { count: number }).count;

export type ChildCard = {
  id: string; title: string; level: number; column_id: string; column_name: string; is_done: 0 | 1; position: number;
  due_on: string | null; child_count: number; done_child_count: number;
};
export type CardHierarchy = {
  parent: { id: string; title: string; level: number } | null;
  /** Root first, at most two (the breadcrumb). */
  ancestors: Array<{ id: string; title: string; level: number }>;
  /** Live direct children by column position, then card position, at most 100 (D135). */
  children: ChildCard[];
};

/**
 * The parent, ancestors, and children of a live card whose board the caller
 * can read. Parents are on the same board (D133), so nothing here crosses a
 * board boundary (T112); a binned parent is left out.
 */
export function cardHierarchy(cardId: string): CardHierarchy {
  const ancestors: CardHierarchy["ancestors"] = [];
  let current = db.query("SELECT parent_card_id, board_id FROM cards WHERE id = ?").get(cardId) as { parent_card_id: string | null; board_id: string } | null;
  const boardId = current?.board_id;
  for (let step = 0; step < 2 && current?.parent_card_id; step += 1) {
    const parent = db.query("SELECT id, title, level, parent_card_id, board_id FROM cards WHERE id = ? AND board_id = ? AND deleted_at IS NULL")
      .get(current.parent_card_id, boardId ?? "") as { id: string; title: string; level: number; parent_card_id: string | null; board_id: string } | null;
    if (!parent) break;
    ancestors.unshift({ id: parent.id, title: parent.title, level: parent.level });
    current = parent;
  }
  const children = db.query(`SELECT k.id, k.title, k.level, k.column_id, col.name AS column_name, col.is_done, k.position, k.due_on
    FROM cards k JOIN board_columns col ON col.id = k.column_id
    WHERE k.parent_card_id = ? AND k.deleted_at IS NULL
    ORDER BY col.position, k.position, k.id LIMIT ${HIERARCHY_LIMITS.childrenPerCard}`).all(cardId) as Array<Omit<ChildCard, "child_count" | "done_child_count">>;
  const counts = boardId && children.length ? rollupsForBoard(boardId) : new Map<string, Rollup>();
  return {
    parent: ancestors.length ? ancestors[ancestors.length - 1]! : null,
    ancestors,
    children: children.map((child) => ({ ...child, ...(counts.get(child.id) ?? NO_CHILDREN) }))
  };
}

/** A candidate parent on `boardId`, looked up by id and board together (T113). */
export function parentRow(parentId: string, boardId: string) {
  return db.query("SELECT id, level, deleted_at FROM cards WHERE id = ? AND board_id = ?").get(parentId, boardId) as
    { id: string; level: number; deleted_at: string | null } | null;
}
