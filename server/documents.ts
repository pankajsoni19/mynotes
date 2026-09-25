import { createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import busboy from "busboy";
import type { Context, Hono } from "hono";
import { config } from "./config";
import { audit, db, ensureDefaultFolder, now } from "./db";
import type { AppEnv } from "./auth";
import { ownedDocumentSummary, type DocumentSummary } from "./documentAccess";
import { commitStaged, createStagingFile, discardStaged, removeObject } from "./documentStorage";
import { SNIFF_BYTES, sniff } from "./mimeSniff";
import { sanitizeDisplayName, uuid } from "./validation";

const MAX_CONCURRENT_UPLOADS = 3;
const MULTIPART_OVERHEAD_BYTES = 65_536;

class UploadError extends Error {
  constructor(readonly status: 400 | 404 | 413 | 507, readonly body: Record<string, unknown>) {
    super(String(body.error));
  }
}

const fileTooLarge = () => new UploadError(413, { error: "File is too large", code: "FILE_TOO_LARGE", limitBytes: config.maxUploadBytes });
const badPart = (error = "Upload exactly one file part named file") => new UploadError(400, { error });

/** In-flight upload slots and quota reservations per user. Single process only. */
const inFlight = new Map<string, { count: number; reservedBytes: number }>();

function acquireSlot(userId: string) {
  const entry = inFlight.get(userId) ?? { count: 0, reservedBytes: 0 };
  if (entry.count >= MAX_CONCURRENT_UPLOADS) return null;
  entry.count += 1;
  inFlight.set(userId, entry);
  let reserved = 0;
  let released = false;
  return {
    reserve(bytes: number) {
      entry.reservedBytes += bytes;
      reserved += bytes;
    },
    otherReservations: () => entry.reservedBytes - reserved,
    release() {
      if (released) return;
      released = true;
      entry.count -= 1;
      entry.reservedBytes -= reserved;
      if (entry.count === 0) inFlight.delete(userId);
    }
  };
}

const storedBytes = (userId: string) =>
  (db.query("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM documents WHERE owner_id = ?").get(userId) as { total: number }).total;

const ownsFolder = (folderId: string, userId: string) => Boolean(db.query("SELECT 1 FROM folders WHERE id = ? AND owner_id = ?").get(folderId, userId));

function replayFor(userId: string, uploadKey: string) {
  const existing = db.query("SELECT id, deleted_at FROM documents WHERE owner_id = ? AND upload_key = ?").get(userId, uploadKey) as { id: string; deleted_at: string | null } | null;
  if (!existing) return null;
  if (existing.deleted_at) return { deleted: true as const };
  return { document: ownedDocumentSummary(existing.id, userId)! };
}

type ReceivedFile = { filename: string; size: number; sha256: string; head: Uint8Array };

async function writeFilePart(stream: Readable & { truncated?: boolean }, filename: string, id: string): Promise<ReceivedFile> {
  const { handle } = await createStagingFile(id);
  try {
    const hash = createHash("sha256");
    const head = new Uint8Array(SNIFF_BYTES);
    let headLength = 0;
    let size = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      size += chunk.byteLength;
      hash.update(chunk);
      if (headLength < SNIFF_BYTES) {
        const take = Math.min(SNIFF_BYTES - headLength, chunk.byteLength);
        head.set(chunk.subarray(0, take), headLength);
        headLength += take;
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
        offset += bytesWritten;
      }
    }
    if (stream.truncated || size > config.maxUploadBytes) throw fileTooLarge();
    await handle.sync();
    return { filename, size, sha256: hash.digest("hex"), head: head.subarray(0, headLength) };
  } finally {
    await handle.close();
  }
}

/**
 * Streams exactly one multipart file part into staging. Nothing but the first
 * SNIFF_BYTES is kept in memory; file writes are awaited, so the request body
 * is only read as fast as the disk accepts it.
 */
