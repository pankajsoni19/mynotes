import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createUser, dataDir, db } from "./support/harness";

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
