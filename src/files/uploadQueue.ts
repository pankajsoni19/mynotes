// Pure upload queue: the component owns the File objects and XHRs, this module owns the states.
// queued → uploading(progress) → done | failed(error) | canceled; canceled and non-final failures
// can be retried.

export const UPLOAD_CONCURRENCY = 2;

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "canceled";

export type UploadItem = {
  id: string;
  // Sent as Idempotency-Key. It never changes, so a retry after a lost response cannot store twice.
  key: string;
  name: string;
  size: number;
  folderId: string | null;
  status: UploadStatus;
  progress: number;
  error: string | null;
  code: string | null;
  // A failure that the same key and file can never get past (see isFinalUploadFailure).
  final: boolean;
  documentId: string | null;
  // Bumped on every start, so the runner can tell attempts apart.
  attempt: number;
};

export type UploadQueueState = { items: UploadItem[] };

export type NewUpload = { id: string; key: string; name: string; size: number; folderId: string | null };

export type UploadAction =
  | { type: "enqueue"; uploads: NewUpload[] }
  | { type: "start"; id: string }
  | { type: "progress"; id: string; loaded: number; total: number }
  | { type: "succeed"; id: string; documentId: string }
  | { type: "fail"; id: string; error: string; code?: string | null; status?: number }
  | { type: "cancel"; id: string }
  | { type: "retry"; id: string }
  | { type: "clearFinished" };

// The key was already used for a since-deleted file (409), the file is over the limit (413), or
// the request type was rejected (415): retrying with the same key and file fails the same way.
export function isFinalUploadFailure(code: string | null | undefined, status?: number) {
  return code === "IDEMPOTENCY_KEY_USED" || code === "FILE_TOO_LARGE" || status === 413 || status === 415;
}

export function canRetryUpload(item: UploadItem) {
  return item.status === "canceled" || (item.status === "failed" && !item.final);
}

export const emptyUploadQueue: UploadQueueState = { items: [] };

function update(state: UploadQueueState, id: string, change: (item: UploadItem) => UploadItem | null): UploadQueueState {
  let changed = false;
  const items = state.items.map((item) => {
    if (item.id !== id) return item;
    const next = change(item);
    if (!next || next === item) return item;
    changed = true;
    return next;
  });
  return changed ? { items } : state;
}

export function activeUploads(state: UploadQueueState) {
  return state.items.filter((item) => item.status === "uploading").length;
}

export function uploadQueueReducer(state: UploadQueueState, action: UploadAction): UploadQueueState {
  switch (action.type) {
    case "enqueue": {
      const known = new Set(state.items.map((item) => item.id));
      const added = action.uploads.filter((upload) => !known.has(upload.id)).map((upload): UploadItem => ({
        ...upload, status: "queued", progress: 0, error: null, code: null, final: false, documentId: null, attempt: 0
      }));
      return added.length ? { items: [...state.items, ...added] } : state;
    }
    case "start":
      if (activeUploads(state) >= UPLOAD_CONCURRENCY) return state;
      return update(state, action.id, (item) => item.status === "queued" ? { ...item, status: "uploading", progress: 0, error: null, code: null, attempt: item.attempt + 1 } : null);
    case "progress":
      return update(state, action.id, (item) => {
        if (item.status !== "uploading" || action.total <= 0) return null;
        const progress = Math.min(1, Math.max(item.progress, action.loaded / action.total));
        return progress === item.progress ? null : { ...item, progress };
      });
    case "succeed":
      return update(state, action.id, (item) => item.status === "uploading" ? { ...item, status: "done", progress: 1, documentId: action.documentId } : null);
    case "fail":
      return update(state, action.id, (item) => item.status === "uploading" || item.status === "queued" ? { ...item, status: "failed", error: action.error, code: action.code ?? null, final: isFinalUploadFailure(action.code, action.status) } : null);
    case "cancel":
      return update(state, action.id, (item) => item.status === "uploading" || item.status === "queued" ? { ...item, status: "canceled", error: null, code: null } : null);
    case "retry":
      return update(state, action.id, (item) => canRetryUpload(item) ? { ...item, status: "queued", progress: 0, error: null, code: null, final: false } : null);
    case "clearFinished": {
      const items = state.items.filter((item) => item.status !== "done" && item.status !== "canceled");
      return items.length === state.items.length ? state : { items };
    }
  }
}

// Queued items that may start now, oldest first, without exceeding the concurrency cap.
export function uploadsToStart(state: UploadQueueState): UploadItem[] {
  const free = UPLOAD_CONCURRENCY - activeUploads(state);
  return free > 0 ? state.items.filter((item) => item.status === "queued").slice(0, free) : [];
}

export function uploadQueueSummary(state: UploadQueueState) {
  const count = (status: UploadStatus) => state.items.filter((item) => item.status === status).length;
  const parts: string[] = [];
  const pending = count("uploading") + count("queued");
  if (pending) parts.push(`${pending} uploading`);
  if (count("done")) parts.push(`${count("done")} uploaded`);
  if (count("failed")) parts.push(`${count("failed")} failed`);
  if (count("canceled")) parts.push(`${count("canceled")} canceled`);
  return parts.join(", ");
}

/** What the polite live region reads: a short note while uploads run, then "3 uploaded, 1 failed". */
export function uploadAnnouncement(state: UploadQueueState) {
  const count = (status: UploadStatus) => state.items.filter((item) => item.status === status).length;
  const pending = count("uploading") + count("queued");
  if (pending) return pending === 1 ? "Uploading 1 file" : `Uploading ${pending} files`;
  const parts = [`${count("done")} uploaded`];
  if (count("failed")) parts.push(`${count("failed")} failed`);
  if (count("canceled")) parts.push(`${count("canceled")} canceled`);
  return state.items.length ? parts.join(", ") : "";
}