function receiveSingleFile(request: Request, id: string): Promise<ReceivedFile> {
  let parser: busboy.Busboy;
  try {
    parser = busboy({
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      // busboy emits partsLimit when the count *reaches* the limit and skips later parts
      // silently, so allow two parts and treat reaching two as an extra part. fileSize is
      // limit + 1 because busboy flags a file that reaches the limit exactly as truncated.
      limits: { files: 1, fields: 0, parts: 2, fileSize: config.maxUploadBytes + 1, headerPairs: 20, fieldNameSize: 100 },
      defParamCharset: "utf8"
    });
  } catch {
    return Promise.reject(badPart("Malformed multipart request"));
  }
  if (!request.body) return Promise.reject(badPart("Missing file part"));
  const source = Readable.fromWeb(request.body as unknown as NodeWebReadableStream<Uint8Array>);

  return new Promise<ReceivedFile>((resolve, reject) => {
    let settled = false;
    let fileStream: Readable | null = null;
    let filePromise: Promise<ReceivedFile> | null = null;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      const failure = error instanceof UploadError ? error : badPart("The upload was interrupted or malformed");
      // Tear down after the current busboy callback returns: busboy keeps using its part
      // state after emitting events such as "limit", so destroying it synchronously throws.
      queueMicrotask(() => {
        source.unpipe(parser);
        source.destroy();
        fileStream?.destroy();
        parser.destroy();
        // Wait for the staging handle to close before the caller discards the file.
        void (filePromise ?? Promise.resolve()).catch(() => undefined).finally(() => reject(failure));
      });
    };

    parser.on("file", (field, stream, info) => {
      // Errors on part streams surface through fail(); never leave them unhandled.
      stream.on("error", () => undefined);
      // busboy keeps parsing the chunk it is in after destroy(); never start a file after failing.
      if (settled) {
        stream.resume();
        return;
      }
      if (filePromise || field !== "file") {
        stream.resume();
        fail(badPart());
        return;
      }
      fileStream = stream;
      // Fail as soon as the part exceeds the limit instead of skipping the rest of the body.
      stream.on("limit", () => fail(fileTooLarge()));
      filePromise = writeFilePart(stream, info.filename ?? "", id);
      filePromise.catch(fail);
    });
    parser.on("field", () => fail(badPart()));
    parser.on("fieldsLimit", () => fail(badPart()));
    parser.on("filesLimit", () => fail(badPart()));
    parser.on("partsLimit", () => fail(badPart()));
    parser.on("error", () => fail(badPart("Malformed multipart request")));
    parser.on("close", () => {
      if (settled) return;
      if (!filePromise) return fail(badPart("Missing file part"));
      filePromise.then((received) => {
        if (settled) return;
        settled = true;
        resolve(received);
      }, fail);
    });
    source.on("error", fail);
    request.signal.addEventListener("abort", () => fail(badPart("The upload was interrupted")), { once: true });
    source.pipe(parser);
  });
}

function uploadResponse(c: Context<AppEnv>, document: DocumentSummary, replay: boolean) {
  return replay ? c.json({ document, idempotentReplay: true }, 200) : c.json({ document }, 201);
}

