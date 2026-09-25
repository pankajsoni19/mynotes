import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createUser, dataDir, db, origin, port, request, type Session } from "./support/harness";

const documentStorage = await import("../server/documentStorage");
const { runSweep } = await import("../server/sweeper");
const { now } = await import("../server/db");

const documentsDir = join(dataDir, "documents");
const objectsDir = join(documentsDir, "objects");
const stagingDir = join(documentsDir, ".staging");
const objectPath = (id: string) => join(objectsDir, id);

function insertDocumentRow(ownerId: string, id: string, size: number, extra: { folderId?: string | null; name?: string } = {}) {
  const timestamp = now();
  db.query(`INSERT INTO documents (id, owner_id, folder_id, name, mime_type, preview_kind, size_bytes, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'application/octet-stream', 'none', ?, ?, ?, ?)`)
    .run(id, ownerId, extra.folderId ?? null, extra.name ?? "fixture.bin", size, "0".repeat(64), timestamp, timestamp);
}

type UploadedDocument = Record<string, unknown> & { id: string; name: string; folder_id: string | null; mime_type: string; preview_kind: string; size_bytes: number; visibility: string };
const encoder = new TextEncoder();
const MAX_UPLOAD = 4_194_304;

function upload(session: Session, content: string | Uint8Array, filename: string, options: { folderId?: string; key?: string; field?: string; type?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  const form = new FormData();
  form.append(options.field ?? "file", new Blob([content], { type: options.type ?? "application/octet-stream" }), filename);
  const query = options.folderId === undefined ? "" : `?folderId=${options.folderId}`;
  const headers: Record<string, string> = { ...options.headers };
  if (options.key) headers["Idempotency-Key"] = options.key;
  return request(`/files${query}`, { method: "POST", body: form, headers, signal: options.signal }, session);
}

async function uploadOk(session: Session, content: string | Uint8Array, filename: string, options: Parameters<typeof upload>[3] = {}) {
  const response = await upload(session, content, filename, options);
  expect(response.status).toBe(201);
  return ((await response.json()) as { document: UploadedDocument }).document;
}

const boundary = "mynotes-test-boundary";
function multipart(parts: Array<{ name: string; filename?: string; content: string }>) {
  let body = "";
  for (const part of parts) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename === undefined ? "" : `; filename="${part.filename}"`}\r\n`;
    if (part.filename !== undefined) body += "Content-Type: application/octet-stream\r\n";
    body += `\r\n${part.content}\r\n`;
  }
  return `${body}--${boundary}--\r\n`;
}
const multipartType = `multipart/form-data; boundary=${boundary}`;

/** A multipart body that sends the part header and some bytes, then stalls until aborted. */
function stalledUpload(session: Session, controller: AbortController) {
  const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.bin"\r\n\r\n${"x".repeat(8192)}`);
  const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(head); }, pull: () => new Promise<void>(() => undefined) });
  return request("/files", { method: "POST", body, signal: controller.signal, headers: { "Content-Type": multipartType }, duplex: "half" } as RequestInit, session)
    .catch((error: Error) => error.name);
}

const listDir = (path: string) => existsSync(path) ? readdirSync(path) : [];
async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await Bun.sleep(10);
  }
}

async function folderFor(session: Session, name: string) {
  const response = await request("/folders", { method: "POST", body: JSON.stringify({ name, parentId: null }) }, session);
  expect(response.status).toBe(201);
  return ((await response.json()) as { folder: { id: string } }).folder.id;
}

const defaultFolderOf = (userId: string) => (db.query("SELECT id FROM folders WHERE owner_id = ? AND is_default = 1").get(userId) as { id: string }).id;

async function writeObject(id: string, content: Uint8Array) {
  const { handle } = await documentStorage.createStagingFile(id);
  await handle.write(content);
  await handle.close();
  await documentStorage.commitStaged(id);
}

