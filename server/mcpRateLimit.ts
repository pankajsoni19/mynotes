/**
 * Per-key MCP limits (docs/plan/WAVES_7-9.md §4.2, T36), in memory: one app
 * instance per data directory, and a restart only resets the windows.
 *
 * Every tool call counts against `call`; writes also count against `write`;
 * some writes also count against a daily bucket. A call is admitted only if
 * every bucket it touches has room, and then all of them are charged, so a
 * refused call costs nothing.
 */
export type McpLimitBucket = "call" | "write" | "create_note" | "task_write";

const MINUTE = 60_000;
const DAY = 86_400_000;

export const MCP_LIMITS: Record<McpLimitBucket, { limit: number; windowMs: number }> = {
  call: { limit: 120, windowMs: MINUTE },
  write: { limit: 30, windowMs: MINUTE },
  create_note: { limit: 200, windowMs: DAY },
  // Reserved for the task tools (tasks:write), which land after Task Boards.
  task_write: { limit: 500, windowMs: DAY }
};

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

function sweep(time: number) {
  if (windows.size < 5000) return;
  for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
}

/**
 * Charges `buckets` for `keyId`. Returns 0 when admitted, otherwise the
 * seconds until the fullest bucket resets (fixed windows).
 */
export function consumeMcpLimits(keyId: string, buckets: readonly McpLimitBucket[], time = Date.now()) {
  sweep(time);
  const current = buckets.map((bucket) => {
    const key = `${keyId}:${bucket}`;
    let window = windows.get(key);
    if (!window || window.resetAt <= time) {
      window = { count: 0, resetAt: time + MCP_LIMITS[bucket].windowMs };
      windows.set(key, window);
    }
    return { bucket, window };
  });
  const blocked = current.filter(({ bucket, window }) => window.count >= MCP_LIMITS[bucket].limit);
  if (blocked.length) return Math.max(...blocked.map(({ window }) => Math.max(1, Math.ceil((window.resetAt - time) / 1000))));
  for (const { window } of current) window.count += 1;
  return 0;
}

/** Test hook: forget every window. */
export function resetMcpLimits() {
  windows.clear();
}