async function handleUpload(c: Context<AppEnv>) {
  const userId = c.get("user").id;
  const folderParam = c.req.query("folderId");
  const folderId = folderParam === undefined ? ensureDefaultFolder(userId) : uuid.parse(folderParam);
  if (!ownsFolder(folderId, userId)) return c.json({ error: "Folder not found" }, 404);

  const keyHeader = c.req.header("Idempotency-Key");
  const uploadKey = keyHeader === undefined ? null : uuid.safeParse(keyHeader.trim().toLowerCase()).data ?? null;
  if (keyHeader !== undefined && !uploadKey) return c.json({ error: "Idempotency-Key must be a UUID" }, 400);
  if (uploadKey) {
    const replay = replayFor(userId, uploadKey);
    if (replay?.deleted) return c.json({ error: "This upload was already stored and has since been deleted", code: "IDEMPOTENCY_KEY_USED" }, 409);
    if (replay) return uploadResponse(c, replay.document, true);
  }

  const lengthHeader = c.req.header("Content-Length");
  const declaredLength = lengthHeader === undefined ? null : Number(lengthHeader);
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) return c.json({ error: "Invalid Content-Length" }, 400);
  if (declaredLength !== null && declaredLength > config.maxUploadBytes + MULTIPART_OVERHEAD_BYTES) {
    return c.json(fileTooLarge().body, 413);
  }

  const slot = acquireSlot(userId);
  if (!slot) return c.json({ error: "Too many uploads in progress. Wait for one to finish.", code: "TOO_MANY_UPLOADS" }, 429);
  const id = crypto.randomUUID();
  let committed = false;
  try {
    const expectedBytes = Math.min(declaredLength ?? config.maxUploadBytes, config.maxUploadBytes);
    const quota = config.userStorageQuotaBytes;
    if (quota > 0 && storedBytes(userId) + slot.otherReservations() + expectedBytes > quota) {
      return c.json({ error: "Storage quota exceeded", code: "QUOTA_EXCEEDED" }, 507);
    }
    slot.reserve(expectedBytes);
    const disk = await statfs(config.dataDir);
    if (disk.bavail * disk.bsize < config.minFreeDiskBytes + expectedBytes) {
      return c.json({ error: "Storage is full", code: "DISK_FULL" }, 507);
    }

    const received = await receiveSingleFile(c.req.raw, id);
    const name = sanitizeDisplayName(received.filename, "upload")!;
    const { mimeType, previewKind } = sniff(received.head, name, received.size);
    await commitStaged(id);
    committed = true;

    let outcome: { replayOf: string } | { created: true };
    try {
      outcome = db.transaction(() => {
        if (uploadKey) {
          const existing = db.query("SELECT id FROM documents WHERE owner_id = ? AND upload_key = ?").get(userId, uploadKey) as { id: string } | null;
          if (existing) return { replayOf: existing.id };
        }
        if (!ownsFolder(folderId, userId)) throw new UploadError(404, { error: "Folder not found" });
        if (quota > 0 && storedBytes(userId) + received.size > quota) throw new UploadError(507, { error: "Storage quota exceeded", code: "QUOTA_EXCEEDED" });
        const timestamp = now();
        db.query(`INSERT INTO documents (id, owner_id, folder_id, name, mime_type, preview_kind, size_bytes, sha256, upload_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, userId, folderId, name, mimeType, previewKind, received.size, received.sha256, uploadKey, timestamp, timestamp);
        audit(userId, null, "document.upload", { documentId: id, size: received.size, mimeType });
        return { created: true as const };
      })();
    } catch (error) {
      await removeObject(id);
      const uniqueRace = uploadKey && (error as { code?: string }).code?.includes("CONSTRAINT")
        && db.query("SELECT 1 FROM documents WHERE owner_id = ? AND upload_key = ?").get(userId, uploadKey);
      if (!uniqueRace) throw error;
      outcome = { replayOf: (db.query("SELECT id FROM documents WHERE owner_id = ? AND upload_key = ?").get(userId, uploadKey) as { id: string }).id };
    }
    if ("replayOf" in outcome) {
      await removeObject(id);
      const replay = replayFor(userId, uploadKey!);
      if (!replay || replay.deleted) return c.json({ error: "This upload was already stored and has since been deleted", code: "IDEMPOTENCY_KEY_USED" }, 409);
      return uploadResponse(c, replay.document, true);
    }
    return uploadResponse(c, ownedDocumentSummary(id, userId)!, false);
  } catch (error) {
    if (error instanceof UploadError) return c.json(error.body, error.status);
    throw error;
  } finally {
    slot.release();
    if (!committed) await discardStaged(id).catch(() => console.error("Could not discard staged upload"));
  }
}

export function registerDocumentRoutes(app: Hono<AppEnv>) {
  app.post("/api/files", handleUpload);
}
