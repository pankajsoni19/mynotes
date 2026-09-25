import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createUser, dataDir, db, origin, request, type Session } from "./support/harness";

const { createMcpApiKey } = await import("../server/mcp");

const noteDir = (id: string) => join(dataDir, "notes", id);
const objectPath = (id: string) => join(dataDir, "documents", "objects", id);

type NoteRowState = { deleted_at: string | null; deleted_by: string | null; purge_after: string | null; purge_started_at: string | null; draft_revision: number | null; draft_checksum: string | null };
const noteRow = (id: string) => db.query("SELECT deleted_at, deleted_by, purge_after, purge_started_at, draft_revision, draft_checksum FROM notes WHERE id = ?").get(id) as NoteRowState | null;

async function json<T>(response: Response) {
  return (await response.json()) as T;
}

async function createNote(session: Session, markdown: string, options: { publish?: boolean; folderId?: string | null } = {}) {
  const created = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: options.folderId ?? null }) }, session);
  expect(created.status).toBe(201);
  const id = (await json<{ note: { id: string } }>(created)).note.id;
  if (markdown !== "") {
    const saved = await request(`/notes/${id}/draft`, { method: "PUT", body: JSON.stringify({ markdown, revision: 1 }) }, session);
    expect(saved.status).toBe(200);
  }
  if (options.publish) expect((await request(`/notes/${id}/publish`, { method: "POST", body: "{}" }, session)).status).toBe(200);
  return id;
}

async function createFolder(session: Session, name: string) {
  const response = await request("/folders", { method: "POST", body: JSON.stringify({ name }) }, session);
  expect(response.status).toBe(201);
  return (await json<{ folder: { id: string } }>(response)).folder.id;
}

async function shareFolderWith(owner: Session, folderId: string, recipient: Session) {
  const response = await request(`/folders/${folderId}/sharing`, { method: "PUT", body: JSON.stringify({ visibility: "selected", userIds: [recipient.userId] }) }, owner);
  expect(response.status).toBe(200);
}

async function uploadDocument(session: Session, content: string, filename: string, folderId?: string) {
  const form = new FormData();
  form.append("file", new Blob([content]), filename);
  const response = await request(`/files${folderId ? `?folderId=${folderId}` : ""}`, { method: "POST", body: form }, session);
  expect(response.status).toBe(201);
  return (await json<{ document: { id: string; folder_id: string } }>(response)).document;
}

const deleteNote = (session: Session, id: string) => request(`/notes/${id}`, { method: "DELETE", body: "{}" }, session);
const discardDraft = (session: Session, id: string) => request(`/notes/${id}/draft`, { method: "DELETE", body: "{}" }, session);
const deleteDocument = (session: Session, id: string) => request(`/files/${id}`, { method: "DELETE", body: "{}" }, session);

function mcpClient(session: Session) {
  const { token } = createMcpApiKey(session.userId, "Bin test client");
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
    });
    expect(response.status).toBe(200);
    return response.text();
  };
}

