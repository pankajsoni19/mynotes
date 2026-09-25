import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { config } from "./config";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const resourceQueues = new Map<string, Promise<void>>();

export const isStorageId = (value: string) => uuidPattern.test(value);

function safeNoteId(noteId: string) {
  if (!uuidPattern.test(noteId)) throw new Error("Invalid note id");
  return noteId;
}

export function withinDataRoot(path: string) {
  const root = resolve(config.dataDir);
  const target = resolve(path);
  if (target !== root && !target.startsWith(root + sep)) throw new Error("Unsafe storage path");
  return target;
}

export async function ensureDirectory(path: string) {
  const target = withinDataRoot(path);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe storage directory");
  await chmod(target, 0o700);
  const root = await realpath(config.dataDir);
  const actual = await realpath(target);
  if (actual !== root && !actual.startsWith(root + sep)) throw new Error("Storage directory escaped data root");
  return actual;
}

async function secureNoteDir(noteId: string) {
  const notes = await ensureDirectory(join(config.dataDir, "notes"));
  return ensureDirectory(join(notes, safeNoteId(noteId)));
}

function versionName(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid version");
  return `${String(version).padStart(6, "0")}.md`;
}

async function assertRegularFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe note file");
}

async function secureRead(path: string) {
  await assertRegularFile(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function atomicWrite(path: string, content: string) {
  await ensureDirectory(dirname(path));
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  await chmod(path, 0o600);
  await syncDirectory(dirname(path));
}

export async function syncDirectory(path: string) {
  try {
    const handle = await open(path, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!(["EINVAL", "ENOTSUP"] as Array<string | undefined>).includes((error as NodeJS.ErrnoException).code)) throw error;
  }
}

async function writeVersionExclusive(path: string, content: string, replaceOrphan: boolean) {
  await ensureDirectory(dirname(path));
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(path, 0o600);
    await syncDirectory(dirname(path));
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existing = await secureRead(path);
  if (checksum(existing) === checksum(content)) return;
  if (!replaceOrphan) throw new Error("Immutable version already exists with different content");
  await atomicWrite(path, content);
}

export const checksum = (content: string) => createHash("sha256").update(content).digest("hex");

/**
 * Serializes async work per resource key. Notes and documents share one queue
 * map, keyed `note:<id>` and `document:<id>`.
 */
export async function withResourceLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = resourceQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const queued = previous.then(() => current);
  resourceQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (resourceQueues.get(key) === queued) resourceQueues.delete(key);
  }
}

export async function withNoteLock<T>(noteId: string, operation: () => Promise<T>): Promise<T> {
  return withResourceLock(`note:${safeNoteId(noteId)}`, operation);
}

export const storage = {
  readCurrent: async (noteId: string) => secureRead(join(await secureNoteDir(noteId), "current.md")),
  readDraft: async (noteId: string) => secureRead(join(await secureNoteDir(noteId), "draft.md")),
  readVersion: async (noteId: string, version: number) => secureRead(join(await secureNoteDir(noteId), "versions", versionName(version))),
  writeDraft: async (noteId: string, markdown: string) => atomicWrite(join(await secureNoteDir(noteId), "draft.md"), markdown),
  stageVersion: async (noteId: string, version: number, markdown: string, replaceOrphan = false) => writeVersionExclusive(join(await secureNoteDir(noteId), "versions", versionName(version)), markdown, replaceOrphan),
  writeCurrentMirror: async (noteId: string, markdown: string) => atomicWrite(join(await secureNoteDir(noteId), "current.md"), markdown),
  finalizePublished: async (noteId: string, markdown: string) => {
    const directory = await secureNoteDir(noteId);
    await atomicWrite(join(directory, "current.md"), markdown);
    await rm(join(directory, "draft.md"), { force: true });
  },
  discardDraft: async (noteId: string) => rm(join(await secureNoteDir(noteId), "draft.md"), { force: true }),
  /**
   * Removes notes/<id> and everything in it. A missing directory is success.
   * Symlinks inside are unlinked, never followed.
   */
  removeNote: async (noteId: string) => {
    const notes = await ensureDirectory(join(config.dataDir, "notes"));
    await rm(withinDataRoot(join(notes, safeNoteId(noteId))), { recursive: true, force: true });
  }
};