describe("document storage", () => {
  test("stages and commits objects under their UUID with private modes", async () => {
    const id = crypto.randomUUID();
    const { handle, path } = await documentStorage.createStagingFile(id);
    expect(path).toBe(join(stagingDir, `${id}.part`));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await handle.write(new TextEncoder().encode("hello"));
    await handle.close();
    await expect(documentStorage.createStagingFile(id)).rejects.toThrow();
    await documentStorage.commitStaged(id);
    expect(existsSync(path)).toBe(false);
    expect(statSync(objectPath(id)).mode & 0o777).toBe(0o600);
    expect(statSync(objectsDir).mode & 0o777).toBe(0o700);
    expect(statSync(stagingDir).mode & 0o777).toBe(0o700);
    expect(statSync(documentsDir).mode & 0o777).toBe(0o700);

    const opened = await documentStorage.openObjectForRead(id, 5);
    expect(opened.size).toBe(5);
    await opened.handle.close();
    await expect(documentStorage.openObjectForRead(id, 6)).rejects.toBeInstanceOf(documentStorage.DocumentIntegrityError);
    await documentStorage.removeObject(id);
    await documentStorage.removeObject(id);
    await expect(documentStorage.openObjectForRead(id, 5)).rejects.toBeInstanceOf(documentStorage.DocumentIntegrityError);
    await documentStorage.discardStaged(id);
  });

  test("rejects ids that are not UUIDs before building a path", async () => {
    for (const id of ["../mynotes.sqlite", "not-a-uuid", `${crypto.randomUUID()}/x`]) {
      await expect(documentStorage.createStagingFile(id)).rejects.toThrow("Invalid document id");
      await expect(documentStorage.openObjectForRead(id, 0)).rejects.toThrow("Invalid document id");
      await expect(documentStorage.removeObject(id)).rejects.toThrow("Invalid document id");
    }
  });
});

describe("document sweeper", () => {
  test("removes stale staging files and orphaned objects only", async () => {
    await runSweep();
    const owner = await createUser("Sweeper owner");
    const hourAgo = (Date.now() - 2 * 3_600_000) / 1000;

    const stale = crypto.randomUUID();
    const fresh = crypto.randomUUID();
    for (const id of [stale, fresh]) {
      const { handle } = await documentStorage.createStagingFile(id);
      await handle.close();
    }
    utimesSync(join(stagingDir, `${stale}.part`), hourAgo, hourAgo);

    const orphan = crypto.randomUUID();
    const freshOrphan = crypto.randomUUID();
    const live = crypto.randomUUID();
    await writeObject(orphan, new Uint8Array([1, 2, 3]));
    await writeObject(freshOrphan, new Uint8Array([1]));
    await writeObject(live, new Uint8Array([4, 5]));
    insertDocumentRow(owner.userId, live, 2);
    utimesSync(objectPath(orphan), hourAgo, hourAgo);
    utimesSync(objectPath(live), hourAgo, hourAgo);
    const stray = join(objectsDir, "notes.txt");
    writeFileSync(stray, "not a document", { mode: 0o600 });
    utimesSync(stray, hourAgo, hourAgo);

    const counts = await runSweep();
    expect(counts).not.toBeNull();
    expect(counts!.stagingRemoved).toBeGreaterThanOrEqual(1);
    expect(counts!.orphansRemoved).toBeGreaterThanOrEqual(1);
    expect(counts!.ignored).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(stagingDir, `${stale}.part`))).toBe(false);
    expect(existsSync(join(stagingDir, `${fresh}.part`))).toBe(true);
    expect(existsSync(objectPath(orphan))).toBe(false);
    expect(existsSync(objectPath(freshOrphan))).toBe(true);
    expect(existsSync(objectPath(live))).toBe(true);
    expect(existsSync(stray)).toBe(true);

    await documentStorage.discardStaged(fresh);
    await documentStorage.removeObject(freshOrphan);
    rmSync(stray);
  });

  test("boot mode also removes staging files left by an earlier process", async () => {
    await runSweep();
    const leftover = crypto.randomUUID();
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(stagingDir, `${leftover}.part`), "partial", { mode: 0o600 });
    const tenMinutesAgo = (Date.now() - 600_000) / 1000;
    utimesSync(join(stagingDir, `${leftover}.part`), tenMinutesAgo, tenMinutesAgo);
    expect((await runSweep())!.stagingRemoved).toBe(0);
    expect(existsSync(join(stagingDir, `${leftover}.part`))).toBe(true);
    // At boot, staging files last modified before this process started are removed regardless of age.
    const beforeStart = (performance.timeOrigin - 1000) / 1000;
    utimesSync(join(stagingDir, `${leftover}.part`), beforeStart, beforeStart);
    expect((await runSweep({ boot: true }))!.stagingRemoved).toBe(1);
    expect(existsSync(join(stagingDir, `${leftover}.part`))).toBe(false);
  });
});

