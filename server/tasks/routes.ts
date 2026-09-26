import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import { parseJson, uuid } from "../validation";
import { MAX_ASSIGNEES } from "./assignees";
import { attachToCard, detachFromCard, listAttachments } from "./attachments";
import { COMMENT_MAX_BYTES, COMMENT_PAGE_SIZE, createComment, deleteComment, listComments, updateComment } from "./comments";
import {
  createBoard,
  createCard,
  createColumn,
  deleteCard,
  getCard,
  moveCard,
  patchCard,
  deleteBoard,
  deleteColumn,
  getBoard,
  getSharing,
  listBoardReaders,
  listBoards,
  patchColumn,
  putSharing,
  renameBoard,
  TaskError
} from "./service";

// C0/C1 controls and bidi overrides never belong in a board, column, or card name.
const controlCharacters = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const label = (max: number) => z.string().trim().min(1).max(max).refine((value) => !controlCharacters.test(value), "Names cannot contain control characters");

export const boardNameSchema = z.object({ name: label(120) }).strict();
export const boardSharingSchema = z.object({
  visibility: z.enum(["private", "selected", "all_users"]),
  userIds: z.array(uuid).max(100).default([])
}).strict();
export const columnCreateSchema = z.object({ name: label(60), afterColumnId: uuid.nullable().optional() }).strict();
export const columnPatchSchema = z.object({ name: label(60).optional(), afterColumnId: uuid.nullable().optional(), isDone: z.boolean().optional() }).strict()
  .refine((value) => value.name !== undefined || value.afterColumnId !== undefined || value.isDone !== undefined, "Provide a name, an afterColumnId, or isDone");

/** A real calendar date `YYYY-MM-DD` between 1900 and 2999 (T71). */
export function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export const dueOnSchema = z.string().refine(isCalendarDate, "Use a real date as YYYY-MM-DD");

export const DESCRIPTION_MAX_BYTES = 65_536;
const description = z.string().refine((value) => Buffer.byteLength(value, "utf8") <= DESCRIPTION_MAX_BYTES, `Descriptions can be at most ${DESCRIPTION_MAX_BYTES} bytes`);
/** Assignee ids (D102): at most 20 after deduplication; the service dedupes and checks each can read the board. */
const assigneeIdsSchema = z.array(uuid).max(MAX_ASSIGNEES * 2);
export const cardCreateSchema = z.object({
  columnId: uuid,
  title: label(200),
  description: description.optional(),
  dueOn: dueOnSchema.nullable().optional(),
  assigneeIds: assigneeIdsSchema.optional(),
  afterCardId: uuid.nullable().optional()
}).strict();
export const cardPatchSchema = z.object({
  title: label(200).optional(),
  description: description.optional(),
  dueOn: dueOnSchema.nullable().optional(),
  /** Legacy (D103), kept for the Wave 10 client and MCP; 400 together with assigneeIds. */
  assigneeId: uuid.nullable().optional(),
  assigneeIds: assigneeIdsSchema.optional(),
  revision: z.number().int().positive()
}).strict()
  .refine((value) => value.assigneeId === undefined || value.assigneeIds === undefined, "Send assigneeIds or the legacy assigneeId, not both")
  .refine((value) => value.title !== undefined || value.description !== undefined || value.dueOn !== undefined || value.assigneeId !== undefined || value.assigneeIds !== undefined,
    "Provide a title, description, dueOn, or assigneeIds");
const commentBody = z.string().refine((value) => value.trim().length > 0, "Write a comment")
  .refine((value) => Buffer.byteLength(value, "utf8") <= COMMENT_MAX_BYTES, `Comments can be at most ${COMMENT_MAX_BYTES} bytes`);
export const commentCreateSchema = z.object({ body: commentBody, attachmentIds: z.array(uuid).max(10).optional() }).strict();
export const attachmentSchema = z.object({ documentId: uuid, commentId: uuid.nullable().optional() }).strict();
export const commentPatchSchema = z.object({ body: commentBody }).strict();
export const cardMoveSchema = z.object({ columnId: uuid, afterCardId: uuid.nullable() }).strict();

const id = (c: Context<AppEnv>, name: string) => uuid.parse(c.req.param(name));
const invalid = (detail: string) => ({ error: "Invalid request", details: [detail] });

