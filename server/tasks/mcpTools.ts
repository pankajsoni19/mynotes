import * as z from "zod/v4";
import type { ZodType } from "zod";
import { withAuditContext } from "../db";
import { defineTool, McpToolError, type McpErrorCode, type McpKeyContext, type McpToolSpec } from "../mcpToolKit";
import { searchText } from "../search";
import { listAttachments } from "./attachments";
import { createComment, listComments } from "./comments";
import { cardCreateSchema, cardMoveSchema, commentCreateSchema } from "./routes";
import { cardDetail, createCard, getBoard, getCard, listBoards, moveCard, TaskError, type CardSummary } from "./service";

/**
 * MCP tools for Task Boards (docs/plan/WAVES_7-9.md §4.2, D38–D40, D70).
 *
 * Every tool calls the same service functions as the /api/tasks routes, as the
 * key's owner, so board membership, owner-only rules, IDOR joins, ordering,
 * and caps are enforced in one place. A board the user cannot read is
 * NOT_FOUND whether it is missing, private, or binned. There are no delete,
 * edit-description, column, or sharing tools: writes are create, move, and
 * comment only. Writes are audited through the usual task.* events with
 * `{via: "mcp", keyId}` merged in, and count against the per-key and per-user
 * `task_write` daily buckets.
 */

const DESCRIPTION_PREVIEW_CHARS = 280;

/** Maps a TaskError to the MCP error shape, keeping its code and extra fields (for example STALE_POSITION's order). */
export function taskErrorToMcp(error: TaskError) {
  const known: Partial<Record<string, McpErrorCode>> = {
    STALE_POSITION: "STALE_POSITION",
    LIMIT_REACHED: "LIMIT_REACHED",
    CARD_CHANGED: "CARD_CHANGED",
    OWNER_ONLY: "OWNER_ONLY"
  };
  const code = (error.code ? known[error.code] : undefined) ?? (error.status === 404 ? "NOT_FOUND" : error.status === 400 ? "INVALID" : "INTERNAL");
  return new McpToolError(code, error.message, error.extra);
}

async function service<T>(key: McpKeyContext, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await withAuditContext({ via: "mcp", keyId: key.keyId }, operation);
  } catch (error) {
    if (error instanceof TaskError) throw taskErrorToMcp(error);
    throw error;
  }
}

/** Validates with the HTTP route's schema, so MCP accepts exactly what the API accepts. */
function routeInput<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new McpToolError("INVALID", "Invalid arguments", { details: parsed.error.issues.map((issue) => issue.message) });
  return parsed.data;
}

/** Card Markdown as plain text; the MCP client never receives markup to render. */
const plainText = (markdown: string) => searchText(markdown);

function preview(markdown: string) {
  const text = plainText(markdown).replace(/\s+/g, " ").trim();
  return text.length > DESCRIPTION_PREVIEW_CHARS ? `${text.slice(0, DESCRIPTION_PREVIEW_CHARS - 1)}…` : text;
}

const attachmentNames = (cardId: string) => listAttachments(cardId).map((attachment) => attachment.name);

type CardWithDescription = CardSummary & { description?: string };

function listedCard(card: CardWithDescription, columnName: string | undefined) {
  return {
    id: card.id,
    column_id: card.column_id,
    column_name: columnName ?? null,
    position: card.position,
    title: card.title,
    description_preview: card.description === undefined ? undefined : preview(card.description),
    revision: card.revision,
    creator_name: card.creator_name,
    due_on: card.due_on,
    assignee_name: card.assignee_name,
    comment_count: card.comment_count,
    attachments: attachmentNames(card.id),
    updated_at: card.updated_at
  };
}

const uuid = z.string().uuid();

