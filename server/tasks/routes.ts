import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import { parseJson, uuid } from "../validation";
import {
  createBoard,
  createColumn,
  deleteBoard,
  deleteColumn,
  getBoard,
  getSharing,
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
export const columnPatchSchema = z.object({ name: label(60).optional(), afterColumnId: uuid.nullable().optional() }).strict()
  .refine((value) => value.name !== undefined || value.afterColumnId !== undefined, "Provide a name or an afterColumnId");

const id = (c: Context<AppEnv>, name: string) => uuid.parse(c.req.param(name));

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
}
