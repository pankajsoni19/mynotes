import { audit, db, now } from "../db";
import { purgeAfterFrom } from "../bin";
import { withResourceLock } from "../storage";
import { readableBoard, readableBoardPredicate, readableCard, readableColumn, type BoardVisibility, type ColumnRow } from "./access";
import { planInsert, type Positioned } from "./boardOrder";

/**
 * Task Boards services (WAVES_7-9.md §3). Routes are thin adapters over these
 * functions so Wave 8 MCP tools can reuse them. Every failure is a TaskError.
 *
 * Authorization (D38, D39): readers of a board (owner, members, everyone on an
 * all_users board) work with cards; only the owner renames the board, manages
 * columns and sharing, and deletes. Non-readers get 404, readers calling an
 * owner-only action get 403 OWNER_ONLY.
 */
export class TaskError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string, readonly code?: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
  body() {
    return { error: this.message, ...(this.code ? { code: this.code } : {}), ...this.extra };
  }
}

export const LIMITS = { boardsPerOwner: 50, columnsPerBoard: 20, liveCardsPerBoard: 1000 } as const;
export const DEFAULT_COLUMNS = ["To do", "Doing", "Done"] as const;

const boardNotFound = () => new TaskError(404, "Board not found");
const columnNotFound = () => new TaskError(404, "Column not found");
const ownerOnly = () => new TaskError(403, "Only the board owner can do this", "OWNER_ONLY");
const limitReached = (message: string) => new TaskError(409, message, "LIMIT_REACHED");

/** Serializes every change to one board: ordering, column changes, sharing, and deletion. */
export const withBoardLock = <T>(boardId: string, operation: () => T | Promise<T>) =>
  withResourceLock(`board:${boardId}`, async () => operation());

export type BoardSummary = {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  is_owner: 0 | 1;
  visibility: BoardVisibility;
  card_count: number;
  created_at: string;
  updated_at: string;
};

export type ColumnSummary = Pick<ColumnRow, "id" | "board_id" | "name" | "position" | "created_at" | "updated_at">;

const boardSummarySelect = `
  SELECT b.id, b.name, b.owner_id, u.display_name AS owner_name,
         CASE WHEN b.owner_id = $userId THEN 1 ELSE 0 END AS is_owner,
         b.visibility,
         (SELECT COUNT(*) FROM cards k WHERE k.board_id = b.id AND k.deleted_at IS NULL) AS card_count,
         b.created_at, b.updated_at
  FROM boards b JOIN users u ON u.id = b.owner_id
`;

export function boardSummary(boardId: string, userId: string) {
  return db.query(`${boardSummarySelect} WHERE b.id = $boardId AND ${readableBoardPredicate}`).get({ boardId, userId }) as BoardSummary | null;
}

export function listBoards(userId: string) {
  return db.query(`${boardSummarySelect} WHERE ${readableBoardPredicate} ORDER BY is_owner DESC, b.name COLLATE NOCASE, b.id LIMIT 500`)
    .all({ userId }) as BoardSummary[];
}

export function listColumns(boardId: string) {
  return db.query("SELECT id, board_id, name, position, created_at, updated_at FROM board_columns WHERE board_id = ? ORDER BY position, id")
    .all(boardId) as ColumnSummary[];
}

/**
 * A card as shown on the board: no description (up to 64 KiB each), only
 * whether one exists, plus comment and attachment counts.
 */
