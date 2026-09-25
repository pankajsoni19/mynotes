/**
 * Run as a separate `bun` process by tests/calendarFeeds.test.ts, because TOTP_POLICY=required
 * needs its own configuration (see harness.ts). A user who has not enrolled cannot create a feed
 * (the gate applies); an enrolled user's session can, and the resulting token is then fetched with
 * no session at all (T70). Prints one JSON line with the observed statuses.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "mynotes-feed-totp-probe-"));
const origin = "http://localhost:22028";
Object.assign(process.env, {
  DATA_DIR: dataDir,
  APP_ORIGIN: origin,
  APP_ORIGINS: origin,
  PORT: "22028",
  NODE_ENV: "test",
  COOKIE_SECURE: "false",
  TOTP_POLICY: "required",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ALLOWED_EMAILS: "gated@example.test,ungated@example.test",
  MAX_UPLOAD_BYTES: "4194304",
  MIN_FREE_DISK_BYTES: "0",
  PUSH_ENABLED: "false"
});

try {
  const app = (await import("../../server/index")).default;
  const { db, ensureDefaultFolder, now } = await import("../../server/db");
  const { ensurePersonalCalendar } = await import("../../server/calendar/service");

  function user(email: string, enrolled: boolean) {
    const userId = crypto.randomUUID();
    const token = `probe-session-${email}-${"0".repeat(20)}`;
    const csrf = `csrf-${email}`;
    db.query("INSERT INTO users (id, email, display_name, password_hash, created_at, totp_enabled_at) VALUES (?, ?, 'Probe', 'x', ?, ?)")
      .run(userId, email, now(), enrolled ? now() : null);
    ensureDefaultFolder(userId);
    ensurePersonalCalendar(userId);
    db.query("INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), userId, createHash("sha256").update(token).digest("hex"), csrf, now(), now(), new Date(Date.now() + 3_600_000).toISOString());
    const calendarId = (db.query("SELECT id FROM calendars WHERE owner_id = ?").get(userId) as { id: string }).id;
    return { calendarId, headers: { Cookie: `mynotes_session=${token}`, Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" } };
  }

  const ungated = user("ungated@example.test", false);
  const gated = user("gated@example.test", true);
  const create = (who: typeof gated) => app.fetch(new Request(`${origin}/api/calendars/${who.calendarId}/feeds`, { method: "POST", headers: who.headers, body: JSON.stringify({ detail: "busy" }) }));
  const ungatedCreate = await create(ungated);
  const gatedCreate = await create(gated);
  const { token } = await gatedCreate.json() as { token: string };
  const feed = await app.fetch(new Request(`${origin}/api/calendars/${gated.calendarId}/feed.ics?token=${token}`));
  const noSessionList = await app.fetch(new Request(`${origin}/api/calendars/${gated.calendarId}/feeds`));
  console.log(JSON.stringify({
    ungatedCreate: ungatedCreate.status,
    gatedCreate: gatedCreate.status,
    feed: feed.status,
    feedType: feed.headers.get("content-type"),
    noSessionList: noSessionList.status
  }));
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
