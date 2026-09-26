import { audit, db, now } from "../db";
import { purgeAfterFrom } from "../bin";
import { withResourceLock } from "../storage";
import { readableBoard, readableBoardPredicate, readableCard, readableColumn, type BoardVisibility, type ColumnRow } from "./access";
import { assigneesForBoard, assigneesForCard, MAX_ASSIGNEES, newAssignees, replaceAssignees, type CardAssignee } from "./assignees";
import { planInsert, type Positioned } from "./boardOrder";
import { dueAt, resolveDue, type DueInput } from "./dueTime";
import { linkAttachments } from "./attachments";
import { insertRelation } from "./cardRelations";
import { descriptionExcerpt } from "./excerpt";
import type { RelationType } from "./relations";
import { flagsForBoard, flagsForCard, listBoardTags, replaceCardFlags, replaceCardTags, requireCardTags, tagIdsForBoard, tagIdsForCard, type CardFlag } from "./tags";

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

export const LIMITS = { boardsPerOwner: 50, columnsPerBoard: 20, liveCardsPerBoard: 1000, commentsPerCard: 500, attachmentsPerCard: 50, attachmentsPerComment: 10 } as const;
export const DEFAULT_COLUMNS = ["To do", "Doing", "Done"] as const;

const boardNotFound = () => new TaskError(404, "Board not found");
const columnNotFound = () => new TaskError(404, "Column not found");
export const ownerOnly = () => new TaskError(403, "Only the board owner can do this", "OWNER_ONLY");
export const limitReached = (message: string) => new TaskError(409, message, "LIMIT_REACHED");

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

export type ColumnSummary = Pick<ColumnRow, "id" | "board_id" | "name" | "position" | "is_done" | "wip_limit" | "created_at" | "updated_at">;

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
  return db.query("SELECT id, board_id, name, position, is_done, wip_limit, created_at, updated_at FROM board_columns WHERE board_id = ? ORDER BY position, id")
    .all(boardId) as ColumnSummary[];
}

/**
 * A card as shown on the board: no description (up to 64 KiB each), only
 * whether one exists and a short plain-text excerpt, plus comment and
 * attachment counts.
 */