export const READERS_QUERY_MAX = 64;
export const READERS_LIMIT_MAX = 50;
const READERS_RATE_LIMIT = 60;
const READERS_RATE_WINDOW_MS = 60_000;
const readerRequests = new Map<string, number[]>();

/**
 * The assignee picker's sliding window per user (T92): 60 requests a minute,
 * in memory (one app instance per data directory). Returns seconds to wait, or 0.
 */
function readersRateLimited(userId: string, time = Date.now()) {
  const windowStart = time - READERS_RATE_WINDOW_MS;
  if (readerRequests.size > 1000) {
    for (const [key, stamps] of readerRequests) if ((stamps[stamps.length - 1] ?? 0) <= windowStart) readerRequests.delete(key);
  }
  const stamps = (readerRequests.get(userId) ?? []).filter((stamp) => stamp > windowStart);
  if (stamps.length >= READERS_RATE_LIMIT) {
    readerRequests.set(userId, stamps);
    return Math.max(1, Math.ceil((stamps[0]! + READERS_RATE_WINDOW_MS - time) / 1000));
  }
  stamps.push(time);
  readerRequests.set(userId, stamps);
  return 0;
}

/** Test hook: forget the assignee picker's rate-limit history. */
export function resetReadersRateLimit() {
  readerRequests.clear();
}

/** Runs a service call and maps TaskError to its JSON response; other errors reach app.onError. */
async function respond(c: Context<AppEnv>, operation: () => unknown, status: 200 | 201 = 200) {
  try {
    return c.json(await operation() as Record<string, unknown>, status);
  } catch (error) {
    if (error instanceof TaskError) return c.json(error.body(), error.status);
    throw error;
  }
}

