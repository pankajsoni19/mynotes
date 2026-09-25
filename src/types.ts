export type User = { id: string; email?: string; displayName: string };
export type Folder = {
  id: string;
  owner_id: string;
  owner_name: string;
  parent_id: string | null;
  name: string;
  is_default: number;
  is_owner: number;
  visibility: "private" | "selected" | "all_users";
  created_at: string;
  updated_at: string;
};
export type NoteSummary = {
  id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  visibility: "private" | "selected" | "all_users";
  current_version: number;
  draft_revision: number | null;
  created_at: string;
  updated_at: string;
  owner_name: string;
  is_owner: number;
};
export type NoteDetail = NoteSummary & {
  isOwner: boolean;
  hasDraft: boolean;
  hasDelta: boolean;
  markdown: string;
};
export type Version = {
  id: string;
  version_number: number;
  title: string;
  checksum: string;
  created_at: string;
  author_name: string;
};
export type Visibility = "private" | "selected" | "all_users";
export type PreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "none";
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
export type BinItem = {
  type: "note" | "document" | "calendar" | "event";
  id: string;
  title: string;
  folder_id: string | null;
  folder_name: string | null;
  size_bytes: number | null;
  deleted_at: string;
  purge_after: string;
  purging: boolean;
  /** False for an event the caller deleted on someone else's calendar (restore only). */
  can_purge?: boolean;
};
export type BinRestoreResult = { ok: true; folderId?: string | null; folderName?: string | null; visibility?: Visibility; alreadyRestored?: true; calendarId?: string; calendarName?: string };
