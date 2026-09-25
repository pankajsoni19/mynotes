import { db } from "./db";
import type { PreviewKind } from "./mimeSniff";

export type Visibility = "private" | "selected" | "all_users";

/** The only document shape returned by the API. Never includes sha256, upload_key, paths, or deletion columns. */
export type DocumentSummary = {
  id: string;
  owner_id: string;
  owner_name: string;
  is_owner: 0 | 1;
  folder_id: string | null;
  name: string;
  mime_type: string;
  preview_kind: PreviewKind;
  size_bytes: number;
  visibility: Visibility;
  sharing_override: 0 | 1;
  created_at: string;
  updated_at: string;
};

/**
 * Summary columns as seen by `$userId`. Recipients get `folder_id` only when
 * the folder itself is visible to them (the GET /api/notes rule) and always
 * `sharing_override = 0`. `visibility` is the effective audience.
 */
export const documentSummarySelect = `
  SELECT d.id, d.owner_id, u.display_name AS owner_name,
         CASE WHEN d.owner_id = $userId THEN 1 ELSE 0 END AS is_owner,
         CASE WHEN d.owner_id = $userId OR (d.sharing_override = 0 AND (
           f.visibility = 'all_users' OR (f.visibility = 'selected' AND EXISTS (
             SELECT 1 FROM folder_shares fs WHERE fs.folder_id = f.id AND fs.user_id = $userId
           ))
         )) THEN d.folder_id ELSE NULL END AS folder_id,
         d.name, d.mime_type, d.preview_kind, d.size_bytes,
         CASE WHEN d.sharing_override = 0 THEN COALESCE(f.visibility, 'private') ELSE d.visibility END AS visibility,
         CASE WHEN d.owner_id = $userId THEN d.sharing_override ELSE 0 END AS sharing_override,
         d.created_at, d.updated_at
  FROM documents d JOIN users u ON u.id = d.owner_id LEFT JOIN folders f ON f.id = d.folder_id
`;

/** Summary of a live document owned by `userId`, or null. */
export function ownedDocumentSummary(documentId: string, userId: string) {
  return db.query(`${documentSummarySelect} WHERE d.id = $documentId AND d.owner_id = $userId AND d.deleted_at IS NULL`)
    .get({ documentId, userId }) as DocumentSummary | null;
}