export type CardSummary = {
  id: string;
  board_id: string;
  column_id: string;
  position: number;
  title: string;
  has_description: 0 | 1;
  /** Plain text of the description, at most 160 characters (D111); '' without one. */
  description_excerpt: string;
  revision: number;
  created_by: string | null;
  creator_name: string | null;
  /** Calendar date YYYY-MM-DD (migration 011); the civil date in `due_tz` when a time is set. */
  due_on: string | null;
  /** Optional wall time `HH:MM` in `due_tz` (D100); both NULL or both set. */
  due_time: string | null;
  /** The IANA zone the setter's browser sent (D101). */
  due_tz: string | null;
  /** The computed UTC instant when `due_time` is set, else null. */
  due_at: string | null;
  /** Every assignee, in assignment order, at most 20 (D102). */
  assignees: CardAssignee[];
  /** Deprecated (D103): the first assignee's id, kept for one release. */
  assignee_id: string | null;
  /** Deprecated (D103): the first assignee's display name. */
  assignee_name: string | null;
  /** Tag ids of this board, at most 10, in tagging order; resolve against the board's `tags` (D109). */
  tag_ids: string[];
  /** Flags from the fixed set, in its order (D110). */
  flags: CardFlag[];
  comment_count: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

const cardSelect = (extraColumns = "") => `
  SELECT k.id, k.board_id, k.column_id, k.position, k.title,
         CASE WHEN k.description <> '' THEN 1 ELSE 0 END AS has_description,
         k.description_excerpt, k.revision, k.created_by, cu.display_name AS creator_name,
         k.due_on, k.due_time, k.due_tz,
         (SELECT COUNT(*) FROM card_comments cc WHERE cc.card_id = k.id) AS comment_count,
         (SELECT COUNT(*) FROM card_attachments ca WHERE ca.card_id = k.id) AS attachment_count,
         k.created_at, k.updated_at${extraColumns}
  FROM cards k LEFT JOIN users cu ON cu.id = k.created_by
`;
const cardSummarySelect = cardSelect();
const cardDetailSelect = cardSelect(", k.description");

/** A selected card row before its computed and grouped fields (due instant, assignees) are attached. */
type SelectedCard = Omit<CardSummary, "due_at" | "assignees" | "assignee_id" | "assignee_name" | "tag_ids" | "flags">;
type GroupedFields = { assignees: CardAssignee[]; tagIds: string[]; flags: CardFlag[] };

/** Adds the computed and grouped fields; the deprecated `assignee_id`/`assignee_name` are the first assignee (D103). */
function withCardFields<T extends SelectedCard>(card: T, { assignees, tagIds, flags }: GroupedFields, instant: typeof dueAt = dueAt) {
  const first = assignees[0];
  return { ...card, due_at: instant(card), assignees, assignee_id: first?.id ?? null, assignee_name: first?.display_name ?? null, tag_ids: tagIds, flags };
}

/** The due fields after a change, or 400 with the rule that failed (D100). */
function requireDue(current: Parameters<typeof resolveDue>[0], input: DueInput) {
  const resolved = resolveDue(current, input);
  if ("error" in resolved) throw new TaskError(400, resolved.error);
  return resolved;
}

export function listCards(boardId: string): CardSummary[] {
  const cards = db.query(`${cardSummarySelect} WHERE k.board_id = ? AND k.deleted_at IS NULL ORDER BY k.position, k.id`).all(boardId) as SelectedCard[];
  // One grouped query per concern over the board's live cards, never a per-card subquery (§3.1).
  const assignees = assigneesForBoard(boardId);
  const tags = tagIdsForBoard(boardId);
  const flags = flagsForBoard(boardId);
  // Cards often share a due date, time, and zone; each instant costs a few Intl calls (measured in 13C, D113).
  const instants = new Map<string, string | null>();
  const instant = (card: Parameters<typeof dueAt>[0]) => {
    if (!card.due_time) return null;
    const key = `${card.due_on}T${card.due_time} ${card.due_tz}`;
    if (!instants.has(key)) instants.set(key, dueAt(card));
    return instants.get(key)!;
  };
  return cards.map((card) => withCardFields(card, { assignees: assignees.get(card.id) ?? [], tagIds: tags.get(card.id) ?? [], flags: flags.get(card.id) ?? [] }, instant));
}

export function getBoard(userId: string, boardId: string) {
  requireReadableBoard(boardId, userId);
  return { board: boardSummary(boardId, userId)!, columns: listColumns(boardId), cards: listCards(boardId), tags: listBoardTags(boardId) };
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
    const insertColumn = db.query("INSERT INTO board_columns (id, board_id, name, position, is_done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    // The default "Done" column is a done column (D53), as the 011 backfill does for existing boards.
    DEFAULT_COLUMNS.forEach((columnName, index) => insertColumn.run(crypto.randomUUID(), id, columnName, (index + 1) * 1024, columnName === "Done" ? 1 : 0, timestamp, timestamp));
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

export function applyRenumber(table: "board_columns" | "cards", renumbered: Positioned[] | null) {
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

export async function patchColumn(userId: string, columnId: string, input: { name?: string; afterColumnId?: string | null; isDone?: boolean; wipLimit?: number | null }) {
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
      if (input.isDone !== undefined) {
        db.query("UPDATE board_columns SET is_done = ?, updated_at = ? WHERE id = ?").run(input.isDone ? 1 : 0, timestamp, columnId);
        audit(userId, null, "task.column_done", { boardId: board.id, columnId, isDone: input.isDone });
      }
      if (input.wipLimit !== undefined) {
        // A limit may be set below the current count; it only blocks cards coming in (D108).
        db.query("UPDATE board_columns SET wip_limit = ?, updated_at = ? WHERE id = ?").run(input.wipLimit, timestamp, columnId);
        audit(userId, null, "task.column_wip", { boardId: board.id, columnId, wipLimit: input.wipLimit });
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

export const cardNotFound = () => new TaskError(404, "Card not found");

export function cardDetail(cardId: string): CardDetail | null {
  const card = db.query(`${cardDetailSelect} WHERE k.id = ? AND k.deleted_at IS NULL`).get(cardId) as (SelectedCard & { description: string }) | null;
  return card ? withCardFields(card, { assignees: assigneesForCard(cardId), tagIds: tagIdsForCard(cardId), flags: flagsForCard(cardId) }) : null;
}

export function liveCardsIn(columnId: string) {
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
  const column = db.query("SELECT id, wip_limit FROM board_columns WHERE id = ? AND board_id = ?").get(columnId, boardId) as { id: string; wip_limit: number | null } | null;
  if (!column) throw columnNotFound();
  return column;
}

/**
 * 409 COLUMN_FULL when a card would come into a column at or over its WIP
 * limit (D108, T96). Called under the board lock for creates and for moves
 * from another column only: moving within a column, moving out, and Bin
 * restore are always allowed. Every live card in the column counts.
 */
function requireColumnRoom(column: { id: string; wip_limit: number | null }) {
  if (column.wip_limit === null) return;
  const cardCount = liveCardsIn(column.id).length;
  if (cardCount >= column.wip_limit) {
    throw new TaskError(409, `This column is full (limit ${column.wip_limit})`, "COLUMN_FULL", { columnId: column.id, wipLimit: column.wip_limit, cardCount });
  }
}

export function requireReadableCard(cardId: string, userId: string) {
  const found = readableCard(cardId, userId);
  if (!found) throw cardNotFound();
  return found;
}

export type CardCreateInput = {
  columnId: string; title: string; description?: string; dueOn?: string | null; afterCardId?: string | null;
  dueTime?: string | null; dueTz?: string | null;
  assigneeIds?: string[];
  /** Tags of this board (D109), at most 10 after deduplication. */
  tagIds?: string[];
  /** Unique flags from the fixed set (D110). */
  flags?: CardFlag[];
  /** Relations from the new card toward readable cards, as POST /cards/:k/relations creates them (D104–D107). */
  relations?: Array<{ targetCardId: string; type: RelationType }>;
  /** The caller's own task-attachment uploads that no card links yet. */
  attachmentIds?: string[];
};

/**
 * Creates a card. `afterCardId`: omitted = bottom of the column, null = top, an id = after that card.
 * Assignees, tags, flags, relations, and attachments are written in the same transaction, after
 * the WIP check, so any refusal writes nothing.
 */
export function createCard(userId: string, boardId: string, input: CardCreateInput) {
  return withBoardLock(boardId, () => {
    requireReadableBoard(boardId, userId);
    const column = requireBoardColumn(boardId, input.columnId);
    requireColumnRoom(column);
    const assignees = input.assigneeIds === undefined ? undefined : uniqueAssignees(input.assigneeIds);
    for (const assigneeId of assignees ?? []) requireAssignableUser(boardId, assigneeId);
    const tagIds = input.tagIds === undefined ? undefined : requireCardTags(boardId, input.tagIds);
    const due = requireDue({ due_on: null, due_time: null, due_tz: null }, input).value;
    const live = (db.query("SELECT COUNT(*) AS count FROM cards WHERE board_id = ? AND deleted_at IS NULL").get(boardId) as { count: number }).count;
    if (live >= LIMITS.liveCardsPerBoard) throw limitReached(`A board can have up to ${LIMITS.liveCardsPerBoard} cards`);
    const attachmentIds = input.attachmentIds === undefined ? [] : [...new Set(input.attachmentIds.map((documentId) => documentId.toLowerCase()))];
    const plan = planInsert(liveCardsIn(input.columnId), input.afterCardId);
    if (!plan) throw stalePosition(input.columnId);
    const id = crypto.randomUUID();
    db.transaction(() => {
      applyRenumber("cards", plan.renumbered);
      const timestamp = now();
      const description = input.description ?? "";
      db.query(`INSERT INTO cards (id, board_id, column_id, position, title, description, description_excerpt, due_on, due_time, due_tz, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, boardId, input.columnId, plan.position, input.title, description, descriptionExcerpt(description), due.due_on, due.due_time, due.due_tz, userId, timestamp, timestamp);
      if (assignees?.length) replaceAssignees(id, assignees, userId, timestamp);
      if (tagIds?.length) replaceCardTags(id, tagIds, timestamp);
      if (input.flags?.length) replaceCardFlags(id, input.flags, timestamp);
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(timestamp, boardId);
      audit(userId, null, "task.card_create", {
        boardId, cardId: id,
        ...(assignees?.length ? { assigneesAdded: assignees.length } : {}),
        ...(tagIds?.length ? { tagsAdded: tagIds.length } : {}),
        ...(input.flags?.length ? { flags: input.flags } : {})
      });
      // Same checks as POST /cards/:k/relations: the target must be readable (404 like a missing id), one per pair, 50 per card.
      for (const relation of input.relations ?? []) {
        const inserted = insertRelation(userId, id, relation.targetCardId.toLowerCase(), relation.type);
        audit(userId, null, "task.relation_create", { boardId, cardId: id, relationId: inserted.id, kind: inserted.kind });
      }
      if (attachmentIds.length) {
        // Only the uploader's own files (404 like a missing id otherwise), and only ones no card links yet.
        const owned = db.query("SELECT 1 FROM documents WHERE id = ? AND owner_id = ? AND purpose = 'task_attachment' AND deleted_at IS NULL");
        const linked = db.query("SELECT 1 FROM card_attachments WHERE document_id = ?");
        for (const documentId of attachmentIds) {
          if (!owned.get(documentId, userId)) throw new TaskError(404, "File not found");
          if (linked.get(documentId)) throw new TaskError(409, "This file is already attached to a card", "ATTACHMENT_LINKED", { documentId });
        }
        linkAttachments({ userId, cardId: id, documentIds: attachmentIds, commentId: null });
        for (const documentId of attachmentIds) audit(userId, null, "task.attachment_link", { boardId, cardId: id, documentId });
      }
    })();
    return { card: cardDetail(id)!, ...(plan.renumbered ? { renormalized: true } : {}) };
  });
}

/** The card alone; routes add its comments page and attachments (server/tasks/comments.ts, attachments.ts). */
export function getCard(userId: string, cardId: string) {
  const found = requireReadableCard(cardId, userId);
  return { card: cardDetail(cardId)!, board: found.board };
}

export type CardPatchInput = {
  title?: string; description?: string; dueOn?: string | null;
  /** `HH:MM` with `dueTz`, or null to clear the time (D100). */
  dueTime?: string | null;
  dueTz?: string | null;
  /** Legacy (D103): `id` means `[id]`, `null` means `[]`. Not together with `assigneeIds`. */
  assigneeId?: string | null;
  /** Replaces the whole set; `[]` clears it. */
  assigneeIds?: string[];
  /** Replaces the whole tag set with tags of the card's board; `[]` clears it (D109). */
  tagIds?: string[];
  /** Replaces the whole flag set; `[]` clears it (D110). */
  flags?: CardFlag[];
  revision: number;
};

export const READERS_UNFILTERED_LIMIT = 200;
export const READERS_DEFAULT_LIMIT = 20;

/**
 * Users who can read the board, for the assignee picker: the owner plus the
 * members (`selected`), or every enabled user (`all_users`), display names
 * only (T92). Without `q`, at most 200 by name, as before. With `q`, a
 * case-insensitive `instr` match on the display name (no LIKE wildcards),
 * at most `limit`. `truncated` says more matched.
 */
export function listBoardReaders(userId: string, boardId: string, options: { q?: string; limit?: number } = {}) {
  const board = requireReadableBoard(boardId, userId);
  const q = options.q ?? "";
  const limit = q ? options.limit ?? READERS_DEFAULT_LIMIT : READERS_UNFILTERED_LIMIT;
  const match = "($q = '' OR instr(lower(u.display_name), lower($q)) > 0)";
  const rows = (board.visibility === "all_users"
    ? db.query(`SELECT u.id, u.display_name FROM users u WHERE u.disabled_at IS NULL AND ${match} ORDER BY u.display_name, u.id LIMIT $limit`).all({ q, limit: limit + 1 })
    : db.query(`SELECT u.id, u.display_name FROM users u WHERE u.disabled_at IS NULL AND (u.id = $ownerId
        OR ($visibility = 'selected' AND EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = $boardId AND m.user_id = u.id)))
        AND ${match} ORDER BY u.display_name, u.id LIMIT $limit`).all({ ownerId: board.owner_id, visibility: board.visibility, boardId, q, limit: limit + 1 })
  ) as Array<{ id: string; display_name: string }>;
  return {
    users: rows.slice(0, limit).map((row) => ({ id: row.id, displayName: row.display_name })),
    truncated: rows.length > limit
  };
}

/** Deduplicated ids, in the order given; 400 above the cap. */
function uniqueAssignees(ids: readonly string[]) {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (unique.length > MAX_ASSIGNEES) throw new TaskError(400, `A card can have up to ${MAX_ASSIGNEES} assignees`);
  return unique;
}

/** The requested assignee set of a patch, or undefined when it leaves assignees alone (D103). */
function requestedAssignees(input: Pick<CardPatchInput, "assigneeId" | "assigneeIds">) {
  if (input.assigneeId !== undefined && input.assigneeIds !== undefined) {
    throw new TaskError(400, "Send assigneeIds or the legacy assigneeId, not both");
  }
  if (input.assigneeIds !== undefined) return uniqueAssignees(input.assigneeIds);
  if (input.assigneeId !== undefined) return input.assigneeId ? [input.assigneeId.toLowerCase()] : [];
  return undefined;
}

/** 400 ASSIGNEE_NOT_MEMBER unless the user is enabled and can read the board (D53). */
function requireAssignableUser(boardId: string, assigneeId: string) {
  const enabled = db.query("SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL").get(assigneeId);
  if (!enabled || !readableBoard(boardId, assigneeId)) {
    throw new TaskError(400, "The assignee must be able to open this board", "ASSIGNEE_NOT_MEMBER");
  }
}

/**
 * Edits title, description, due date, assignees, tags, and/or flags with a compare-and-swap
 * on `revision` (409 CARD_CHANGED carries the current card). Every field
 * changes in one transaction and `revision` goes up by exactly 1 (D107).
 * `dueOn` accepts null to clear; `assigneeIds` replaces the whole set. Only
 * users being added must be able to read the board, so a former member can
 * stay until someone removes them (T93).
 */
export async function patchCard(userId: string, cardId: string, input: CardPatchInput) {
  const { board } = requireReadableCard(cardId, userId);
  return withBoardLock(board.id, () => {
    const { card } = requireReadableCard(cardId, userId);
    if (card.revision !== input.revision) {
      throw new TaskError(409, "Someone else changed this card", "CARD_CHANGED", { card: cardDetail(cardId)! });
    }
    const assignees = requestedAssignees(input);
    for (const assigneeId of assignees ? newAssignees(cardId, assignees) : []) requireAssignableUser(board.id, assigneeId);
    const tagIds = input.tagIds === undefined ? undefined : requireCardTags(board.id, input.tagIds);
    const setDue = input.dueOn !== undefined || input.dueTime !== undefined || input.dueTz !== undefined;
    const due = setDue ? requireDue(card, input) : null;
    db.transaction(() => {
      const timestamp = now();
      const updated = db.query(`UPDATE cards SET title = COALESCE($title, title), description = COALESCE($description, description),
          description_excerpt = COALESCE($excerpt, description_excerpt),
          due_on = CASE WHEN $setDue THEN $dueOn ELSE due_on END,
          due_time = CASE WHEN $setDue THEN $dueTime ELSE due_time END,
          due_tz = CASE WHEN $setDue THEN $dueTz ELSE due_tz END,
          revision = revision + 1, updated_at = $timestamp
        WHERE id = $cardId AND revision = $revision AND deleted_at IS NULL`).run({
        title: input.title ?? null,
        description: input.description ?? null,
        // Every description write refreshes the excerpt (D111).
        excerpt: input.description === undefined ? null : descriptionExcerpt(input.description),
        setDue: due ? 1 : 0,
        dueOn: due?.value.due_on ?? null,
        dueTime: due?.value.due_time ?? null,
        dueTz: due?.value.due_tz ?? null,
        timestamp,
        cardId,
        revision: input.revision
      });
      if (updated.changes !== 1) throw new Error("Concurrent card update detected");
      const changed = assignees ? replaceAssignees(cardId, assignees, userId, timestamp) : null;
      const tagsChanged = tagIds ? replaceCardTags(cardId, tagIds, timestamp) : null;
      if (input.flags) replaceCardFlags(cardId, input.flags, timestamp);
      db.query("UPDATE boards SET updated_at = ? WHERE id = ?").run(timestamp, board.id);
      audit(userId, null, "task.card_update", {
        boardId: board.id, cardId,
        ...(input.dueOn !== undefined ? { dueOn: input.dueOn } : {}),
        ...(due?.timeChange ? { dueTime: due.timeChange } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(changed ? { assigneesAdded: changed.added.length, assigneesRemoved: changed.removed.length } : {}),
        ...(tagsChanged ? { tagsAdded: tagsChanged.added.length, tagsRemoved: tagsChanged.removed.length } : {}),
        ...(input.flags ? { flags: input.flags } : {})
      });
    })();
    return { card: cardDetail(cardId)! };
  });
}

/**
 * Moves a card within its board (cross-board moves are out of scope).
 * `afterCardId` null puts the card at the top and omitted at the bottom; otherwise it must be another
 * live card in the target column, or the response is 409 STALE_POSITION with
 * the column's current order. Moves do not change `revision`.
 */
export async function moveCard(userId: string, cardId: string, input: { columnId: string; afterCardId?: string | null }) {
  const { board } = requireReadableCard(cardId, userId);
  return withBoardLock(board.id, () => {
    const { card } = requireReadableCard(cardId, userId);
    const column = requireBoardColumn(board.id, input.columnId);
    if (card.column_id !== column.id) requireColumnRoom(column);
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
