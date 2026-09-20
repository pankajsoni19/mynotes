export type User = { id: string; email: string; displayName: string };
export type Folder = { id: string; parent_id: string | null; name: string; created_at: string; updated_at: string };
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

