import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import { parseJson, uuid } from "../validation";
import { SPRINT_GOAL_MAX, SPRINT_NAME_MAX, SPRINT_STATES } from "../../shared/sprintPlan";
import { dueOnSchema } from "./routes";
import { TaskError } from "./service";
import { createSprint, deleteSprint, listSprints, patchSprint } from "./sprints";
import { completeSprint } from "./sprintComplete";

// C0/C1 controls and bidi overrides never belong in a sprint name (as for board and column names).
const controlCharacters = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const sprintName = z.string().trim().min(1).max(SPRINT_NAME_MAX).refine((value) => !controlCharacters.test(value), "Names cannot contain control characters");
const sprintGoal = z.string().max(SPRINT_GOAL_MAX);
const sprintDate = dueOnSchema.nullable();

/** `POST /boards/:b/sprints` (owner): a name, an optional goal, and optional start and end dates. */
export const sprintCreateSchema = z.object({ name: sprintName, goal: sprintGoal.optional(), startOn: sprintDate.optional(), endOn: sprintDate.optional() }).strict();
/** `PATCH /sprints/:s` (owner): fields, `afterSprintId` to reorder an open sprint, `state: "active"` to start it. */
export const sprintPatchSchema = z.object({
  name: sprintName.optional(),
  goal: sprintGoal.optional(),
  startOn: sprintDate.optional(),
  endOn: sprintDate.optional(),
  afterSprintId: uuid.nullable().optional(),
  state: z.literal("active").optional()
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined), "Provide a name, goal, startOn, endOn, afterSprintId, or state");

/**
 * `POST /sprints/:s/complete` (owner): where the unfinished cards go (`next`, `backlog`, `new`, or a
 * planned sprint's id), and for `new` an optional name and dates (default: the next number, as long
 * as this sprint, starting the day after it ends).
 */
export const sprintCompleteSchema = z.object({
  carryTo: z.union([z.enum(["next", "backlog", "new"]), uuid]),
  name: sprintName.optional(),
  startOn: sprintDate.optional(),
  endOn: sprintDate.optional()
}).strict().refine((value) => value.carryTo === "new" || (value.name === undefined && value.startOn === undefined && value.endOn === undefined),
  "name, startOn, and endOn go with carryTo \"new\"");

const SPRINTS_LIMIT_MAX = 100;

const id = (c: Context<AppEnv>, name: string) => uuid.parse(c.req.param(name));
const invalid = (detail: string) => ({ error: "Invalid request", details: [detail] });

async function respond(c: Context<AppEnv>, operation: () => unknown, status: 200 | 201 = 200) {
  try {
    return c.json(await operation() as Record<string, unknown>, status);
  } catch (error) {
    if (error instanceof TaskError) return c.json(error.body(), error.status);
    throw error;
  }
}

/** docs/plan/API_CONTRACTS.md § Tasks, Sprints (17B). */
export function registerSprintRoutes(app: Hono<AppEnv>) {
  app.get("/api/tasks/boards/:boardId/sprints", async (c) => {
    const boardId = id(c, "boardId");
    const state = c.req.query("state");
    const cursor = c.req.query("cursor");
    const limit = c.req.query("limit");
    if (state !== undefined && !(SPRINT_STATES as readonly string[]).includes(state)) return c.json(invalid(`state must be one of ${SPRINT_STATES.join(", ")}`), 400);
    if (limit !== undefined && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > SPRINTS_LIMIT_MAX)) return c.json(invalid(`limit must be an integer from 1 to ${SPRINTS_LIMIT_MAX}`), 400);
    return respond(c, () => listSprints(c.get("user").id, boardId, {
      state: state as (typeof SPRINT_STATES)[number] | undefined, cursor, limit: limit === undefined ? undefined : Number(limit)
    }));
  });

  app.post("/api/tasks/boards/:boardId/sprints", async (c) => {
    const boardId = id(c, "boardId");
    const body = await parseJson(c.req.raw, sprintCreateSchema);
    return respond(c, () => createSprint(c.get("user").id, boardId, body), 201);
  });

  app.patch("/api/tasks/sprints/:sprintId", async (c) => {
    const sprintId = id(c, "sprintId");
    const body = await parseJson(c.req.raw, sprintPatchSchema);
    return respond(c, () => patchSprint(c.get("user").id, sprintId, body));
  });

  app.post("/api/tasks/sprints/:sprintId/complete", async (c) => {
    const sprintId = id(c, "sprintId");
    const body = await parseJson(c.req.raw, sprintCompleteSchema);
    return respond(c, () => completeSprint(c.get("user").id, sprintId, body));
  });

  app.delete("/api/tasks/sprints/:sprintId", (c) => {
    const sprintId = id(c, "sprintId");
    return respond(c, () => deleteSprint(c.get("user").id, sprintId));
  });
}