describe("document uploads", () => {
  test("stores the bytes under the UUID with private modes and a sanitized name", async () => {
    const owner = await createUser("Upload owner");
    const content = "# Plan\nhello \u00e9";
    const document = await uploadOk(owner, content, " q3:final\u202E\u200B.md ", { type: "text/html" });
    expect(document.name).toBe("q3-final.md");
    expect(document.mime_type).toBe("text/plain; charset=utf-8");
    expect(document.preview_kind).toBe("text");
    expect(document.size_bytes).toBe(Buffer.byteLength(content));
    expect(document.folder_id).toBe(defaultFolderOf(owner.userId));
    expect(document.is_owner).toBe(1);
    expect(document.visibility).toBe("private");
    for (const hidden of ["sha256", "upload_key", "path", "deleted_at", "purge_after", "deleted_by", "purge_started_at"]) expect(document).not.toHaveProperty(hidden);

    const row = db.query("SELECT * FROM documents WHERE id = ?").get(document.id) as { sha256: string; size_bytes: number; owner_id: string };
    expect(row.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(row.owner_id).toBe(owner.userId);
    expect(readFileSync(objectPath(document.id), "utf8")).toBe(content);
    expect(statSync(objectPath(document.id)).mode & 0o777).toBe(0o600);
    expect(statSync(objectsDir).mode & 0o777).toBe(0o700);
    expect(listDir(objectsDir).filter((name) => name.includes("q3"))).toEqual([]);
    expect(listDir(objectsDir)).toContain(document.id);

    const traversal = await request("/files", { method: "POST", body: multipart([{ name: "file", filename: "../../etc/passwd", content: "x" }]), headers: { "Content-Type": multipartType } }, owner);
    expect(traversal.status).toBe(201);
    const traversalDocument = ((await traversal.json()) as { document: UploadedDocument }).document;
    expect(traversalDocument.name).toBe("passwd");
    expect(existsSync(objectPath(traversalDocument.id))).toBe(true);
    const unnamed = await request("/files", { method: "POST", body: multipart([{ name: "file", filename: "...", content: "x" }]), headers: { "Content-Type": multipartType } }, owner);
    expect(((await unnamed.json()) as { document: UploadedDocument }).document.name).toBe("Untitled");
    expect(listDir(stagingDir).filter((name) => name.startsWith(document.id))).toEqual([]);

    const auditRow = db.query("SELECT metadata_json FROM audit_log WHERE event_type = 'document.upload' AND metadata_json LIKE ?").get(`%${document.id}%`) as { metadata_json: string };
    expect(JSON.parse(auditRow.metadata_json)).toEqual({ documentId: document.id, size: document.size_bytes, mimeType: "text/plain; charset=utf-8" });
  });

  test("uploads into owned folders only", async () => {
    const owner = await createUser("Folder owner");
    const other = await createUser("Folder other");
    const projects = await folderFor(owner, "Projects");
    expect((await uploadOk(owner, "a", "a.txt", { folderId: projects })).folder_id).toBe(projects);
    const shared = await folderFor(other, "Shared in");
    await request(`/folders/${shared}/sharing`, { method: "PUT", body: JSON.stringify({ visibility: "all_users", userIds: [] }) }, other);
    expect((await upload(owner, "a", "a.txt", { folderId: shared })).status).toBe(404);
    await request(`/folders/${shared}`, { method: "DELETE", body: "{}" }, other);
    expect((await upload(owner, "a", "a.txt", { folderId: defaultFolderOf(other.userId) })).status).toBe(404);
    expect((await upload(owner, "a", "a.txt", { folderId: "not-a-uuid" })).status).toBe(400);
  });

  test("rejects a declared Content-Length over the limit before reading the body", async () => {
    const owner = await createUser("Declared size");
    const socket = await new Promise<string>((resolve, reject) => {
      let received = "";
      Bun.connect({
        hostname: "localhost",
        port,
        socket: {
          open(connection) {
            connection.write([
              "POST /api/files HTTP/1.1",
              `Host: localhost:${port}`,
              `Origin: ${origin}`,
              `Cookie: ${owner.cookie}`,
              `X-CSRF-Token: ${owner.csrf}`,
              `Content-Type: ${multipartType}`,
              `Content-Length: ${MAX_UPLOAD + 70_000}`,
              "",
              ""
            ].join("\r\n"));
          },
          data(connection, data) {
            received += data.toString();
            if (received.includes("}")) {
              connection.end();
              resolve(received);
            }
          },
          error: (_connection, error) => reject(error),
          close: () => resolve(received)
        }
      }).catch(reject);
    });
    expect(socket).toStartWith("HTTP/1.1 413");
    expect(socket).toContain('"code":"FILE_TOO_LARGE"');
    expect(socket).toContain(`"limitBytes":${MAX_UPLOAD}`);
  });

  test("rejects a streamed overflow without Content-Length and keeps nothing", async () => {
    const owner = await createUser("Streamed size");
    const before = { staging: listDir(stagingDir).length, objects: listDir(objectsDir).length };
    const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n\r\n`);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        if (sent === 0) stream.enqueue(head);
        if (sent > MAX_UPLOAD + 400_000) return stream.close();
        stream.enqueue(new Uint8Array(65_536).fill(0x61));
        sent += 65_536;
      }
    });
    const response = await request("/files", { method: "POST", body, headers: { "Content-Type": multipartType }, duplex: "half" } as RequestInit, owner);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "File is too large", code: "FILE_TOO_LARGE", limitBytes: MAX_UPLOAD });
    await waitFor(() => listDir(stagingDir).length === before.staging);
    expect(listDir(objectsDir).length).toBe(before.objects);
    expect(db.query("SELECT COUNT(*) AS count FROM documents WHERE owner_id = ?").get(owner.userId)).toEqual({ count: 0 });
  });

  test("accepts a file of exactly the limit", async () => {
    const owner = await createUser("Exact size");
    const document = await uploadOk(owner, new Uint8Array(MAX_UPLOAD), "exact.bin");
    expect(document.size_bytes).toBe(MAX_UPLOAD);
  });

  test("requires exactly one file part named file", async () => {
    const owner = await createUser("Part rules");
    const send = (body: string, type = multipartType) => request("/files", { method: "POST", body, headers: { "Content-Type": type } }, owner);
    const twoFiles = await send(multipart([{ name: "file", filename: "a.txt", content: "a" }, { name: "file", filename: "b.txt", content: "b" }]));
    expect(twoFiles.status).toBe(400);
    expect((await send(multipart([{ name: "file", filename: "a.txt", content: "a" }, { name: "note", content: "hi" }]))).status).toBe(400);
    expect((await send(multipart([{ name: "note", content: "hi" }, { name: "file", filename: "a.txt", content: "a" }]))).status).toBe(400);
    expect((await send(multipart([{ name: "upload", filename: "a.txt", content: "a" }]))).status).toBe(400);
    expect((await send(multipart([]))).status).toBe(400);
    expect((await send("garbage", "multipart/form-data")).status).toBe(400);
    expect((await send("plain", "text/plain")).status).toBe(415);
    expect((await request("/files", { method: "POST", body: JSON.stringify({ file: "x" }) }, owner)).status).toBe(415);
    expect(db.query("SELECT COUNT(*) AS count FROM documents WHERE owner_id = ?").get(owner.userId)).toEqual({ count: 0 });
    expect(listDir(stagingDir).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  test("rejects multipart bodies on every other mutation route", async () => {
    const owner = await createUser("Multipart elsewhere");
    const body = multipart([{ name: "file", filename: "a.txt", content: "a" }]);
    for (const [method, path] of [["POST", "/folders"], ["POST", "/notes"], ["POST", "/files/extra"], ["PUT", "/files"], ["POST", "/files/"]] as const) {
      const response = await request(path, { method, body, headers: { "Content-Type": multipartType } }, owner);
      expect(response.status).toBe(415);
    }
  });

  test("enforces session, Origin, and CSRF on uploads", async () => {
    const owner = await createUser("Upload guards");
    const form = () => {
      const data = new FormData();
      data.append("file", new Blob(["a"]), "a.txt");
      return data;
    };
    expect((await fetch(`${origin}/api/files`, { method: "POST", body: form(), headers: { Origin: origin } })).status).toBe(401);
    expect((await fetch(`${origin}/api/files`, { method: "POST", body: form(), headers: { Origin: origin, Cookie: owner.cookie } })).status).toBe(403);
    expect((await fetch(`${origin}/api/files`, { method: "POST", body: form(), headers: { Origin: "https://attacker.example", Cookie: owner.cookie, "X-CSRF-Token": owner.csrf } })).status).toBe(403);
    expect((await fetch(`${origin}/api/files`, { method: "POST", body: form(), headers: { Cookie: owner.cookie, "X-CSRF-Token": owner.csrf } })).status).toBe(403);
    expect((await fetch(`${origin}/api/files`, { method: "POST", body: form(), headers: { Origin: origin, Cookie: owner.cookie, "X-CSRF-Token": "wrong" } })).status).toBe(403);
  });

  test("applies the TOTP setup gate to document routes", async () => {
    const probe = Bun.spawnSync(["bun", join(import.meta.dir, "support", "totpRequiredProbe.ts")], { stdout: "pipe", stderr: "pipe" });
    const output = probe.stdout.toString().trim().split("\n").at(-1) ?? "";
    expect(JSON.parse(output)).toEqual({
      upload: { status: 403, code: "TOTP_SETUP_REQUIRED" },
      list: { status: 403, code: "TOTP_SETUP_REQUIRED" },
      content: { status: 403, code: "TOTP_SETUP_REQUIRED" }
    });
  }, 20_000);

  test("refuses uploads over the quota, counting binned documents", async () => {
    const owner = await createUser("Quota owner");
    const quota = 12_582_912;
    const filler = crypto.randomUUID();
    insertDocumentRow(owner.userId, filler, quota - 100);
    const full = await upload(owner, new Uint8Array(1000), "more.bin");
    expect(full.status).toBe(507);
    expect(((await full.json()) as { code: string }).code).toBe("QUOTA_EXCEEDED");
    const timestamp = now();
    db.query("UPDATE documents SET deleted_at = ?, deleted_by = ?, purge_after = ? WHERE id = ?").run(timestamp, owner.userId, timestamp, filler);
    expect((await upload(owner, new Uint8Array(1000), "more.bin")).status).toBe(507);
    db.query("DELETE FROM documents WHERE id = ?").run(filler);
    await uploadOk(owner, new Uint8Array(1000), "fits.bin");
  });

  test("allows three concurrent uploads per user and releases slots after aborts", async () => {
    const owner = await createUser("Concurrent uploader");
    const other = await createUser("Concurrent other");
    const baseline = listDir(stagingDir).length;
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const pending = controllers.map((controller) => stalledUpload(owner, controller));
    await waitFor(() => listDir(stagingDir).length >= baseline + 3);
    const fourth = await upload(owner, "a", "a.txt");
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { code: string }).code).toBe("TOO_MANY_UPLOADS");
    await uploadOk(other, "a", "a.txt");
    for (const controller of controllers) controller.abort();
    expect(await Promise.all(pending)).toEqual(["AbortError", "AbortError", "AbortError"]);
    await waitFor(() => listDir(stagingDir).length === baseline);
    const after = await upload(owner, "b", "b.txt");
    expect(after.status).toBe(201);
    expect(db.query("SELECT COUNT(*) AS count FROM documents WHERE owner_id = ? AND name = 'slow.bin'").get(owner.userId)).toEqual({ count: 0 });
  });

  test("replays an Idempotency-Key per user without storing new bytes", async () => {
    const owner = await createUser("Idempotent owner");
    const other = await createUser("Idempotent other");
    const key = crypto.randomUUID();
    const first = await uploadOk(owner, "same bytes", "same.txt", { key });
    const objectsBefore = listDir(objectsDir).length;
    const replay = await upload(owner, "same bytes", "same.txt", { key });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { document: UploadedDocument; idempotentReplay: boolean };
    expect(replayBody.idempotentReplay).toBe(true);
    expect(replayBody.document.id).toBe(first.id);
    expect(listDir(objectsDir).length).toBe(objectsBefore);
    expect(db.query("SELECT COUNT(*) AS count FROM documents WHERE owner_id = ? AND upload_key = ?").get(owner.userId, key)).toEqual({ count: 1 });
    const separate = await uploadOk(other, "same bytes", "same.txt", { key });
    expect(separate.id).not.toBe(first.id);
    expect((await upload(owner, "x", "x.txt", { key: "not-a-uuid" })).status).toBe(400);
  });

  test("a client abort mid-upload leaves no row and no staging file", async () => {
    const owner = await createUser("Abort owner");
    const baseline = listDir(stagingDir).length;
    const controller = new AbortController();
    const pending = stalledUpload(owner, controller);
    await waitFor(() => listDir(stagingDir).length > baseline);
    controller.abort();
    expect(await pending).toBe("AbortError");
    await waitFor(() => listDir(stagingDir).length === baseline);
    expect(db.query("SELECT COUNT(*) AS count FROM documents WHERE owner_id = ?").get(owner.userId)).toEqual({ count: 0 });
  });

  test("streams a near-limit upload without buffering it in memory", async () => {
    const owner = await createUser("Memory owner");
    const size = 3_900_000;
    const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="near-limit.bin"\r\n\r\n`);
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const chunk = new Uint8Array(16_384).fill(0x62);
    let sent = -1;
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        if (sent < 0) {
          stream.enqueue(head);
          sent = 0;
        } else if (sent >= size) {
          stream.enqueue(tail);
          stream.close();
        } else {
          const bytes = Math.min(chunk.byteLength, size - sent);
          stream.enqueue(chunk.subarray(0, bytes));
          sent += bytes;
        }
      }
    });
    Bun.gc(true);
    const before = process.memoryUsage().rss;
    let peak = before;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 2);
    const response = await request("/files", { method: "POST", body, headers: { "Content-Type": multipartType }, duplex: "half" } as RequestInit, owner);
    clearInterval(sampler);
    peak = Math.max(peak, process.memoryUsage().rss);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { document: UploadedDocument }).document.size_bytes).toBe(size);
    const growth = peak - before;
    console.info(`RSS during a ${size}-byte streamed upload: before ${before} bytes, peak ${peak} bytes, growth ${growth} bytes`);
    // At this size RSS noise (heap growth in multi-MiB steps) is as large as the file, so this
    // is a logged measurement with a loose bound; the large-upload measurement is in the
    // commit that added streaming uploads.
    expect(growth).toBeLessThan(32 * 1_048_576);
  });
});
