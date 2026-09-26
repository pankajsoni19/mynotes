import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import { validTimeZone } from "../today/registry";
import { parseJson } from "../validation";
import { TASK_QUERY_LIMITS } from "../../shared/taskQuery";
import { QUERY_GROUPS, QUERY_PAGE, QUERY_SORTS, queryCards } from "./query";
import { TaskError } from "./service";

/**
 * `POST /api/tasks/query` (research 2026-09-26 §10.4, D144): a read sent as
 * POST, like the Collections query. Rate limited per user, 30 per 10 s (T117).
 */

export const TASK_QUERY_RATE_LIMIT = 30;
export const TASK_QUERY_RATE_WINDOW_MS = 10_000;
const queryRequests = new Map<string, number[]>();

/** Sliding window per user, in memory (one app instance per data directory), as for search. Returns Retry-After seconds or 0. */
export function taskQueryRateLimited(userId: string, time = Date.now()) {
  const windowStart = time - TASK_QUERY_RATE_WINDOW_MS;
  if (queryRequests.size > 1000) {
    for (const [key, stamps] of queryRequests) if ((stamps[stamps.length - 1] ?? 0) <= windowStart) queryRequests.delete(key);
  }
  const stamps = (queryRequests.get(userId) ?? []).filter((stamp) => stamp > windowStart);
  if (stamps.length >= TASK_QUERY_RATE_LIMIT) {
    queryRequests.set(userId, stamps);
    return Math.max(1, Math.ceil((stamps[0]! + TASK_QUERY_RATE_WINDOW_MS - time) / 1000));
  }
  stamps.push(time);
  queryRequests.set(userId, stamps);
  return 0;
}

/** Test hook: forget the query rate-limit history. */
export function resetTaskQueryRateLimit() {
  queryRequests.clear();
}

export const tzSchema = z.string().max(64).refine((value) => validTimeZone(value) !== null, "tz must be an IANA time zone");
export const cursorSchema = z.string().min(1).max(1024);
export const pageLimitSchema = z.number().int().min(1).max(QUERY_PAGE.max);

export const taskQuerySchema = z.object({
  q: z.string().max(TASK_QUERY_LIMITS.length).default(""),
  sort: z.enum(QUERY_SORTS).optional(),
  group: z.enum(QUERY_GROUPS).optional(),
  cursor: cursorSchema.optional(),
  limit: pageLimitSchema.optional(),
  tz: tzSchema.default("UTC")
}).strict();

/** 429 with Retry-After when the caller is over the query limit, else null. */
export function rateLimitedResponse(c: Context<AppEnv>) {
  const retryAfter = taskQueryRateLimited(c.get("user").id);
  if (!retryAfter) return null;
  c.header("Retry-After", String(retryAfter));
  return c.json({ error: "Too many queries. Try again in a moment.", code: "RATE_LIMITED" }, 429);
}

export function registerTaskQueryRoutes(app: Hono<AppEnv>) {
  app.post("/api/tasks/query", async (c) => {
    const limited = rateLimitedResponse(c);
    if (limited) return limited;
    const body = await parseJson(c.req.raw, taskQuerySchema);
    try {
      return c.json(queryCards(c.get("user").id, body));
    } catch (error) {
      if (error instanceof TaskError) return c.json(error.body(), error.status);
      throw error;
    }
  });
}
