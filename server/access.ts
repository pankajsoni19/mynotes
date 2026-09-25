import { db, type NoteRow } from "./db";

/**
 * Whether `$userId` may read note `n` (binned or not; callers add
 * `n.deleted_at IS NULL`): the owner; a note-level override (all users, or
 * selected with a share row); or, when inheriting, the immediate folder's
 * visibility and shares. Shared by readableNote and the search API.
 */
export const readableNotePredicate = `(
  n.owner_id = $userId OR (n.sharing_override = 1 AND (
    n.visibility = 'all_users' OR (n.visibility = 'selected' AND EXISTS (
      SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = $userId
    ))
  )) OR (n.sharing_override = 0 AND EXISTS (
    SELECT 1 FROM folders f WHERE f.id = n.folder_id AND (
      f.visibility = 'all_users' OR (f.visibility = 'selected' AND EXISTS (
        SELECT 1 FROM folder_shares fs WHERE fs.folder_id = f.id AND fs.user_id = $userId
      ))
    )
  ))
)`;

const readableSql = `SELECT n.* FROM notes n WHERE n.id = $noteId AND n.deleted_at IS NULL AND ${readableNotePredicate}`;

export function readableNote(noteId: string, userId: string) {
  return db.query(readableSql).get({ noteId, userId }) as NoteRow | null;
}

export function ownedNote(noteId: string, userId: string) {
  return db.query("SELECT * FROM notes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(noteId, userId) as NoteRow | null;
}
