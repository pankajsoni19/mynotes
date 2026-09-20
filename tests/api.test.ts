import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = mkdtempSync(join(tmpdir(), "mynotes-test-"));
const origin = "http://localhost:22026";
process.env.DATA_DIR = dataDir;
process.env.APP_ORIGIN = origin;
process.env.PORT = "22026";
process.env.NODE_ENV = "test";
process.env.ALLOW_REGISTRATION = "true";

const serverOptions = (await import("../server/index")).default;
const server = Bun.serve(serverOptions);

type Session = { cookie: string; csrf: string; userId: string };

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
  const emailLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: `${emailLabel}-${crypto.randomUUID()}@example.test`, displayName: label, password: "correct horse battery staple" })
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { csrfToken: string; user: { id: string } };
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toBeTruthy();
  return { cookie: cookie!, csrf: body.csrfToken, userId: body.user.id };
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

  test("keeps notes private, rejects CSRF, then shares and versions safely", async () => {
    const owner = await register("Owner");
    const reader = await register("Reader");

    const rejected = await fetch(`${origin}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, Cookie: owner.cookie },
      body: JSON.stringify({ title: "Secret", folderId: null })
    });
    expect(rejected.status).toBe(403);

    const create = await request("/notes", { method: "POST", body: JSON.stringify({ title: "Secret", folderId: null }) }, owner);
    expect(create.status).toBe(201);
    const noteId = ((await create.json()) as { note: { id: string } }).note.id;

    const hidden = await request(`/notes/${noteId}`, {}, reader);
    expect(hidden.status).toBe(404);

    const save = await request(`/notes/${noteId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ title: "Secret", markdown: "# First\n\npassword = hunter2", revision: 1 })
    }, owner);
    expect(save.status).toBe(200);
    expect(((await save.json()) as { revision: number }).revision).toBe(2);

    const publish = await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    expect(publish.status).toBe(200);
    expect(((await publish.json()) as { version: number }).version).toBe(1);

    const share = await request(`/notes/${noteId}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ visibility: "selected", userIds: [reader.userId] })
    }, owner);
    expect(share.status).toBe(200);

    const visible = await request(`/notes/${noteId}`, {}, reader);
    expect(visible.status).toBe(200);
    const sharedBody = await visible.json() as { note: { markdown: string; isOwner: boolean } };
    expect(sharedBody.note.markdown).toContain("hunter2");
    expect(sharedBody.note.isOwner).toBe(false);

    const readerEdit = await request(`/notes/${noteId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ title: "Stolen", markdown: "changed", revision: null })
    }, reader);
    expect(readerEdit.status).toBe(404);

    const versions = await request(`/notes/${noteId}/versions`, {}, reader);
    expect(versions.status).toBe(200);
    expect(((await versions.json()) as { versions: unknown[] }).versions).toHaveLength(1);
  }, 20_000);

  test("serializes concurrent draft saves and publishes", async () => {
    const owner = await register("Concurrent owner");
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ title: "Race test", folderId: null }) }, owner);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;

    const save = (markdown: string) => request(`/notes/${noteId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ title: "Race test", markdown, revision: 1 })
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
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ title: "Path test", folderId: null }) }, owner);
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
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ title: "Recovery", folderId: null }) }, owner);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;
    await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ title: "Recovery", markdown: "version one", revision: 1 }) }, owner);
    await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ title: "Recovery", markdown: "version two", revision: null }) }, owner);

    const versionsDir = join(dataDir, "notes", noteId, "versions");
    mkdirSync(versionsDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(versionsDir, "000002.md"), "orphan from interrupted publish", { mode: 0o600 });
    const publish = await request(`/notes/${noteId}/publish`, { method: "POST", body: "{}" }, owner);
    expect(publish.status).toBe(200);

    const version = await request(`/notes/${noteId}/versions/2`, {}, owner);
    expect(((await version.json()) as { markdown: string }).markdown).toBe("version two");
    const titlePatch = await request(`/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ title: "Bypass attempt" }) }, owner);
    expect(titlePatch.status).toBe(409);
  });
});
