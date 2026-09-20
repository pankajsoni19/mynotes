import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, chmod } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { config } from "./config";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeNoteId(noteId: string) {
  if (!uuidPattern.test(noteId)) throw new Error("Invalid note id");
  return noteId;
}

function withinDataRoot(path: string) {
  const root = resolve(config.dataDir) + sep;
  const target = resolve(path);
  if (!target.startsWith(root)) throw new Error("Unsafe storage path");
  return target;
}

function noteDir(noteId: string) {
  return withinDataRoot(join(config.dataDir, "notes", safeNoteId(noteId)));
}

function versionName(version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Invalid version");
  return `${String(version).padStart(6, "0")}.md`;
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
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
}

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export const checksum = (content: string) => createHash("sha256").update(content).digest("hex");

export const storage = {
  readCurrent: (noteId: string) => readOptional(join(noteDir(noteId), "current.md")),
  readDraft: (noteId: string) => readOptional(join(noteDir(noteId), "draft.md")),
  readVersion: (noteId: string, version: number) => readFile(join(noteDir(noteId), "versions", versionName(version)), "utf8"),
  writeDraft: async (noteId: string, markdown: string) => atomicWrite(join(noteDir(noteId), "draft.md"), markdown),
  publish: async (noteId: string, version: number, markdown: string) => {
    await atomicWrite(join(noteDir(noteId), "versions", versionName(version)), markdown);
    await atomicWrite(join(noteDir(noteId), "current.md"), markdown);
    await rm(join(noteDir(noteId), "draft.md"), { force: true });
  },
  discardDraft: (noteId: string) => rm(join(noteDir(noteId), "draft.md"), { force: true })
};

