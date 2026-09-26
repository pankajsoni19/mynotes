import type { Context, Next } from "hono";
import type { AppEnv } from "../auth";
import { can, type Role } from "./roles";

/**
 * The default-deny role write gate (docs/plan/research/2026-09-26-team-module.md §5.2, D75, T87).
 * Every `/api` request that is not GET, HEAD, or OPTIONS from a user whose role cannot write content
 * (viewer, guest) gets 403 `ROLE_READ_ONLY`, unless it matches this exact allowlist of personal,
 * non-content writes and reads sent as POST. New routes are therefore read-only for these roles with
 * no per-route work; tests/writeGate.test.ts enumerates every mutating route to prove it.
 */

type AllowedWrite = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Hono-style path; `:name` matches exactly one segment. */
  path: string;
  /** Read-only roles this entry applies to; both when omitted. */
  roles?: readonly Role[];
  why: string;
};

export const ROLE_READ_ONLY_ALLOWED_WRITES: readonly AllowedWrite[] = [
  { method: "POST", path: "/api/auth/logout", why: "sign out" },
  { method: "POST", path: "/api/auth/totp/setup", why: "own two-factor setup" },
  { method: "POST", path: "/api/auth/totp/enable", why: "own two-factor setup" },
  { method: "POST", path: "/api/auth/totp/recovery-codes", why: "view own recovery codes" },
  { method: "POST", path: "/api/auth/totp/recovery-codes/regenerate", why: "own recovery codes" },
  { method: "DELETE", path: "/api/auth/totp", why: "turn off own two-factor" },
  { method: "POST", path: "/api/notifications/read", why: "mark own notifications read" },
  { method: "POST", path: "/api/push/subscriptions", why: "own push devices" },
  { method: "DELETE", path: "/api/push/subscriptions", why: "own push devices" },
  { method: "POST", path: "/api/push/test", why: "own push devices" },
  { method: "POST", path: "/api/reminders", why: "own reminders on readable events (O4)" },
  { method: "DELETE", path: "/api/reminders/:reminderId", why: "own reminders" },
  { method: "PUT", path: "/api/preferences", why: "own Modules preference (UI only, D92)" },
  { method: "POST", path: "/api/mcp/keys", why: "own MCP keys; the handler limits scopes by role and refuses guests (O6)" },
  { method: "DELETE", path: "/api/mcp/keys/:id", why: "revoke own MCP keys" },
  { method: "POST", path: "/api/collections/:collectionId/query", why: "a read sent as POST" },
  { method: "POST", path: "/api/tasks/query", why: "a read sent as POST" },
  // Personal task views (task hierarchy plan Q12): viewers keep private views; sharing stays refused.
  { method: "POST", path: "/api/tasks/views", roles: ["viewer"], why: "own private view" },
  { method: "PATCH", path: "/api/tasks/views/:viewId", roles: ["viewer"], why: "own private view (owner-only in the service)" },
  { method: "DELETE", path: "/api/tasks/views/:viewId", roles: ["viewer"], why: "own private view (owner-only in the service)" },
  { method: "POST", path: "/api/tasks/views/:viewId/duplicate", roles: ["viewer"], why: "private copy of a readable view" }
];

/**
 * Routes that enforce roles themselves and so pass the gate: Team answers guests 404 and non-admins
 * 403 `ADMIN_ONLY` (§5.2 item 3), which the gate must not turn into `ROLE_READ_ONLY`.
 */
export const SELF_GATED_WRITE_PREFIXES: readonly string[] = ["/api/team/"];

const compiled = ROLE_READ_ONLY_ALLOWED_WRITES.map((entry) => ({
  ...entry,
  regex: new RegExp(`^${entry.path.split("/").map((segment) => segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/")}$`)
}));

/** Whether `role` may send this write although it cannot write content. */
export function isAllowedReadOnlyWrite(role: Role, method: string, path: string) {
  if (SELF_GATED_WRITE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return compiled.some((entry) => entry.method === method && entry.regex.test(path) && (!entry.roles || entry.roles.includes(role)));
}

export const ROLE_READ_ONLY_BODY = { error: "Your team role is read-only", code: "ROLE_READ_ONLY" } as const;

/** Registered on `/api/*` after the session, CSRF, and TOTP gates. */
export async function roleWriteGate(c: Context<AppEnv>, next: Next) {
  const role = c.get("user")?.role;
  if (!role || can(role, "content.write") || ["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  // Hono matches routes case-sensitively on the raw path, so the gate compares the same path.
  if (isAllowedReadOnlyWrite(role, c.req.method, c.req.path)) return next();
  return c.json(ROLE_READ_ONLY_BODY, 403);
}
