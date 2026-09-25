import type { Hono } from "hono";
import type { AppEnv } from "../auth";
import { loadToday, todayContext, todaySectionNames, validTimeZone } from "./registry";
import "./providers";

/** docs/plan/API_CONTRACTS.md § Today. 30 requests per minute per user (T51). */
export const TODAY_RATE_LIMIT = 30;
export const TODAY_RATE_WINDOW_MS = 60_000;

const requests = new Map<string, number[]>();

/** Sliding window per user, in memory (one app instance per data directory), as for search. Returns Retry-After seconds or 0. */
function rateLimited(userId: string, time = Date.now()) {
  const windowStart = time - TODAY_RATE_WINDOW_MS;
  if (requests.size > 1000) {
    for (const [key, stamps] of requests) if ((stamps[stamps.length - 1] ?? 0) <= windowStart) requests.delete(key);
  }
  const stamps = (requests.get(userId) ?? []).filter((stamp) => stamp > windowStart);
  if (stamps.length >= TODAY_RATE_LIMIT) {
    requests.set(userId, stamps);
    return Math.max(1, Math.ceil((stamps[0]! + TODAY_RATE_WINDOW_MS - time) / 1000));
  }
  stamps.push(time);
  requests.set(userId, stamps);
  return 0;
}

/** Test hook: forget the rate-limit history. */
export function resetTodayRateLimit() {
  requests.clear();
}

const invalid = (detail: string) => ({ error: "Invalid request", details: [detail] });

export function registerTodayRoutes(app: Hono<AppEnv>) {
  app.get("/api/today", async (c) => {
    const userId = c.get("user").id;
    const retryAfter = rateLimited(userId);
    if (retryAfter) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests. Try again in a moment.", code: "RATE_LIMITED" }, 429);
    }
    const tz = validTimeZone(c.req.query("tz"));
    if (!tz) return c.json(invalid("tz must be an IANA time zone"), 400);
    // `sections=a,b` reloads only those (the per-section Retry); unknown names are refused.
    const sectionsParam = c.req.query("sections");
    let only: string[] | undefined;
    if (sectionsParam !== undefined) {
      const installed = todaySectionNames();
      only = [...new Set(sectionsParam.split(","))];
      if (only.length === 0 || only.length > installed.length || only.some((name) => !installed.includes(name))) {
        return c.json(invalid("sections must list installed Today sections"), 400);
      }
    }
    return c.json(await loadToday(todayContext(userId, tz), only));
  });
}
