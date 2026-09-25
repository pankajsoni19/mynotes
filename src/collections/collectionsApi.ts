import { api, ApiError } from "../api";

/** docs/plan/API_CONTRACTS.md § Collections. */
export type FieldType = "text" | "number" | "date" | "checkbox" | "select" | "multi_select" | "url" | "note" | "file";
export type OptionColor = "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink";
export type SelectOption = { id: string; label: string; color: OptionColor };
export type FieldDefinition = {
  id: string;
  name: string;
  type: FieldType;
  required?: true;
  number?: { decimals: number; unit: string };
  options?: SelectOption[];
};
export type FieldInput = Omit<FieldDefinition, "id" | "required" | "options"> & { id?: string; required?: boolean; options?: Array<{ id?: string; label: string; color: OptionColor }> };
export type Visibility = "private" | "selected" | "all_users";
export type CollectionRole = "owner" | "editor" | "viewer";

export type CollectionSummary = {
  id: string;
  name: string;
  icon: string;
  owner_id: string;
  owner_name: string;
  is_owner: 0 | 1;
  role: CollectionRole;
  visibility: Visibility;
  share_role: "viewer" | "editor";
  row_count: number;
  field_count: number;
  template_id: string | null;
  created_at: string;
  updated_at: string;
};
export type CollectionDetail = CollectionSummary & { fields: FieldDefinition[]; schema_version: number };

export type SortSpec = { fieldId: string; direction: "asc" | "desc" };
export type FilterSpec = { fieldId: string; op: string; value?: string | number | boolean | string[] };
export type ViewConfig = { sort?: SortSpec[]; filters?: FilterSpec[]; hiddenFieldIds?: string[] };
export type CollectionView = { id: string; collection_id: string; name: string; kind: "table" | "board"; config: ViewConfig; position: number; created_at: string; updated_at: string };

export type FieldValue = string | number | boolean | string[];
export type NoteLink = { id: string; title: string } | { id: string; restricted: true };
export type Attachment = { id: string; name: string; mime_type: string; preview_kind: string; size_bytes: number; linked_by: string | null };
export type CollectionRow = {
  id: string;
  collection_id: string;
  position: number;
  title: string;
  values: Record<string, FieldValue>;
  links: Record<string, NoteLink>;
  files?: Record<string, Attachment[]>;
  revision: number;
  can_undo: boolean;
  created_by: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_via_key_id: string | null;
  created_at: string;
  updated_at: string;
};
export type Template = { id: string; name: string; icon: string; description: string; fields: Array<{ name: string; type: FieldType }> };
export type QueryResult = { rows: CollectionRow[]; nextCursor: string | null; schemaVersion: number; total: number };
export type QueryRequest = { viewId?: string; sort?: SortSpec[]; filters?: FilterSpec[]; q?: string; cursor?: string; limit?: number };

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listCollections = () => api<{ collections: CollectionSummary[] }>("/collections");
export const listTemplates = () => api<{ templates: Template[] }>("/collections/templates");
export const createCollection = (body: { name: string; templateId?: string; fields?: FieldInput[]; icon?: string }) =>
  api<{ collection: CollectionDetail }>("/collections", json("POST", body));
export const getCollection = (collectionId: string) =>
  api<{ collection: CollectionDetail; role: CollectionRole; views: CollectionView[] }>(`/collections/${collectionId}`);
export const renameCollection = (collectionId: string, name: string) => api<{ collection: CollectionDetail }>(`/collections/${collectionId}`, json("PATCH", { name }));
export const deleteCollection = (collectionId: string) => api<{ ok: true; purgeAfter: string }>(`/collections/${collectionId}`, json("DELETE", {}));
export const saveSchema = (collectionId: string, fields: FieldInput[], schemaVersion: number) =>
  api<{ collection: CollectionDetail }>(`/collections/${collectionId}/schema`, json("PUT", { fields, schemaVersion }));
export const queryRows = (collectionId: string, body: QueryRequest) => api<QueryResult>(`/collections/${collectionId}/query`, json("POST", body));
export const createRow = (collectionId: string, values: Record<string, unknown>, afterRowId?: string | null) =>
  api<{ row: CollectionRow }>(`/collections/${collectionId}/rows`, json("POST", afterRowId === undefined ? { values } : { values, afterRowId }));
export const getRow = (rowId: string) => api<{ row: CollectionRow; role: CollectionRole; schemaVersion: number }>(`/collections/rows/${rowId}`);
export const patchRow = (rowId: string, values: Record<string, unknown>, revision: number) =>
  api<{ row: CollectionRow }>(`/collections/rows/${rowId}`, json("PATCH", { values, revision }));
export const undoRow = (rowId: string, revision: number) => api<{ row: CollectionRow }>(`/collections/rows/${rowId}/undo`, json("POST", { revision }));
export const deleteRow = (rowId: string) => api<{ ok: true; purgeAfter: string }>(`/collections/rows/${rowId}`, json("DELETE", {}));

export const createView = (collectionId: string, name: string, config: ViewConfig) =>
  api<{ view: CollectionView }>(`/collections/${collectionId}/views`, json("POST", { name, config }));
export const updateView = (viewId: string, change: { name?: string; config?: ViewConfig }) => api<{ view: CollectionView }>(`/collections/views/${viewId}`, json("PATCH", change));
export const deleteView = (viewId: string) => api<{ ok: true }>(`/collections/views/${viewId}`, json("DELETE", {}));

export type ShareRole = "viewer" | "editor";
export type CollectionSharing = { visibility: Visibility; role: ShareRole; users: Array<{ id: string; display_name: string }> };
export const getSharing = (collectionId: string) => api<CollectionSharing>(`/collections/${collectionId}/sharing`);
export const saveSharing = (collectionId: string, visibility: Visibility, userIds: string[], role: ShareRole) =>
  api<{ ok: true }>(`/collections/${collectionId}/sharing`, json("PUT", { visibility, userIds: visibility === "selected" ? userIds : [], role }));

export const errorCode = (reason: unknown) => reason instanceof ApiError && reason.payload && typeof reason.payload === "object"
  ? (reason.payload as { code?: unknown }).code
  : undefined;
export const errorPayload = <T>(reason: unknown) => reason instanceof ApiError ? reason.payload as T : undefined;
export const errorMessage = (reason: unknown, fallback: string) => reason instanceof Error && reason.message ? reason.message : fallback;
