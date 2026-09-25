import { audit, db, ensureDefaultFolder, now, type NoteRow } from "./db";
import { indexNote } from "./searchIndex";
import { checksum, storage } from "./storage";
import { deriveNoteTitle } from "./validation";

/**
 * Draft writes shared by the HTTP routes and the MCP tools, so both keep the
 * same revision CAS, title derivation, and same-transaction search index sync
 * (docs/plan/WAVES_7-9.md §2.2, §4.2).
 */

export function hasDraftDelta(note: Pick<NoteRow, "id" | "current_version">, draftChecksum: string) {
  if (note.current_version === 0) return draftChecksum !== checksum("");
  const published = db.query("SELECT checksum FROM note_versions WHERE note_id = ? AND version_number = ?")
    .get(note.id, note.current_version) as { checksum: string } | null;
  if (!published) throw new Error("Published version metadata is missing");
  return draftChecksum !== published.checksum;
}

export type DraftWriteResult = { revision: number; title: string; hasDelta: boolean; savedAt: string };

/**
 * Writes `markdown` as the owner's draft of `note`, which must have been read
 * under the note lock. The caller has already compared the expected revision
 * with `note.draft_revision`; the UPDATE re-checks it, so a lost race returns
 * null and nothing is indexed.
 *
 * `mcpKeyId` records the MCP key that wrote the draft (the "Draft by <key>"
 * badge). Human writes pass undefined and leave any earlier value alone:
 * the draft still holds that key's text until it is published or discarded.
 */
export async function writeDraftLocked(note: NoteRow, userId: string, markdown: string, mcpKeyId?: string): Promise<DraftWriteResult | null> {
  const nextRevision = (note.draft_revision ?? 0) + 1;
  const title = deriveNoteTitle(markdown);
  await storage.writeDraft(note.id, markdown);
  const draftChecksum = checksum(markdown);
  const savedAt = now();
  const saved = db.transaction(() => {
    const result = mcpKeyId === undefined
      ? db.query("UPDATE notes SET title = ?, draft_revision = ?, draft_checksum = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND draft_revision IS ?")
        .run(title, nextRevision, draftChecksum, savedAt, note.id, userId, note.draft_revision)
      : db.query("UPDATE notes SET title = ?, draft_revision = ?, draft_checksum = ?, draft_mcp_key_id = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND draft_revision IS ?")
        .run(title, nextRevision, draftChecksum, mcpKeyId, savedAt, note.id, userId, note.draft_revision);
    if (result.changes !== 1) return false;
    indexNote(note.id, "draft", title, markdown, draftChecksum);
    return true;
  })();
  if (!saved) return null;
  return { revision: nextRevision, title, hasDelta: hasDraftDelta(note, draftChecksum), savedAt };
}

/**
 * Creates a never-published note whose draft is `markdown`, in `folderId` (the
 * caller checked ownership) or the owner's Default folder. The draft is
 * indexed in the insert's transaction. Audited as `note.create`, or as
 * `mcp.note_create` with the key when an MCP key created it.
 */
export async function createDraftNote(userId: string, folderId: string | null, markdown: string, mcp?: { keyId: string }) {
  const id = crypto.randomUUID();
  const timestamp = now();
  const title = markdown === "" ? "New note" : deriveNoteTitle(markdown);
  const targetFolderId = folderId ?? ensureDefaultFolder(userId);
  const draftChecksum = checksum(markdown);
  await storage.writeDraft(id, markdown);
  db.transaction(() => {
    db.query("INSERT INTO notes (id, owner_id, folder_id, title, draft_revision, draft_checksum, draft_mcp_key_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)")
      .run(id, userId, targetFolderId, title, draftChecksum, mcp?.keyId ?? null, timestamp, timestamp);
    if (markdown !== "") indexNote(id, "draft", title, markdown, draftChecksum);
    if (mcp) audit(userId, id, "mcp.note_create", { via: "mcp", keyId: mcp.keyId });
    else audit(userId, id, "note.create");
  })();
  return { id, title, folderId: targetFolderId, revision: 1 };
}
