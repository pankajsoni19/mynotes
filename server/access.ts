import { db, type NoteRow } from "./db";

const readableSql = `
  SELECT n.* FROM notes n
  WHERE n.id = ? AND n.deleted_at IS NULL AND (
    n.owner_id = ? OR n.visibility = 'all_users' OR (
      n.visibility = 'selected' AND EXISTS (
        SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = ?
      )
    )
  )
`;

export function readableNote(noteId: string, userId: string) {
  return db.query(readableSql).get(noteId, userId, userId) as NoteRow | null;
}

export function ownedNote(noteId: string, userId: string) {
  return db.query("SELECT * FROM notes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(noteId, userId) as NoteRow | null;
}

