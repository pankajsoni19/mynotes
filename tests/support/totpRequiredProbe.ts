/**
 * Run as a separate `bun` process by tests/documents.test.ts. The shared
 * harness configures TOTP_POLICY=optional once per test run, so the required
 * policy needs its own process. It calls the app's fetch handler directly
 * (no listening socket) and prints one JSON line with the observed statuses.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "mynotes-totp-probe-"));
const origin = "http://localhost:22027";
Object.assign(process.env, {
  DATA_DIR: dataDir,
  APP_ORIGIN: origin,
  APP_ORIGINS: origin,
  PORT: "22027",
  NODE_ENV: "test",
  COOKIE_SECURE: "false",
  TOTP_POLICY: "required",
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ALLOWED_EMAILS: "probe@example.test",
  MAX_UPLOAD_BYTES: "4194304",
  MIN_FREE_DISK_BYTES: "0"
});

try {
  const app = (await import("../../server/index")).default;
  const { db, ensureDefaultFolder, now } = await import("../../server/db");
  const userId = crypto.randomUUID();
  const token = "probe-session-token-000000000000000000000000";
  const csrf = "probe-csrf-token";
  db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, 'probe@example.test', 'Probe', 'x', ?)").run(userId, now());
  ensureDefaultFolder(userId);
  db.query("INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), userId, createHash("sha256").update(token).digest("hex"), csrf, now(), now(), new Date(Date.now() + 3_600_000).toISOString());
  const headers = { Cookie: `mynotes_session=${token}`, Origin: origin, "X-CSRF-Token": csrf };
  const form = new FormData();
  form.append("file", new Blob(["hello"]), "a.txt");
  const results: Record<string, { status: number; code?: string }> = {};
  const record = async (label: string, response: Response) => {
    const body = await response.json().catch(() => ({})) as { code?: string };
    results[label] = { status: response.status, code: body.code };
  };
  await record("upload", await app.fetch(new Request(`${origin}/api/files`, { method: "POST", headers, body: form })));
  await record("list", await app.fetch(new Request(`${origin}/api/files`, { headers })));
  await record("content", await app.fetch(new Request(`${origin}/api/files/${crypto.randomUUID()}/content`, { headers })));
  console.log(JSON.stringify(results));
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(0);
