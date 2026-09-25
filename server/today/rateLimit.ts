/** docs/plan/API_CONTRACTS.md § Today. 30 requests per minute per user, shared by GET /api/today and get_today (T51). */
export const TODAY_RATE_LIMIT = 30;
export const TODAY_RATE_WINDOW_MS = 60_000;

const requests = new Map<string, number[]>();

/** Sliding window per user, in memory (one app instance per data directory), as for search. Returns Retry-After seconds or 0. */
export function todayRateLimited(userId: string, time = Date.now()) {
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
