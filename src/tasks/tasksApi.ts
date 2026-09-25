import { api, ApiError } from "../api";

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
