import { db, type NoteRow } from "./db";

const readableSql = `
  SELECT n.* FROM notes n
  WHERE n.id = ? AND n.deleted_at IS NULL AND (
    n.owner_id = ? OR (n.sharing_override = 1 AND (
      n.visibility = 'all_users' OR (n.visibility = 'selected' AND EXISTS (
        SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = ?
      ))
    )) OR (n.sharing_override = 0 AND EXISTS (
      SELECT 1 FROM folders f WHERE f.id = n.folder_id AND (
        f.visibility = 'all_users' OR (f.visibility = 'selected' AND EXISTS (
          SELECT 1 FROM folder_shares fs WHERE fs.folder_id = f.id AND fs.user_id = ?
        ))
      )
    ))
  )
`;

export function readableNote(noteId: string, userId: string) {
  return db.query(readableSql).get(noteId, userId, userId, userId) as NoteRow | null;
}

export function ownedNote(noteId: string, userId: string) {
  return db.query("SELECT * FROM notes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").get(noteId, userId) as NoteRow | null;
}