describe("moving notes and documents to the Bin", () => {
  test("a deleted published note is hidden from every read path for the owner and recipients", async () => {
    const owner = await createUser("Bin owner");
    const recipient = await createUser("Bin recipient");
    const folderId = await createFolder(owner, "Shared for bin");
    await shareFolderWith(owner, folderId, recipient);
    const noteId = await createNote(owner, "# Binned secret title\n\nbody", { publish: true, folderId });
    const ownerMcp = mcpClient(owner);
    const recipientMcp = mcpClient(recipient);

    for (const session of [owner, recipient]) {
      expect((await request(`/notes/${noteId}`, {}, session)).status).toBe(200);
    }
    expect(await recipientMcp("list_notes", {})).toContain("Binned secret title");

    const deleted = await deleteNote(owner, noteId);
    expect(deleted.status).toBe(200);
    const body = await json<{ ok: boolean; purgeAfter: string }>(deleted);
    expect(body.ok).toBe(true);
    const row = noteRow(noteId)!;
    expect(row.deleted_by).toBe(owner.userId);
    expect(Date.parse(row.purge_after!) - Date.parse(row.deleted_at!)).toBe(30 * 86_400_000);
    expect(body.purgeAfter).toBe(row.purge_after!);
    expect(existsSync(join(noteDir(noteId), "versions", "000001.md"))).toBe(true);

    for (const session of [owner, recipient]) {
      const list = await json<{ notes: Array<{ id: string }> }>(await request("/notes", {}, session));
      expect(list.notes.some((note) => note.id === noteId)).toBe(false);
      const inFolder = await json<{ notes: Array<{ id: string }> }>(await request(`/notes?folderId=${folderId}`, {}, session));
      expect(inFolder.notes.some((note) => note.id === noteId)).toBe(false);
      expect((await request(`/notes/${noteId}`, {}, session)).status).toBe(404);
      expect((await request(`/notes/${noteId}/versions`, {}, session)).status).toBe(404);
      expect((await request(`/notes/${noteId}/versions/1`, {}, session)).status).toBe(404);
      expect((await request(`/notes/${noteId}/sharing`, {}, session)).status).toBe(404);
    }
    for (const call of [ownerMcp, recipientMcp]) {
      expect(await call("list_notes", {})).not.toContain("Binned secret title");
      const read = await call("read_note", { noteId });
      expect(read).toContain("Note not found or not published");
      expect(read).not.toContain("body");
    }
    // Owner mutations on a binned note behave as if it were missing.
    expect((await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ markdown: "x", revision: null }) }, owner)).status).toBe(404);
    expect((await request(`/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ folderId: null }) }, owner)).status).toBe(404);
    expect((await request(`/notes/${noteId}/sharing`, { method: "PUT", body: JSON.stringify({ visibility: "all_users", userIds: [] }) }, owner)).status).toBe(404);
    expect((await deleteNote(owner, noteId)).status).toBe(404);
  }, 20_000);

  test("deleting a never-published note with a draft moves it to the Bin with the draft intact", async () => {
    const owner = await createUser("Draft bin owner");
    const noteId = await createNote(owner, "Unpublished thoughts");
    const before = noteRow(noteId)!;
    const deleted = await json<{ ok: boolean; purgeAfter?: string; purged?: boolean }>(await deleteNote(owner, noteId));
    expect(deleted.ok).toBe(true);
    expect(deleted.purged).toBeUndefined();
    expect(deleted.purgeAfter).toBeString();
    const after = noteRow(noteId)!;
    expect(after.deleted_at).not.toBeNull();
    expect(after.draft_revision).toBe(before.draft_revision);
    expect(after.draft_checksum).toBe(before.draft_checksum);
    expect(readFileSync(join(noteDir(noteId), "draft.md"), "utf8")).toBe("Unpublished thoughts");
  });

  test("a blank never-published note is purged immediately and never enters the Bin", async () => {
    const owner = await createUser("Blank owner");
    const noteId = await createNote(owner, "");
    expect(existsSync(noteDir(noteId))).toBe(true);
    const response = await deleteNote(owner, noteId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, purged: true });
    expect(noteRow(noteId)).toBeNull();
    expect(existsSync(noteDir(noteId))).toBe(false);
    const audit = db.query("SELECT actor_id, note_id, metadata_json FROM audit_log WHERE event_type = 'note.purge' AND metadata_json LIKE ?").get(`%${noteId}%`) as { actor_id: string; note_id: string | null; metadata_json: string };
    expect(audit.note_id).toBeNull();
    expect(JSON.parse(audit.metadata_json)).toEqual({ noteId, reason: "blank" });
  });

  test("a whitespace-only draft counts as blank on both delete routes", async () => {
    const owner = await createUser("Whitespace owner");
    const viaDelete = await createNote(owner, "\n");
    expect(await json(await deleteNote(owner, viaDelete))).toEqual({ ok: true, purged: true });
    expect(noteRow(viaDelete)).toBeNull();
    expect(existsSync(noteDir(viaDelete))).toBe(false);

    const viaDiscard = await createNote(owner, "  \n\t ");
    expect(await json(await discardDraft(owner, viaDiscard))).toEqual({ ok: true, purged: true });
    expect(noteRow(viaDiscard)).toBeNull();
    expect(existsSync(noteDir(viaDiscard))).toBe(false);
  });

  test("discarding the draft of a never-published note with content moves it to the Bin and keeps the draft", async () => {
    const owner = await createUser("Discard owner");
    const noteId = await createNote(owner, "Keep me for later");
    const before = noteRow(noteId)!;
    const response = await discardDraft(owner, noteId);
    expect(response.status).toBe(200);
    const body = await json<{ ok: boolean; binned: boolean; purgeAfter: string }>(response);
    expect(body).toMatchObject({ ok: true, binned: true });
    const after = noteRow(noteId)!;
    expect(after.deleted_at).not.toBeNull();
    expect(after.deleted_by).toBe(owner.userId);
    expect(after.draft_revision).toBe(before.draft_revision);
    expect(after.draft_checksum).toBe(before.draft_checksum);
    expect(readFileSync(join(noteDir(noteId), "draft.md"), "utf8")).toBe("Keep me for later");
    expect((await request(`/notes/${noteId}`, {}, owner)).status).toBe(404);

    const blank = await createNote(owner, "");
    expect(await json(await discardDraft(owner, blank))).toEqual({ ok: true, purged: true });
    expect(noteRow(blank)).toBeNull();
  });

  test("discarding the draft of a published note still only drops the draft", async () => {
    const owner = await createUser("Published discard owner");
    const noteId = await createNote(owner, "Published body", { publish: true });
    await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ markdown: "Edited", revision: null }) }, owner);
    expect(await json(await discardDraft(owner, noteId))).toEqual({ ok: true });
    expect(noteRow(noteId)).toMatchObject({ deleted_at: null, draft_revision: null });
  });

  test("deleting a document moves it to the Bin; a second delete reports alreadyDeleted", async () => {
    const owner = await createUser("Document bin owner");
    const recipient = await createUser("Document bin recipient");
    const folderId = await createFolder(owner, "Docs for bin");
    await shareFolderWith(owner, folderId, recipient);
    const document = await uploadDocument(owner, "document body", "report.txt", folderId);
    expect((await request(`/files/${document.id}/content`, {}, recipient)).status).toBe(200);

    const first = await deleteDocument(owner, document.id);
    expect(first.status).toBe(200);
    const firstBody = await json<{ ok: boolean; purgeAfter: string; alreadyDeleted?: boolean }>(first);
    expect(firstBody.alreadyDeleted).toBeUndefined();
    const second = await json<{ ok: boolean; purgeAfter: string; alreadyDeleted: boolean }>(await deleteDocument(owner, document.id));
    expect(second).toEqual({ ok: true, alreadyDeleted: true, purgeAfter: firstBody.purgeAfter });
    expect(existsSync(objectPath(document.id))).toBe(true);

    for (const session of [owner, recipient]) {
      expect((await request(`/files/${document.id}`, {}, session)).status).toBe(404);
      expect((await request(`/files/${document.id}/content`, {}, session)).status).toBe(404);
      const list = await json<{ documents: Array<{ id: string }> }>(await request("/files", {}, session));
      expect(list.documents.some((item) => item.id === document.id)).toBe(false);
    }
    expect((await request(`/files/${document.id}/sharing`, {}, owner)).status).toBe(404);
  });
});