export type CardSummary = {
  id: string;
  board_id: string;
  column_id: string;
  position: number;
  title: string;
  has_description: 0 | 1;
  revision: number;
  created_by: string | null;
  creator_name: string | null;
  comment_count: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

const cardSelect = (extraColumns = "") => `
  SELECT k.id, k.board_id, k.column_id, k.position, k.title,
         CASE WHEN k.description <> '' THEN 1 ELSE 0 END AS has_description,
         k.revision, k.created_by, cu.display_name AS creator_name,
         (SELECT COUNT(*) FROM card_comments cc WHERE cc.card_id = k.id) AS comment_count,
         (SELECT COUNT(*) FROM card_attachments ca WHERE ca.card_id = k.id) AS attachment_count,
         k.created_at, k.updated_at${extraColumns}
  FROM cards k LEFT JOIN users cu ON cu.id = k.created_by
`;
export const cardSummarySelect = cardSelect();
const cardDetailSelect = cardSelect(", k.description");

export function listCards(boardId: string) {
  return db.query(`${cardSummarySelect} WHERE k.board_id = ? AND k.deleted_at IS NULL ORDER BY k.position, k.id`).all(boardId) as CardSummary[];
}

export function getBoard(userId: string, boardId: string) {
  requireReadableBoard(boardId, userId);
  return { board: boardSummary(boardId, userId)!, columns: listColumns(boardId), cards: listCards(boardId) };
}

/** The board if the caller can read it, else 404. */
export function requireReadableBoard(boardId: string, userId: string) {
  const board = readableBoard(boardId, userId);
  if (!board) throw boardNotFound();
  return board;
}

/** The board if the caller owns it; 404 for non-readers, 403 OWNER_ONLY for other readers. */
export function requireOwnedBoard(boardId: string, userId: string) {
  const board = requireReadableBoard(boardId, userId);
  if (board.owner_id !== userId) throw ownerOnly();
  return board;
}

export function createBoard(userId: string, name: string) {
  return db.transaction(() => {
    const owned = (db.query("SELECT COUNT(*) AS count FROM boards WHERE owner_id = ? AND deleted_at IS NULL").get(userId) as { count: number }).count;
    if (owned >= LIMITS.boardsPerOwner) throw limitReached(`You can have up to ${LIMITS.boardsPerOwner} boards`);
    const id = crypto.randomUUID();
    const timestamp = now();
    db.query("INSERT INTO boards (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, name, timestamp, timestamp);
    const insertColumn = db.query("INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    DEFAULT_COLUMNS.forEach((columnName, index) => insertColumn.run(crypto.randomUUID(), id, columnName, (index + 1) * 1024, timestamp, timestamp));
    audit(userId, null, "task.board_create", { boardId: id });
    return { board: boardSummary(id, userId)!, columns: listColumns(id) };
  })();
}

export function renameBoard(userId: string, boardId: string, name: string) {
  return withBoardLock(boardId, () => {
    requireOwnedBoard(boardId, userId);
    db.transaction(() => {
      db.query("UPDATE boards SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(name, now(), boardId);
      audit(userId, null, "task.board_rename", { boardId });
    })();
    return { board: boardSummary(boardId, userId)! };
  });
}

/**
 * Moves a board to the Bin (owner only). Stage A sets the Bin columns only;
 * restore, purge, and the Bin listing arrive with Task Boards stage D.
 */
export function deleteBoard(userId: string, boardId: string) {
  return withBoardLock(boardId, () => {
    requireOwnedBoard(boardId, userId);
    const deletedAt = new Date();
    const purgeAfter = purgeAfterFrom(deletedAt);
    db.transaction(() => {
      db.query("UPDATE boards SET deleted_at = ?, deleted_by = ?, purge_after = ? WHERE id = ? AND deleted_at IS NULL")
        .run(deletedAt.toISOString(), userId, purgeAfter, boardId);
      audit(userId, null, "task.board_delete", { boardId });
    })();
    return { ok: true as const, purgeAfter };
  });
}

export function getSharing(userId: string, boardId: string) {
  const board = requireOwnedBoard(boardId, userId);
  const users = db.query("SELECT u.id, u.display_name FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY u.display_name")
    .all(boardId) as Array<{ id: string; display_name: string }>;
  return { visibility: board.visibility, users };
}

/** Replaces the audience, like folder sharing: members are kept only for `selected`. */
export async function putSharing(userId: string, boardId: string, visibility: BoardVisibility, userIds: string[]) {
  requireOwnedBoard(boardId, userId);
  if (userIds.includes(userId)) throw new TaskError(400, "The owner cannot be added as a recipient");
  const uniqueIds = [...new Set(userIds)];
  if (visibility === "selected" && uniqueIds.length === 0) throw new TaskError(400, "Select at least one user");
  if (uniqueIds.length) {
    const placeholders = uniqueIds.map(() => "?").join(",");
    const validUsers = db.query(`SELECT id FROM users WHERE disabled_at IS NULL AND id IN (${placeholders})`).all(...uniqueIds);
    if (validUsers.length !== uniqueIds.length) throw new TaskError(400, "One or more users were not found");
  }
  return withBoardLock(boardId, () => {
    requireOwnedBoard(boardId, userId);
    db.transaction(() => {
      db.query("DELETE FROM board_members WHERE board_id = ?").run(boardId);
      if (visibility === "selected") {
        const statement = db.query("INSERT INTO board_members (board_id, user_id, created_at) VALUES (?, ?, ?)");
        for (const recipientId of uniqueIds) statement.run(boardId, recipientId, now());
      }
      db.query("UPDATE boards SET visibility = ?, updated_at = ? WHERE id = ?").run(visibility, now(), boardId);
      audit(userId, null, "task.board_sharing_changed", { boardId, visibility, recipientCount: visibility === "selected" ? uniqueIds.length : 0 });
    })();
    return { ok: true as const };
  });
}

function applyRenumber(table: "board_columns" | "cards", renumbered: Positioned[] | null) {
  if (!renumbered) return false;
  const statement = db.query(`UPDATE ${table} SET position = ? WHERE id = ?`);
  for (const item of renumbered) statement.run(item.position, item.id);
  return true;
}

export function createColumn(userId: string, boardId: string, input: { name: string; afterColumnId?: string | null }) {
  return withBoardLock(boardId, () => {
    requireOwnedBoard(boardId, userId);
    const columns = listColumns(boardId);
    if (columns.length >= LIMITS.columnsPerBoard) throw limitReached(`A board can have up to ${LIMITS.columnsPerBoard} columns`);
    const plan = planInsert(columns, input.afterColumnId);
    if (!plan) throw columnNotFound();
    const id = crypto.randomUUID();
    db.transaction(() => {
      applyRenumber("board_columns", plan.renumbered);
      const timestamp = now();
      db.query("INSERT INTO board_columns (id, board_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, boardId, input.name, plan.position, timestamp, timestamp);
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(timestamp, boardId);
      audit(userId, null, "task.column_create", { boardId, columnId: id });
    })();
    return { column: listColumns(boardId).find((column) => column.id === id)!, columns: listColumns(boardId) };
  });
}

/** Resolves a column path id to its board and checks ownership (404 / 403). */
function requireOwnedColumn(columnId: string, userId: string) {
  const found = readableColumn(columnId, userId);
  if (!found) throw columnNotFound();
  if (found.board.owner_id !== userId) throw ownerOnly();
  return found;
}

export async function patchColumn(userId: string, columnId: string, input: { name?: string; afterColumnId?: string | null }) {
  const { board } = requireOwnedColumn(columnId, userId);
  return withBoardLock(board.id, () => {
    requireOwnedColumn(columnId, userId);
    const siblings = listColumns(board.id).filter((column) => column.id !== columnId);
    let plan = null as ReturnType<typeof planInsert>;
    if (input.afterColumnId !== undefined) {
      if (input.afterColumnId === columnId) throw new TaskError(400, "A column cannot be placed after itself");
      plan = planInsert(siblings, input.afterColumnId);
      if (!plan) throw columnNotFound();
    }
    db.transaction(() => {
      const timestamp = now();
      if (input.name !== undefined) {
        db.query("UPDATE board_columns SET name = ?, updated_at = ? WHERE id = ?").run(input.name, timestamp, columnId);
        audit(userId, null, "task.column_rename", { boardId: board.id, columnId });
      }
      if (plan) {
        applyRenumber("board_columns", plan.renumbered);
        db.query("UPDATE board_columns SET position = ?, updated_at = ? WHERE id = ?").run(plan.position, timestamp, columnId);
        audit(userId, null, "task.column_move", { boardId: board.id, columnId });
      }
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(timestamp, board.id);
    })();
    const columns = listColumns(board.id);
    return { column: columns.find((column) => column.id === columnId)!, columns, ...(plan?.renumbered ? { renormalized: true } : {}) };
  });
}

/**
 * Deletes an empty column (owner only). Binned cards that sat in it keep
 * `column_id = NULL` and restore to the first column (stage D).
 */
export async function deleteColumn(userId: string, columnId: string) {
  const { board } = requireOwnedColumn(columnId, userId);
  return withBoardLock(board.id, () => {
    requireOwnedColumn(columnId, userId);
    const liveCards = (db.query("SELECT COUNT(*) AS count FROM cards WHERE column_id = ? AND deleted_at IS NULL").get(columnId) as { count: number }).count;
    if (liveCards > 0) throw new TaskError(409, "Move or delete the cards in this column first", "COLUMN_NOT_EMPTY", { cardCount: liveCards });
    const columnCount = (db.query("SELECT COUNT(*) AS count FROM board_columns WHERE board_id = ?").get(board.id) as { count: number }).count;
    if (columnCount <= 1) throw new TaskError(409, "A board needs at least one column", "LAST_COLUMN");
    db.transaction(() => {
      db.query("DELETE FROM board_columns WHERE id = ?").run(columnId);
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(now(), board.id);
      audit(userId, null, "task.column_delete", { boardId: board.id, columnId });
    })();
    return { ok: true as const, columns: listColumns(board.id) };
  });
}

// ---------------------------------------------------------------------------
// Cards (readers). Every change runs under the board lock.

export type CardDetail = CardSummary & { description: string };

const cardNotFound = () => new TaskError(404, "Card not found");

function cardDetail(cardId: string) {
  return db.query(`${cardDetailSelect} WHERE k.id = ? AND k.deleted_at IS NULL`)
    .get(cardId) as CardDetail | null;
}

function liveCardsIn(columnId: string) {
  return db.query("SELECT id, position FROM cards WHERE column_id = ? AND deleted_at IS NULL ORDER BY position, id").all(columnId) as Positioned[];
}

/** 409 STALE_POSITION: the anchor is not a live card in the target column. Carries the column's current order. */
function stalePosition(columnId: string) {
  return new TaskError(409, "The board changed. Reload to see the current order.", "STALE_POSITION", {
    columnId,
    order: liveCardsIn(columnId).map((card) => card.id)
  });
}

/** A column of this board (path and body ids are joined to their board, T39). */
function requireBoardColumn(boardId: string, columnId: string) {
  const column = db.query("SELECT id FROM board_columns WHERE id = ? AND board_id = ?").get(columnId, boardId) as { id: string } | null;
  if (!column) throw columnNotFound();
  return column;
}

function requireReadableCard(cardId: string, userId: string) {
  const found = readableCard(cardId, userId);
  if (!found) throw cardNotFound();
  return found;
}

export type CardCreateInput = { columnId: string; title: string; description?: string; afterCardId?: string | null };

/** Creates a card. `afterCardId`: omitted = bottom of the column, null = top, an id = after that card. */
export function createCard(userId: string, boardId: string, input: CardCreateInput) {
  return withBoardLock(boardId, () => {
    requireReadableBoard(boardId, userId);
    requireBoardColumn(boardId, input.columnId);
    const live = (db.query("SELECT COUNT(*) AS count FROM cards WHERE board_id = ? AND deleted_at IS NULL").get(boardId) as { count: number }).count;
    if (live >= LIMITS.liveCardsPerBoard) throw limitReached(`A board can have up to ${LIMITS.liveCardsPerBoard} cards`);
    const plan = planInsert(liveCardsIn(input.columnId), input.afterCardId);
    if (!plan) throw stalePosition(input.columnId);
    const id = crypto.randomUUID();
    db.transaction(() => {
      applyRenumber("cards", plan.renumbered);
      const timestamp = now();
      db.query(`INSERT INTO cards (id, board_id, column_id, position, title, description, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, boardId, input.columnId, plan.position, input.title, input.description ?? "", userId, timestamp, timestamp);
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(timestamp, boardId);
      audit(userId, null, "task.card_create", { boardId, cardId: id });
    })();
    return { card: cardDetail(id)!, ...(plan.renumbered ? { renormalized: true } : {}) };
  });
}

/** Comments and attachments arrive with stages B and C; both lists are empty until then. */
export function getCard(userId: string, cardId: string) {
  requireReadableCard(cardId, userId);
  return { card: cardDetail(cardId)!, comments: [] as unknown[], attachments: [] as unknown[] };
}

export type CardPatchInput = { title?: string; description?: string; revision: number };

/** Edits title and/or description with a compare-and-swap on `revision` (409 CARD_CHANGED carries the current card). */
export async function patchCard(userId: string, cardId: string, input: CardPatchInput) {
  const { board } = requireReadableCard(cardId, userId);
  return withBoardLock(board.id, () => {
    const { card } = requireReadableCard(cardId, userId);
    if (card.revision !== input.revision) {
      throw new TaskError(409, "Someone else changed this card", "CARD_CHANGED", { card: cardDetail(cardId)! });
    }
    db.transaction(() => {
      const timestamp = now();
      const updated = db.query(`UPDATE cards SET title = COALESCE(?, title), description = COALESCE(?, description), revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`).run(input.title ?? null, input.description ?? null, timestamp, cardId, input.revision);
      if (updated.changes !== 1) throw new Error("Concurrent card update detected");
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(timestamp, board.id);
      audit(userId, null, "task.card_update", { boardId: board.id, cardId });
    })();
    return { card: cardDetail(cardId)! };
  });
}

/**
 * Moves a card within its board (cross-board moves are out of scope).
 * `afterCardId` null puts the card at the top; otherwise it must be another
 * live card in the target column, or the response is 409 STALE_POSITION with
 * the column's current order. Moves do not change `revision`.
 */
export async function moveCard(userId: string, cardId: string, input: { columnId: string; afterCardId: string | null }) {
  const { board } = requireReadableCard(cardId, userId);
  return withBoardLock(board.id, () => {
    requireReadableCard(cardId, userId);
    requireBoardColumn(board.id, input.columnId);
    if (input.afterCardId === cardId) throw stalePosition(input.columnId);
    const siblings = liveCardsIn(input.columnId).filter((card) => card.id !== cardId);
    const plan = planInsert(siblings, input.afterCardId);
    if (!plan) throw stalePosition(input.columnId);
    db.transaction(() => {
      applyRenumber("cards", plan.renumbered);
      const timestamp = now();
      db.query("UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(input.columnId, plan.position, timestamp, cardId);
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(timestamp, board.id);
      audit(userId, null, "task.card_move", { boardId: board.id, cardId, columnId: input.columnId });
    })();
    return {
      card: cardDetail(cardId)!,
      ...(plan.renumbered ? { renormalized: true, positions: liveCardsIn(input.columnId) } : {})
    };
  });
}

/**
 * Moves a card to the Bin (any reader, D41). Stage A sets the Bin columns
 * only; the card keeps its column so a later restore can put it back.
 */
export async function deleteCard(userId: string, cardId: string) {
  const { board } = requireReadableCard(cardId, userId);
  return withBoardLock(board.id, () => {
    requireReadableCard(cardId, userId);
    const deletedAt = new Date();
    const purgeAfter = purgeAfterFrom(deletedAt);
    db.transaction(() => {
      db.query("UPDATE cards SET deleted_at = ?, deleted_by = ?, purge_after = ? WHERE id = ? AND deleted_at IS NULL")
        .run(deletedAt.toISOString(), userId, purgeAfter, cardId);
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(deletedAt.toISOString(), board.id);
      audit(userId, null, "task.card_delete", { boardId: board.id, cardId });
    })();
    return { ok: true as const, purgeAfter };
  });
}
