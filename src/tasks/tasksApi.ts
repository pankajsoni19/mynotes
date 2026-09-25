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

export type BoardColumn = { id: string; board_id: string; name: string; position: number; created_at: string; updated_at: string };

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
  comment_count: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

export type BoardDetail = { board: BoardSummary; columns: BoardColumn[]; cards: CardSummary[] };

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listBoards = () => api<{ boards: BoardSummary[] }>("/tasks/boards");
export const createBoard = (name: string) => api<{ board: BoardSummary; columns: BoardColumn[] }>("/tasks/boards", json("POST", { name }));
export const getBoard = (boardId: string) => api<BoardDetail>(`/tasks/boards/${boardId}`);
export const renameBoard = (boardId: string, name: string) => api<{ board: BoardSummary }>(`/tasks/boards/${boardId}`, json("PATCH", { name }));
export const getBoardSharing = (boardId: string) => api<{ visibility: BoardVisibility; users: Array<{ id: string; display_name: string }> }>(`/tasks/boards/${boardId}/sharing`);
export const saveBoardSharing = (boardId: string, visibility: BoardVisibility, userIds: string[]) =>
  api<{ ok: true }>(`/tasks/boards/${boardId}/sharing`, json("PUT", { visibility, userIds: visibility === "selected" ? userIds : [] }));

export const createColumn = (boardId: string, name: string, afterColumnId?: string | null) =>
  api<{ column: BoardColumn; columns: BoardColumn[] }>(`/tasks/boards/${boardId}/columns`, json("POST", afterColumnId === undefined ? { name } : { name, afterColumnId }));
export const updateColumn = (columnId: string, change: { name?: string; afterColumnId?: string | null }) =>
  api<{ column: BoardColumn; columns: BoardColumn[] }>(`/tasks/columns/${columnId}`, json("PATCH", change));
export const deleteColumn = (columnId: string) => api<{ ok: true; columns: BoardColumn[] }>(`/tasks/columns/${columnId}`, json("DELETE", {}));

export const createCard = (boardId: string, columnId: string, title: string) =>
  api<{ card: CardSummary }>(`/tasks/boards/${boardId}/cards`, json("POST", { columnId, title }));
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
export type CardView = { card: CardDetail; comments: CardComment[]; hasMoreComments: boolean; attachments: CardAttachment[] };

export const getCard = (cardId: string) => api<CardView>(`/tasks/cards/${cardId}`);
export const updateCard = (cardId: string, change: { title?: string; description?: string; revision: number }) =>
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

export const deleteCard = (cardId: string) => api<{ ok: true; purgeAfter: string }>(`/tasks/cards/${cardId}`, json("DELETE", {}));
export const deleteBoard = (boardId: string) => api<{ ok: true; purgeAfter: string }>(`/tasks/boards/${boardId}`, json("DELETE", {}));
export const restoreTaskItem = (type: "card" | "board", id: string) =>
  api<{ ok: true; alreadyRestored?: true; boardId: string; boardName: string; columnId: string | null; columnName: string | null }>(`/bin/${type}/${id}/restore`, json("POST", {}));