export const taskTools: McpToolSpec[] = [
  defineTool({
    name: "list_boards",
    title: "List task boards",
    description: "List the task boards the user owns or is a member of, with card counts.",
    scopes: ["tasks:read"],
    write: false,
    inputSchema: z.object({}),
    handler: (_args, key) => ({ boards: listBoards(key.userId) })
  }),
  defineTool({
    name: "list_cards",
    title: "List cards on a board",
    description: "List a board's columns and its cards in order, optionally for one column. Descriptions are shortened plain text; attachments are file names only. Use get_card for a full card.",
    scopes: ["tasks:read"],
    write: false,
    inputSchema: z.object({ boardId: uuid, columnId: uuid.optional().describe("Only cards in this column") }),
    handler: async ({ boardId, columnId }, key) => service(key, () => {
      const { board, columns, cards } = getBoard(key.userId, boardId);
      if (columnId && !columns.some((column) => column.id === columnId)) throw new McpToolError("NOT_FOUND", "Column not found");
      const names = new Map(columns.map((column) => [column.id, column.name]));
      const selected = columnId ? cards.filter((card) => card.column_id === columnId) : cards;
      return {
        board: { id: board.id, name: board.name, owner_name: board.owner_name, is_owner: board.is_owner },
        columns: columns.map((column) => ({ id: column.id, name: column.name, position: column.position })),
        // Cards come from the board just authorized above.
        cards: selected.map((card) => listedCard(cardDetail(card.id) ?? card, names.get(card.column_id)))
      };
    })
  }),
  defineTool({
    name: "get_card",
    title: "Get a card",
    description: "Read one card: title, plain-text description, column, the latest comments, and attachment names.",
    scopes: ["tasks:read"],
    write: false,
    inputSchema: z.object({ cardId: uuid }),
    handler: async ({ cardId }, key) => service(key, () => {
      const { card, board } = getCard(key.userId, cardId);
      const { columns } = getBoard(key.userId, board.id);
      const page = listComments(key.userId, cardId);
      return {
        card: {
          id: card.id,
          board_id: board.id,
          board_name: board.name,
          column_id: card.column_id,
          column_name: columns.find((column) => column.id === card.column_id)?.name ?? null,
          title: card.title,
          description: plainText(card.description),
          revision: card.revision,
          creator_name: card.creator_name,
          due_on: card.due_on,
          assignee_name: card.assignee_name,
          created_at: card.created_at,
          updated_at: card.updated_at
        },
        comments: page.comments.map((comment) => ({ id: comment.id, author_name: comment.author_name, body: comment.body, created_at: comment.created_at, edited_at: comment.edited_at })),
        hasMoreComments: page.hasMore,
        attachments: attachmentNames(cardId)
      };
    })
  }),
  defineTool({
    name: "create_card",
    title: "Create a card",
    description: "Add a card to a column of a board the user can use. afterCardId: omit for the bottom, null for the top, or a card in that column to go after it.",
    scopes: ["tasks:write"],
    write: true,
    dailyBucket: "task_write",
    inputSchema: z.object({
      boardId: uuid,
      columnId: uuid,
      title: z.string().min(1).max(200),
      description: z.string().optional().describe("Markdown, up to 64 KiB"),
      dueOn: z.string().optional().describe("Due date as YYYY-MM-DD"),
      afterCardId: uuid.nullable().optional()
    }),
    handler: async ({ boardId, ...fields }, key) => {
      const input = routeInput(cardCreateSchema, fields);
      return service(key, async () => {
        const { card } = await createCard(key.userId, boardId, input);
        return { card: { id: card.id, board_id: card.board_id, column_id: card.column_id, title: card.title, due_on: card.due_on, revision: card.revision } };
      });
    }
  }),
  defineTool({
    name: "move_card",
    title: "Move a card",
    description: "Move a card to a column on the same board. afterCardId: omit for the bottom, null for the top, or a card in the target column. If the board changed, the call fails with STALE_POSITION and the column's current order.",
    scopes: ["tasks:write"],
    write: true,
    dailyBucket: "task_write",
    inputSchema: z.object({ cardId: uuid, columnId: uuid, afterCardId: uuid.nullable().optional() }),
    handler: async ({ cardId, columnId, afterCardId }, key) => {
      const input = afterCardId === undefined ? { columnId } : routeInput(cardMoveSchema, { columnId, afterCardId });
      return service(key, async () => {
        const { card } = await moveCard(key.userId, cardId, input);
        return { card: { id: card.id, column_id: card.column_id, position: card.position } };
      });
    }
  }),
  defineTool({
    name: "comment_on_card",
    title: "Comment on a card",
    description: "Add a comment, as the user, to a card on a board they can use. Plain text or Markdown, up to 16 KiB.",
    scopes: ["tasks:write"],
    write: true,
    dailyBucket: "task_write",
    inputSchema: z.object({ cardId: uuid, body: z.string().min(1) }),
    handler: async ({ cardId, body }, key) => {
      const input = routeInput(commentCreateSchema, { body });
      return service(key, async () => {
        const { comment } = await createComment(key.userId, cardId, input);
        return { comment: { id: comment.id, card_id: comment.card_id, created_at: comment.created_at } };
      });
    }
  })
];
