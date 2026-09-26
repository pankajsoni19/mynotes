import { api, ApiError, getCsrfToken } from "../api";
import { uploadErrorMessage } from "../files/filesApi";

export type BoardVisibility = "private" | "selected" | "all_users";

/** docs/plan/API_CONTRACTS.md § Tasks. */
export type BoardSummary = {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  is_owner: 0 | 1;
  visibility: BoardVisibility;
  card_count: number;
  created_at: string;
  updated_at: string;
};

/**
 * `is_done` (migration 011): cards in done columns are left out of Today and the due chip.
 * `wip_limit` (migration 015, D108): at most this many cards, or null for no limit; only the owner sets it.
 */
export type BoardColumn = { id: string; board_id: string; name: string; position: number; is_done: 0 | 1; wip_limit?: number | null; created_at: string; updated_at: string };

/** An assignee (D102). `can_read` 0: they lost access to the board ("Former member"); they can only be removed. */
export type CardAssignee = { id: string; display_name: string; can_read: 0 | 1 };

export type CardSummary = {
  id: string;
  board_id: string;
  column_id: string;
  position: number;
  title: string;
  has_description: 0 | 1;
  revision: number;
  created_by: string | null;
  creator_name: string | null;
  /** YYYY-MM-DD or null; the civil date in `due_tz` when the card has a time. */
  due_on: string | null;
  /** "HH:MM" in `due_tz`, or null (D100). */
  due_time?: string | null;
  due_tz?: string | null;
  /** The UTC instant when `due_time` is set. */
  due_at?: string | null;
  /** In assignment order, at most 20 (D102). */
  assignees?: CardAssignee[];
  /** Deprecated (D103): the first assignee. */
  assignee_id: string | null;
  assignee_name: string | null;
  comment_count: number;
  attachment_count: number;
  /** Relations this viewer sees (restricted rows count, hidden binned ones do not), and readable open `depends_on` cards (13D). */
  relation_count?: number;
  open_blockers?: number;
  created_at: string;
  updated_at: string;
};

export type BoardDetail = { board: BoardSummary; columns: BoardColumn[]; cards: CardSummary[] };

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listBoards = () => api<{ boards: BoardSummary[] }>("/tasks/boards");
export const createBoard = (name: string) => api<{ board: BoardSummary; columns: BoardColumn[] }>("/tasks/boards", json("POST", { name }));
export const getBoard = (boardId: string) => api<BoardDetail>(`/tasks/boards/${boardId}`);
export const renameBoard = (boardId: string, name: string) => api<{ board: BoardSummary }>(`/tasks/boards/${boardId}`, json("PATCH", { name }));
export type BoardReader = { id: string; displayName: string };
/**
 * Everyone who can open the board, for the assignee picker: up to 200 without `q`, or a
 * case-insensitive name match (1–64 characters) of at most `limit` (default 20). Display names only.
 */
