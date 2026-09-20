import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = mkdtempSync(join(tmpdir(), "mynotes-test-"));
const origin = "http://localhost:22026";
process.env.DATA_DIR = dataDir;
process.env.APP_ORIGIN = origin;
process.env.PORT = "22026";
process.env.NODE_ENV = "test";
process.env.ALLOW_REGISTRATION = "true";
process.env.TOTP_POLICY = "optional";
process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const allowedTestEmails = Array.from({ length: 10 }, (_, index) => `allowed-${index + 1}@example.test`);
process.env.ALLOWED_EMAILS = allowedTestEmails.join(",");

const serverOptions = (await import("../server/index")).default;
const { db } = await import("../server/db");
const { totpCodeAt, totpCounter } = await import("../server/totp");
const server = Bun.serve(serverOptions);

type Session = { cookie: string; csrf: string; userId: string; email: string; password: string };
let registrationIndex = 0;

async function request(path: string, options: RequestInit = {}, session?: Session) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  headers.set("Origin", origin);
  if (session) {
    headers.set("Cookie", session.cookie);
    if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", session.csrf);
  }
  return fetch(`${origin}/api${path}`, { ...options, headers });
}

async function register(label: string): Promise<Session> {
  const allowedEmail = allowedTestEmails[registrationIndex++];
  if (!allowedEmail) throw new Error("Test email allowlist exhausted");
  const password = "correct horse battery staple";
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: allowedEmail, displayName: label, password })
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { csrfToken: string; user: { id: string } };
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toBeTruthy();
  return { cookie: cookie!, csrf: body.csrfToken, userId: body.user.id, email: allowedEmail, password };
}

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("authorization and version workflow", () => {
  test("enforces restrictive data and database permissions", () => {
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, "mynotes.sqlite")).mode & 0o777).toBe(0o600);
  });

  test("rejects registration and login outside the email allowlist", async () => {
    const registration = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "blocked@example.test", displayName: "Blocked", password: "correct horse battery staple" })
    });
    expect(registration.status).toBe(403);
    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "blocked@example.test", password: "correct horse battery staple" })
    });
    expect(login.status).toBe(401);
  });

  test("encrypts TOTP secrets, requires a code at login, and rejects replay", async () => {
    const owner = await register("TOTP owner");
    expect(totpCodeAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
    const setupResponse = await request("/auth/totp/setup", { method: "POST", body: JSON.stringify({ password: owner.password }) }, owner);
    expect(setupResponse.status).toBe(200);
    const setup = await setupResponse.json() as { secret: string; uri: string };
    expect(setup.uri).toContain("otpauth://totp/");
    expect(setup.uri).toContain("issuer=MyNotes");

    const stored = db.query("SELECT totp_secret FROM users WHERE id = ?").get(owner.userId) as { totp_secret: string };
    expect(stored.totp_secret.startsWith("v1:")).toBe(true);
    expect(stored.totp_secret).not.toContain(setup.secret);

    const previousCode = totpCodeAt(setup.secret, totpCounter() - 1);
    const enable = await request("/auth/totp/enable", { method: "POST", body: JSON.stringify({ code: previousCode }) }, owner);
    expect(enable.status).toBe(200);
    expect(((await enable.json()) as { enabled: boolean }).enabled).toBe(true);

    await request("/auth/logout", { method: "POST", body: "{}" }, owner);
    const passwordOnly = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: owner.email, password: owner.password })
    });
    expect(passwordOnly.status).toBe(428);
    expect(((await passwordOnly.json()) as { requiresTotp: boolean }).requiresTotp).toBe(true);

    const currentCode = totpCodeAt(setup.secret, totpCounter());
    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: owner.email, password: owner.password, totpCode: currentCode })
    });
    expect(login.status).toBe(200);
    const replay = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: owner.email, password: owner.password, totpCode: currentCode })
    });
    expect(replay.status).toBe(401);
  }, 20_000);

  test("keeps notes private, rejects CSRF, then shares and versions safely", async () => {
    const owner = await register("Owner");
    const reader = await register("Reader");

    const folderResponse = await request("/folders", {}, owner);
    const ownerFolders = ((await folderResponse.json()) as { folders: Array<{ id: string; name: string; is_default: number }> }).folders;
    expect(ownerFolders).toHaveLength(1);
    expect(ownerFolders[0]?.name).toBe("Default");
    expect(ownerFolders[0]?.is_default).toBe(1);

    const rejected = await fetch(`${origin}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, Cookie: owner.cookie },
      body: JSON.stringify({ folderId: null })
    });
    expect(rejected.status).toBe(403);

    const create = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, owner);
    expect(create.status).toBe(201);
    const createdNote = ((await create.json()) as { note: { id: string; folder_id: string } }).note;
    const noteId = createdNote.id;
    expect(createdNote.folder_id).toBe(ownerFolders[0]?.id);

    const fresh = await request(`/notes/${noteId}`, {}, owner);
    const freshNote = ((await fresh.json()) as { note: { hasDraft: boolean; hasDelta: boolean } }).note;
    expect(freshNote.hasDraft).toBe(true);
    expect(freshNote.hasDelta).toBe(false);
    const blankPublish = await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    expect(blankPublish.status).toBe(409);

    const folderCreate = await request("/folders", { method: "POST", body: JSON.stringify({ name: "Projects", parentId: null }) }, owner);
    const projectFolderId = ((await folderCreate.json()) as { folder: { id: string } }).folder.id;
    const move = await request(`/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ folderId: projectFolderId }) }, owner);
    expect(move.status).toBe(200);
    const moved = await request(`/notes/${noteId}`, {}, owner);
    expect(((await moved.json()) as { note: { folder_id: string } }).note.folder_id).toBe(projectFolderId);

    const hidden = await request(`/notes/${noteId}`, {}, reader);
    expect(hidden.status).toBe(404);

    const save = await request(`/notes/${noteId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ markdown: "# First\n\npassword = hunter2", revision: 1 })
    }, owner);
    expect(save.status).toBe(200);
    const savedDraft = (await save.json()) as { revision: number; hasDelta: boolean };
    expect(savedDraft.revision).toBe(2);
    expect(savedDraft.hasDelta).toBe(true);

    const publish = await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    expect(publish.status).toBe(200);
    expect(((await publish.json()) as { version: number }).version).toBe(1);

    const published = await request(`/notes/${noteId}`, {}, owner);
    const publishedNote = ((await published.json()) as { note: { hasDraft: boolean; hasDelta: boolean } }).note;
    expect(publishedNote.hasDraft).toBe(false);
    expect(publishedNote.hasDelta).toBe(false);

    const shareFolder = await request(`/folders/${projectFolderId}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ visibility: "selected", userIds: [reader.userId] })
    }, owner);
    expect(shareFolder.status).toBe(200);

    const inherited = await request(`/notes/${noteId}`, {}, reader);
    expect(inherited.status).toBe(200);

    const privateOverride = await request(`/notes/${noteId}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ visibility: "private", userIds: [] })
    }, owner);
    expect(privateOverride.status).toBe(200);
    expect((await request(`/notes/${noteId}`, {}, reader)).status).toBe(404);

    const inheritAgain = await request(`/notes/${noteId}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ visibility: "inherit", userIds: [] })
    }, owner);
    expect(inheritAgain.status).toBe(200);
    expect((await request(`/notes/${noteId}`, {}, reader)).status).toBe(200);

    const share = await request(`/notes/${noteId}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ visibility: "selected", userIds: [reader.userId] })
    }, owner);
    expect(share.status).toBe(200);

    const visible = await request(`/notes/${noteId}`, {}, reader);
    expect(visible.status).toBe(200);
    const sharedBody = await visible.json() as { note: { markdown: string; isOwner: boolean; title: string } };
    expect(sharedBody.note.markdown).toContain("hunter2");
    expect(sharedBody.note.isOwner).toBe(false);
    expect(sharedBody.note.title).toBe("First");

    const readerEdit = await request(`/notes/${noteId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ markdown: "changed", revision: null })
    }, reader);
    expect(readerEdit.status).toBe(404);

    const versions = await request(`/notes/${noteId}/versions`, {}, reader);
    expect(versions.status).toBe(200);
    expect(((await versions.json()) as { versions: unknown[] }).versions).toHaveLength(1);

    const identical = await request(`/notes/${noteId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ markdown: "# First\n\npassword = hunter2", revision: null })
    }, owner);
    expect(identical.status).toBe(200);
    expect(((await identical.json()) as { hasDelta: boolean }).hasDelta).toBe(false);
    expect((await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner)).status).toBe(409);
    const unchangedVersions = await request(`/notes/${noteId}/versions`, {}, owner);
    expect(((await unchangedVersions.json()) as { versions: unknown[] }).versions).toHaveLength(1);

    const blankCreate = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, owner);
    const blankId = ((await blankCreate.json()) as { note: { id: string } }).note.id;
    const blankPath = join(dataDir, "notes", blankId);
    expect(existsSync(blankPath)).toBe(true);
    expect((await request(`/notes/${blankId}`, { method: "DELETE", body: "{}" }, owner)).status).toBe(200);
    expect(existsSync(blankPath)).toBe(false);
    expect((await request(`/notes/${blankId}`, {}, owner)).status).toBe(404);
  }, 20_000);

  test("serializes concurrent draft saves and publishes", async () => {
    const owner = await register("Concurrent owner");
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, owner);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;

    const save = (markdown: string) => request(`/notes/${noteId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ markdown, revision: 1 })
    }, owner);
    const saveResponses = await Promise.all([save("first writer"), save("second writer")]);
    expect(saveResponses.map((response) => response.status).sort()).toEqual([200, 409]);

    const loaded = await request(`/notes/${noteId}`, {}, owner);
    const loadedBody = await loaded.json() as { note: { markdown: string; draft_revision: number } };
    expect(["first writer", "second writer"]).toContain(loadedBody.note.markdown);
    expect(loadedBody.note.draft_revision).toBe(2);

    const publish = () => request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    const publishResponses = await Promise.all([publish(), publish()]);
    expect(publishResponses.map((response) => response.status).sort()).toEqual([200, 409]);

    const history = await request(`/notes/${noteId}/versions`, {}, owner);
    expect(((await history.json()) as { versions: unknown[] }).versions).toHaveLength(1);
  }, 20_000);

  test("rejects a symlink substituted for a note directory", async () => {
    const owner = await register("Symlink owner");
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, owner);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;
    const notePath = join(dataDir, "notes", noteId);
    const outside = mkdtempSync(join(tmpdir(), "mynotes-outside-"));
    rmSync(notePath, { recursive: true, force: true });
    symlinkSync(outside, notePath, "dir");
    const response = await request(`/notes/${noteId}`, {}, owner);
    expect(response.status).toBe(500);
    rmSync(notePath, { force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  test("recovers an uncommitted staged version without overwriting history", async () => {
    const owner = await register("Recovery owner");
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, owner);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;
    await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ markdown: "version one", revision: 1 }) }, owner);
    await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ markdown: "version two", revision: null }) }, owner);

    const versionsDir = join(dataDir, "notes", noteId, "versions");
    mkdirSync(versionsDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(versionsDir, "000002.md"), "orphan from interrupted publish", { mode: 0o600 });
    const publish = await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    expect(publish.status).toBe(200);

    const version = await request(`/notes/${noteId}/versions/2`, {}, owner);
    expect(((await version.json()) as { markdown: string }).markdown).toBe("version two");
    const loaded = await request(`/notes/${noteId}`, {}, owner);
    expect(((await loaded.json()) as { note: { title: string } }).note.title).toBe("version two");
  });
});
