import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = mkdtempSync(join(tmpdir(), "mynotes-test-"));
const origin = "http://localhost:22026";
process.env.DATA_DIR = dataDir;
process.env.APP_ORIGIN = origin;
process.env.PORT = "22026";
process.env.NODE_ENV = "test";

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
  const response = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: `${label}-${crypto.randomUUID()}@example.test`, displayName: label, password: "correct horse battery staple" })
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
});
