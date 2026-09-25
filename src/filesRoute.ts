import type { FilesNavigationSnapshot, FilesPanel } from "./filesNavigation";
import type { Route } from "./router";

export type FilesRoute = Extract<Route, { app: "files" }>;
export type FilesSelection = { folder: string; documentId: string | null };
export type FilesRouteResolution = FilesSelection & { missing: "document" | "folder" | null };

type FolderRow = { id: string };
type DocumentRow = { id: string; folder_id: string | null; is_owner: number };

export function filesRoute(folder: string, documentId: string | null): FilesRoute {
  return { app: "files", folder, documentId };
}

export function documentInFolder(document: DocumentRow, folder: string) {
  return folder === "all" || (folder === "shared" ? document.is_owner === 0 : document.folder_id === folder);
}

function knownFolder(folder: string, folders: FolderRow[]) {
  return folder === "all" || folder === "shared" || folders.some((item) => item.id === folder);
}

// Maps a Files URL onto loaded data. `document` is the document the URL names, or null when it could
// not be read. A document URL keeps the folder from its own history entry when that still matches,
// then the document's folder (or Shared for another user's file), then the last folder, then "all".
export function resolveFilesRoute(route: FilesRoute, data: { folders: FolderRow[]; document: DocumentRow | null }, context: { snapshot: FilesNavigationSnapshot | null; lastFolder: string }): FilesRouteResolution {
  if (route.documentId) {
    const document = data.document && data.document.id === route.documentId ? data.document : null;
    if (!document) return { folder: "all", documentId: null, missing: "document" };
    const candidates: string[] = [];
    if (context.snapshot?.documentId === document.id) candidates.push(context.snapshot.folder);
    if (document.folder_id && knownFolder(document.folder_id, data.folders)) candidates.push(document.folder_id);
    else if (document.is_owner === 0) candidates.push("shared");
    candidates.push(context.lastFolder);
    const folder = candidates.find((candidate) => knownFolder(candidate, data.folders) && documentInFolder(document, candidate)) ?? "all";
    return { folder, documentId: document.id, missing: null };
  }
  if (!knownFolder(route.folder, data.folders)) return { folder: "all", documentId: null, missing: "folder" };
  return { folder: route.folder, documentId: null, missing: null };
}

// The phone panel for a Files entry: the entry's own hint when it describes the same selection,
// otherwise the preview for an open file, the folders panel for bare /files, and the list elsewhere.
export function resolveFilesPanel(selection: FilesSelection, snapshot: FilesNavigationSnapshot | null): FilesPanel {
  if (snapshot && snapshot.folder === selection.folder && snapshot.documentId === selection.documentId) {
    return snapshot.panel === "preview" && !selection.documentId ? "files" : snapshot.panel;
  }
  if (selection.documentId) return "preview";
  return selection.folder === "all" ? "folders" : "files";
}
