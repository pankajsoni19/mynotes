import { purgeAfterFrom } from "../bin";
import { audit, db } from "../db";

export const UNLINKED_ROW_ATTACHMENT_GRACE_MS = 86_400_000;
export const UNLINKED_ROW_ATTACHMENT_BATCH = 100;

/**
 * Sweeper step: `collection_attachment` uploads that never got a row link (a
 * failed link, the 20-per-row cap, a dropped connection) would stay live,
 * hidden, and counted in the quota forever. After 24 hours they move to their
 * uploader's Bin, 100 per run. `deleted_by` stays NULL: no user removed them.
 * Same rule as the Tasks sweep for task attachments.
 */
export function sweepUnlinkedRowAttachments(options: { nowMs?: number } = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const cutoff = new Date(nowMs - UNLINKED_ROW_ATTACHMENT_GRACE_MS).toISOString();
  const rows = db.query(`SELECT d.id FROM documents d
    WHERE d.purpose = 'collection_attachment' AND d.deleted_at IS NULL AND d.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM collection_row_attachments a WHERE a.document_id = d.id)
    ORDER BY d.created_at LIMIT ?`).all(cutoff, UNLINKED_ROW_ATTACHMENT_BATCH) as Array<{ id: string }>;
  if (!rows.length) return 0;
  const deletedAt = new Date(nowMs);
  const purgeAfter = purgeAfterFrom(deletedAt);
  const bin = db.query(`UPDATE documents SET deleted_at = ?, deleted_by = NULL, purge_after = ?
    WHERE id = ? AND purpose = 'collection_attachment' AND deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM collection_row_attachments a WHERE a.document_id = documents.id)`);
  let binned = 0;
  db.transaction(() => {
    for (const { id } of rows) {
      if (bin.run(deletedAt.toISOString(), purgeAfter, id).changes) {
        binned += 1;
        audit(null, null, "document.delete", { documentId: id, reason: "attachment_never_linked" });
      }
    }
  })();
  return binned;
}
