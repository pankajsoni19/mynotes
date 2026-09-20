import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config, isEmailAllowed } from "./config";
import { audit, db, now, type UserRow } from "./db";

export type AppEnv = {
  Variables: {
    user: Pick<UserRow, "id" | "email" | "display_name" | "totp_enabled_at">;
    sessionId: string;
    csrfToken: string;
  };
};

const SESSION_COOKIE = "mynotes_session";
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
let lastSessionCleanup = 0;

export async function createSession(c: Context, userId: string) {
  const token = randomToken();
  const csrfToken = randomToken();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
  const id = crypto.randomUUID();
  db.query("INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, tokenHash(token), csrfToken, createdAt, createdAt, expiresAt);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "Strict",
    path: "/",
    maxAge: config.sessionDays * 86_400
  });
  return csrfToken;
}

export function clearSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: config.isProduction, sameSite: "Strict" });
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  if (Date.now() - lastSessionCleanup > 3_600_000) {
    db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now());
    lastSessionCleanup = Date.now();
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const row = db.query(`
    SELECT s.id AS session_id, s.csrf_token, u.id, u.email, u.display_name, u.totp_enabled_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL
  `).get(tokenHash(token), now()) as (Pick<UserRow, "id" | "email" | "display_name" | "totp_enabled_at"> & { session_id: string; csrf_token: string }) | null;
  if (!row) {
    clearSession(c);
    return c.json({ error: "Authentication required" }, 401);
  }
  if (!isEmailAllowed(row.email)) {
    db.query("DELETE FROM sessions WHERE id = ?").run(row.session_id);
    clearSession(c);
    return c.json({ error: "Authentication required" }, 401);
  }
  c.set("user", { id: row.id, email: row.email, display_name: row.display_name, totp_enabled_at: row.totp_enabled_at });
  c.set("sessionId", row.session_id);
  c.set("csrfToken", row.csrf_token);
  db.query("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now(), row.session_id);
  await next();
}

export async function requireMutationSafety(c: Context<AppEnv>, next: Next) {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (origin !== config.appOrigin) return c.json({ error: "Invalid request origin" }, 403);
  if (!c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }
  const supplied = c.req.header("X-CSRF-Token") ?? "";
  const expected = c.get("csrfToken");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: "Invalid CSRF token" }, 403);
  await next();
}

export function logoutCurrentSession(c: Context<AppEnv>) {
  db.query("DELETE FROM sessions WHERE id = ?").run(c.get("sessionId"));
  audit(c.get("user").id, null, "auth.logout");
  clearSession(c);
}