/** docs/plan/API_CONTRACTS.md § Tasks. JSON only; the global session, Origin, CSRF, and TOTP middleware apply. */
export function registerTaskRoutes(app: Hono<AppEnv>) {
  app.get("/api/tasks/boards", (c) => c.json({ boards: listBoards(c.get("user").id) }));

  app.post("/api/tasks/boards", async (c) => {
    const body = await parseJson(c.req.raw, boardNameSchema);
    return respond(c, () => createBoard(c.get("user").id, body.name), 201);
  });

  app.get("/api/tasks/boards/:boardId", (c) => {
    const boardId = id(c, "boardId");
    return respond(c, () => getBoard(c.get("user").id, boardId));
  });

  app.patch("/api/tasks/boards/:boardId", async (c) => {
    const boardId = id(c, "boardId");
    const body = await parseJson(c.req.raw, boardNameSchema);
    return respond(c, () => renameBoard(c.get("user").id, boardId, body.name));
  });

  app.delete("/api/tasks/boards/:boardId", (c) => {
    const boardId = id(c, "boardId");
    return respond(c, () => deleteBoard(c.get("user").id, boardId));
  });

  app.get("/api/tasks/boards/:boardId/sharing", (c) => {
    const boardId = id(c, "boardId");
    return respond(c, () => getSharing(c.get("user").id, boardId));
  });

  app.put("/api/tasks/boards/:boardId/sharing", async (c) => {
    const boardId = id(c, "boardId");
    const body = await parseJson(c.req.raw, boardSharingSchema);
    return respond(c, () => putSharing(c.get("user").id, boardId, body.visibility, body.userIds));
  });

  app.get("/api/tasks/boards/:boardId/readers", async (c) => {
    const boardId = id(c, "boardId");
    const userId = c.get("user").id;
    const retryAfter = readersRateLimited(userId);
    if (retryAfter) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests. Try again in a moment.", code: "RATE_LIMITED" }, 429);
    }
    const q = c.req.query("q");
    const limitParam = c.req.query("limit");
    if (q !== undefined && (q.length < 1 || q.length > READERS_QUERY_MAX)) return c.json(invalid(`q must be 1 to ${READERS_QUERY_MAX} characters`), 400);
    if (limitParam !== undefined && (!/^\d+$/.test(limitParam) || Number(limitParam) < 1 || Number(limitParam) > READERS_LIMIT_MAX)) {
      return c.json(invalid(`limit must be an integer from 1 to ${READERS_LIMIT_MAX}`), 400);
    }
    if (limitParam !== undefined && q === undefined) return c.json(invalid("limit needs q"), 400);
    return respond(c, () => listBoardReaders(userId, boardId, { q, limit: limitParam === undefined ? undefined : Number(limitParam) }));
  });

  app.post("/api/tasks/boards/:boardId/columns", async (c) => {
    const boardId = id(c, "boardId");
    const body = await parseJson(c.req.raw, columnCreateSchema);
    return respond(c, () => createColumn(c.get("user").id, boardId, body), 201);
  });

  app.patch("/api/tasks/columns/:columnId", async (c) => {
    const columnId = id(c, "columnId");
    const body = await parseJson(c.req.raw, columnPatchSchema);
    return respond(c, () => patchColumn(c.get("user").id, columnId, body));
  });

  app.delete("/api/tasks/columns/:columnId", (c) => {
    const columnId = id(c, "columnId");
    return respond(c, () => deleteColumn(c.get("user").id, columnId));
  });

  app.post("/api/tasks/boards/:boardId/cards", async (c) => {
    const boardId = id(c, "boardId");
    const body = await parseJson(c.req.raw, cardCreateSchema);
    return respond(c, () => createCard(c.get("user").id, boardId, body), 201);
  });

  app.get("/api/tasks/cards/:cardId", (c) => {
    const cardId = id(c, "cardId");
    const userId = c.get("user").id;
    return respond(c, () => {
      const { card } = getCard(userId, cardId);
      const page = listComments(userId, cardId);
      return { card, comments: page.comments, hasMoreComments: page.hasMore, attachments: listAttachments(cardId) };
    });
  });

  app.get("/api/tasks/cards/:cardId/comments", async (c) => {
    const cardId = id(c, "cardId");
    const userId = c.get("user").id;
    const before = c.req.query("before");
    const limitParam = c.req.query("limit");
    const limit = limitParam === undefined ? COMMENT_PAGE_SIZE : Number(limitParam);
    if (!/^\d+$/.test(limitParam ?? "50") || limit < 1 || limit > COMMENT_PAGE_SIZE) {
      return c.json({ error: "Invalid request", details: [`limit must be an integer from 1 to ${COMMENT_PAGE_SIZE}`] }, 400);
    }
    const beforeId = before === undefined ? undefined : uuid.parse(before);
    return respond(c, () => {
      getCard(userId, cardId);
      return listComments(userId, cardId, { before: beforeId, limit });
    });
  });

  app.post("/api/tasks/cards/:cardId/comments", async (c) => {
    const cardId = id(c, "cardId");
    const body = await parseJson(c.req.raw, commentCreateSchema);
    return respond(c, () => createComment(c.get("user").id, cardId, body), 201);
  });

  app.post("/api/tasks/cards/:cardId/attachments", async (c) => {
    const cardId = id(c, "cardId");
    const body = await parseJson(c.req.raw, attachmentSchema);
    try {
      const result = await attachToCard(c.get("user").id, cardId, body);
      return c.json({ attachment: result.attachment }, result.status);
    } catch (error) {
      if (error instanceof TaskError) return c.json(error.body(), error.status);
      throw error;
    }
  });

  app.delete("/api/tasks/cards/:cardId/attachments/:documentId", (c) => {
    const cardId = id(c, "cardId");
    const documentId = id(c, "documentId");
    return respond(c, () => detachFromCard(c.get("user").id, cardId, documentId));
  });

  app.patch("/api/tasks/comments/:commentId", async (c) => {
    const commentId = id(c, "commentId");
    const body = await parseJson(c.req.raw, commentPatchSchema);
    return respond(c, () => updateComment(c.get("user").id, commentId, body.body));
  });

  app.delete("/api/tasks/comments/:commentId", (c) => {
    const commentId = id(c, "commentId");
    return respond(c, () => deleteComment(c.get("user").id, commentId));
  });

  app.patch("/api/tasks/cards/:cardId", async (c) => {
    const cardId = id(c, "cardId");
    const body = await parseJson(c.req.raw, cardPatchSchema);
    return respond(c, () => patchCard(c.get("user").id, cardId, body));
  });

  app.post("/api/tasks/cards/:cardId/move", async (c) => {
    const cardId = id(c, "cardId");
    const body = await parseJson(c.req.raw, cardMoveSchema);
    return respond(c, () => moveCard(c.get("user").id, cardId, body));
  });

  app.delete("/api/tasks/cards/:cardId", (c) => {
    const cardId = id(c, "cardId");
    return respond(c, () => deleteCard(c.get("user").id, cardId));
  });
}