export function getBoardReaders(boardId: string, options: { q?: string; limit?: number; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q.slice(0, 64));
  if (options.q && options.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return api<{ users: BoardReader[]; truncated?: boolean }>(`/tasks/boards/${boardId}/readers${query ? `?${query}` : ""}`, options.signal ? { signal: options.signal } : {});
}
export const getBoardSharing = (boardId: string) => api<{ visibility: BoardVisibility; users: Array<{ id: string; display_name: string }> }>(`/tasks/boards/${boardId}/sharing`);
export const saveBoardSharing = (boardId: string, visibility: BoardVisibility, userIds: string[]) =>
  api<{ ok: true }>(`/tasks/boards/${boardId}/sharing`, json("PUT", { visibility, userIds: visibility === "selected" ? userIds : [] }));

export const createColumn = (boardId: string, name: string, afterColumnId?: string | null) =>
  api<{ column: BoardColumn; columns: BoardColumn[] }>(`/tasks/boards/${boardId}/columns`, json("POST", afterColumnId === undefined ? { name } : { name, afterColumnId }));
export const updateColumn = (columnId: string, change: { name?: string; afterColumnId?: string | null; isDone?: boolean; wipLimit?: number | null }) =>
  api<{ column: BoardColumn; columns: BoardColumn[] }>(`/tasks/columns/${columnId}`, json("PATCH", change));
export const deleteColumn = (columnId: string) => api<{ ok: true; columns: BoardColumn[] }>(`/tasks/columns/${columnId}`, json("DELETE", {}));

/**
 * One call creates the whole card (the composer, §4.3): fields, relations seen from the new card,
 * and the caller's own unlinked attachment uploads, in one transaction. Any refusal writes nothing.
 */
export type CardCreate = {
  columnId: string;
  title: string;
  description?: string;
  dueOn?: string | null;
  dueTime?: string | null;
  dueTz?: string | null;
  assigneeIds?: string[];
  tagIds?: string[];
  flags?: string[];
  relations?: Array<{ targetCardId: string; type: RelationType }>;
  attachmentIds?: string[];
};
export const createCard = (boardId: string, body: CardCreate) =>
  api<{ card: CardDetail; renormalized?: boolean }>(`/tasks/boards/${boardId}/cards`, json("POST", body));
export const moveCard = (cardId: string, columnId: string, afterCardId: string | null) =>
  api<{ card: CardSummary; renormalized?: boolean; positions?: Array<{ id: string; position: number }> }>(`/tasks/cards/${cardId}/move`, json("POST", { columnId, afterCardId }));

export const taskErrorCode = (reason: unknown) => reason instanceof ApiError && reason.payload && typeof reason.payload === "object"
  ? (reason.payload as { code?: unknown }).code
  : undefined;
export const taskErrorMessage = (reason: unknown, fallback: string) => reason instanceof Error && reason.message ? reason.message : fallback;

export type CardDetail = CardSummary & { description: string };
export type CardComment = {
  id: string;
  card_id: string;
  author_id: string | null;
  author_name: string | null;
  is_author: 0 | 1;
  body: string;
  created_at: string;
  edited_at: string | null;
};
export type CardView = { card: CardDetail; comments: CardComment[]; hasMoreComments: boolean; attachments: CardAttachment[]; relations?: CardRelation[] };

/** A relation as seen from the card in the path (D104, API_CONTRACTS.md § Relations). */
export type RelationType = "relates_to" | "depends_on" | "needed_by" | "duplicates" | "duplicated_by";
export type RelatedCard = { id: string; board_id: string; board_name: string; title: string; column_name: string | null; is_done: 0 | 1; due_on: string | null };
/** A card the viewer cannot read shows only as restricted: no id, title, or board (D105, T90). */
export type CardRelation =
  | { id: string; type: RelationType; restricted: false; created_at: string; creator_name: string | null; card: RelatedCard }
  | { id: string; type: RelationType; restricted: true; created_at: string };
export type CardSearchResult = { id: string; board_id: string; board_name: string; title: string; column_name: string | null; is_done: 0 | 1 };

export const getCard = (cardId: string) => api<CardView>(`/tasks/cards/${cardId}`);
/**
 * A card edit. `dueTime` comes with `dueTz` (the setter's browser zone, D101); `dueTime: null` clears
 * the time, and `dueOn: null` clears both. `assigneeIds` replaces the whole set (`[]` clears it).
 */
export type CardChange = { title?: string; description?: string; dueOn?: string | null; dueTime?: string | null; dueTz?: string; assigneeIds?: string[] };
export const updateCard = (cardId: string, change: CardChange & { revision: number }) =>
  api<{ card: CardDetail }>(`/tasks/cards/${cardId}`, json("PATCH", change));
export const listComments = (cardId: string, before: string) =>
  api<{ comments: CardComment[]; hasMore: boolean }>(`/tasks/cards/${cardId}/comments?before=${encodeURIComponent(before)}`);
export const createComment = (cardId: string, body: string) => api<{ comment: CardComment }>(`/tasks/cards/${cardId}/comments`, json("POST", { body }));
export const updateComment = (commentId: string, body: string) => api<{ comment: CardComment }>(`/tasks/comments/${commentId}`, json("PATCH", { body }));
export const deleteComment = (commentId: string) => api<{ ok: true }>(`/tasks/comments/${commentId}`, json("DELETE", {}));

export type CardAttachment = {
  document_id: string;
  card_id: string;
  comment_id: string | null;
  linked_by: string | null;
  linker_name: string | null;
  name: string;
  mime_type: string;
  preview_kind: string;
  size_bytes: number;
  created_at: string;
};

export type UploadedAttachment = { id: string; name: string; mime_type: string; preview_kind: string; size_bytes: number };

/** Uploads a file as a task attachment (no folder, never in Files). It is readable to the board only once linked. */
export async function uploadAttachment(file: File): Promise<UploadedAttachment> {
  const body = new FormData();
  body.append("file", file, file.name || "attachment");
  const headers = new Headers({ "Idempotency-Key": crypto.randomUUID() });
  const csrf = getCsrfToken();
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const response = await fetch("/api/files?purpose=task_attachment", { method: "POST", body, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({})) as { document?: UploadedAttachment };
  if (!response.ok || !payload.document) throw new Error(uploadErrorMessage(response.status, payload));
  return payload.document;
}

export const linkAttachment = (cardId: string, documentId: string, commentId?: string) =>
  api<{ attachment: CardAttachment }>(`/tasks/cards/${cardId}/attachments`, json("POST", commentId ? { documentId, commentId } : { documentId }));
export const unlinkAttachment = (cardId: string, documentId: string) =>
  api<{ ok: true; movedToBin: boolean }>(`/tasks/cards/${cardId}/attachments/${documentId}`, json("DELETE", {}));
export const createCommentWithFiles = (cardId: string, body: string, attachmentIds: string[]) =>
  api<{ comment: CardComment }>(`/tasks/cards/${cardId}/comments`, json("POST", attachmentIds.length ? { body, attachmentIds } : { body }));

/** Titles of live cards on boards the caller can read (D106): `boardId` sorts first, `excludeCardId` drops the card itself. */
export function searchCards(q: string, options: { boardId?: string; excludeCardId?: string; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams({ q: q.trim().slice(0, 100) });
  if (options.boardId) params.set("boardId", options.boardId);
  if (options.excludeCardId) params.set("excludeCardId", options.excludeCardId);
  return api<{ results: CardSearchResult[]; truncated: boolean }>(`/tasks/cards/search?${params.toString()}`, options.signal ? { signal: options.signal } : {});
}
export const createRelation = (cardId: string, type: RelationType, targetCardId: string) =>
  api<{ relation: CardRelation }>(`/tasks/cards/${cardId}/relations`, json("POST", { type, cardId: targetCardId }));
export const deleteRelation = (cardId: string, relationId: string) =>
  api<{ ok: true }>(`/tasks/cards/${cardId}/relations/${relationId}`, json("DELETE", {}));

export const deleteCard = (cardId: string) => api<{ ok: true; purgeAfter: string }>(`/tasks/cards/${cardId}`, json("DELETE", {}));
export const deleteBoard = (boardId: string) => api<{ ok: true; purgeAfter: string }>(`/tasks/boards/${boardId}`, json("DELETE", {}));
/** `place` (cards only) asks for the old column and neighbour; the server falls back to the bottom. */
export const restoreTaskItem = (type: "card" | "board", id: string, place: { columnId?: string; afterCardId?: string | null } = {}) =>
  api<{ ok: true; alreadyRestored?: true; boardId: string; boardName: string; columnId: string | null; columnName: string | null }>(`/bin/${type}/${id}/restore`, json("POST", place));
