import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import { parseJson, uuid } from "../validation";
import { createRelation, deleteRelation } from "./cardRelations";
import { CARD_SEARCH_LIMIT_MAX, CARD_SEARCH_QUERY_MAX, cardSearchRateLimited, searchCards } from "./cardSearch";
import { RELATION_TYPES, type RelationType } from "./relations";
import { TaskError } from "./service";

/** `{ type, cardId }`: the type as seen from the card in the path (§3.3). */
export const relationCreateSchema = z.object({
  type: z.enum(RELATION_TYPES as [RelationType, ...RelationType[]]),
  cardId: uuid
}).strict();

const invalid = (detail: string) => ({ error: "Invalid request", details: [detail] });

async function respond(c: Context<AppEnv>, operation: () => unknown, status: 200 | 201 = 200) {
  try {
    return c.json(await operation() as Record<string, unknown>, status);
  } catch (error) {
    if (error instanceof TaskError) return c.json(error.body(), error.status);
    throw error;
  }
}

/** Parses the card search query string: `{ q, boardId?, excludeCardId?, limit }`, or a 400 detail. */
export function parseCardSearchQuery(query: { q?: string; boardId?: string; excludeCardId?: string; limit?: string }) {
  const q = (query.q ?? "").trim();
  if (q.length < 1 || q.length > CARD_SEARCH_QUERY_MAX) return { error: `q must be 1 to ${CARD_SEARCH_QUERY_MAX} characters` };
  for (const name of ["boardId", "excludeCardId"] as const) {
    if (query[name] !== undefined && !uuid.safeParse(query[name]).success) return { error: `${name} must be an id` };
  }
  const limit = query.limit === undefined ? CARD_SEARCH_LIMIT_MAX : Number(query.limit);
  if ((query.limit !== undefined && !/^\d+$/.test(query.limit)) || limit < 1 || limit > CARD_SEARCH_LIMIT_MAX) {
    return { error: `limit must be an integer from 1 to ${CARD_SEARCH_LIMIT_MAX}` };
  }
  return { value: { q, boardId: query.boardId?.toLowerCase() ?? null, excludeCardId: query.excludeCardId?.toLowerCase() ?? null, limit } };
}

/**
 * Relations and card search (WAVE_13_TASK_CARD_UX.md §3.2). Registered before the other task
 * routes so `/cards/search` is never read as a card id.
 */
export function registerCardRelationRoutes(app: Hono<AppEnv>) {
  app.get("/api/tasks/cards/search", (c) => {
    const userId = c.get("user").id;
    const retryAfter = cardSearchRateLimited(userId);
    if (retryAfter) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many searches. Try again in a moment.", code: "RATE_LIMITED" }, 429);
    }
    const parsed = parseCardSearchQuery({ q: c.req.query("q"), boardId: c.req.query("boardId"), excludeCardId: c.req.query("excludeCardId"), limit: c.req.query("limit") });
    if ("error" in parsed) return c.json(invalid(parsed.error!), 400);
    const { q, ...options } = parsed.value;
    return c.json(searchCards(userId, q, options));
  });

  app.post("/api/tasks/cards/:cardId/relations", async (c) => {
    const cardId = uuid.parse(c.req.param("cardId"));
    const body = await parseJson(c.req.raw, relationCreateSchema);
    return respond(c, () => createRelation(c.get("user").id, cardId, { type: body.type, cardId: body.cardId.toLowerCase() }), 201);
  });

  app.delete("/api/tasks/cards/:cardId/relations/:relationId", (c) => {
    const cardId = uuid.parse(c.req.param("cardId"));
    const relationId = uuid.parse(c.req.param("relationId"));
    return respond(c, () => deleteRelation(c.get("user").id, cardId, relationId));
  });
}
