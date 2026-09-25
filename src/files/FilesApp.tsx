import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, Files, Folder as FolderIcon, House, LogOut, Menu, PanelLeftClose, PanelLeftOpen, RotateCcw, Settings, Sparkles, Upload, Users, X } from "lucide-react";
import { api } from "../api";
import { readHistoryDepth } from "../appShellNavigation";
import { readFilesHistorySnapshot, type FilesNavigationSnapshot, type FilesPanel } from "../filesNavigation";
import { documentInFolder, filesRoute, resolveFilesPanel, resolveFilesRoute, type FilesRoute } from "../filesRoute";
import { isMobileViewport } from "../mobileNavigation";
import { formatRoute, parseRoute, type Route } from "../router";
import type { DocumentSummary, Folder } from "../types";
import { formatBytes, getFile, listFiles, uploadFile, UploadRequestError } from "./filesApi";
import { FilePreview } from "./FilePreview";
import { kindIcon, relativeTime } from "./format";
import { canRetryUpload, emptyUploadQueue, uploadQueueReducer, uploadQueueSummary, uploadsToStart, type UploadItem } from "./uploadQueue";
import "./files.css";

export type FilesNavigate = (route: Route, options?: { replace?: boolean; filesPanel?: FilesPanel }) => void;

type FilesAppProps = {
  userId: string;
  displayName: string;
  navigate: FilesNavigate;
  flash: (message: string) => void;
  onHome: () => void;
  onSettings: () => void;
  onSignOut: () => void;
};

type LoadedData = { folders: Folder[]; documents: DocumentSummary[] };

// Owned folders with Default first, then folders other people shared with the caller.
function orderFolders(folders: Folder[]) {
  const owned = folders.filter((folder) => folder.is_owner === 1);
  owned.sort((left, right) => right.is_default - left.is_default);
  return { owned, shared: folders.filter((folder) => folder.is_owner !== 1) };
}

function mergeDocument(documents: DocumentSummary[], document: DocumentSummary) {
  return [document, ...documents.filter((item) => item.id !== document.id)].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

const statusLabels: Record<UploadItem["status"], string> = { queued: "Waiting", uploading: "Uploading", done: "Uploaded", failed: "Failed", canceled: "Canceled" };

export function FilesApp({ userId, displayName, navigate, flash, onHome, onSettings, onSignOut }: FilesAppProps) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [folder, setFolder] = useState<string>("all");
  const [documentId, setDocumentId] = useState<string | null>(null);
  // A document the URL named that the list does not include (for example beyond the list limit).
  const [extraDocument, setExtraDocument] = useState<DocumentSummary | null>(null);
  const [panel, setPanel] = useState<FilesPanel>("folders");
  const [collapsed, setCollapsed] = useState(false);
  const [queueOpen, setQueueOpen] = useState(true);
  const [queue, dispatch] = useReducer(uploadQueueReducer, emptyUploadQueue);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(new Map<string, File>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const startedRef = useRef(new Set<string>());
  const dataRef = useRef<LoadedData | null>(null);
  dataRef.current = data;
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const routeGenerationRef = useRef(0);

  // Applies a Files URL (first load or Back/Forward) to the loaded data.
  const applyRoute = useCallback(async (route: FilesRoute, snapshot: FilesNavigationSnapshot | null, loaded: LoadedData) => {
    const generation = ++routeGenerationRef.current;
    let named: DocumentSummary | null = null;
    if (route.documentId) {
      named = loaded.documents.find((item) => item.id === route.documentId) ?? null;
      if (!named) named = await getFile(route.documentId).then(({ document }) => document).catch(() => null);
      if (generation !== routeGenerationRef.current) return;
    }
    const resolved = resolveFilesRoute(route, { folders: loaded.folders, document: named }, { snapshot, lastFolder: folderRef.current });
    const nextPanel = resolveFilesPanel(resolved, snapshot);
    setFolder(resolved.folder);
    setDocumentId(resolved.documentId);
    setExtraDocument(named && !loaded.documents.some((item) => item.id === named.id) ? named : null);
    setPanel(nextPanel);
    if (resolved.missing) flash(resolved.missing === "document" ? "File not found" : "Folder not found");
    const target = filesRoute(resolved.folder, resolved.documentId);
    if (resolved.missing || formatRoute(target) !== window.location.pathname) navigate(target, { replace: true, filesPanel: nextPanel });
  }, [flash, navigate]);

  const currentFilesRoute = () => {
    const route = parseRoute(window.location.pathname);
    return route.app === "files" ? route : filesRoute("all", null);
  };

  useEffect(() => {
    let active = true;
    Promise.all([api<{ folders: Folder[] }>("/folders"), listFiles()]).then(([{ folders }, { documents }]) => {
      if (!active) return;
      const loaded = { folders, documents };
      setData(loaded);
      void applyRoute(currentFilesRoute(), readFilesHistorySnapshot(window.history.state, userId), loaded);
    }).catch((reason) => {
      if (active) flash(reason instanceof Error ? reason.message : "Could not load your files");
    });
    return () => { active = false; };
    // The first load only; later URL changes arrive through popstate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const route = parseRoute(window.location.pathname);
      if (route.app !== "files" || !dataRef.current) return;
      void applyRoute(route, readFilesHistorySnapshot(event.state, userId), dataRef.current);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyRoute, userId]);

  // Leaving Files cancels whatever is still uploading.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => { for (const controller of controllers.values()) controller.abort(); controllers.clear(); };
  }, []);

  const folders = data?.folders ?? [];
  const documents = data?.documents ?? [];
  const { owned, shared } = useMemo(() => orderFolders(folders), [folders]);
  const defaultFolder = owned.find((item) => item.is_default === 1 || item.name === "Default") ?? owned[0] ?? null;
  const currentFolder = folders.find((item) => item.id === folder) ?? null;
  const uploadFolderId = folder === "all" ? defaultFolder?.id ?? null : currentFolder?.is_owner === 1 ? currentFolder.id : undefined;
  const canUpload = uploadFolderId !== undefined && data !== null;
  const visible = documents.filter((item) => documentInFolder(item, folder));
  const selected = documents.find((item) => item.id === documentId) ?? (extraDocument?.id === documentId ? extraDocument : null);
  const folderTitle = folder === "all" ? "All files" : folder === "shared" ? "Shared with me" : currentFolder?.name ?? "Folder";
  const pendingUploads = queue.items.filter((item) => item.status === "queued" || item.status === "uploading").length;
  const summary = uploadQueueSummary(queue);

  function folderLabel(document: DocumentSummary) {
    if (!document.folder_id) return "No folder";
    return folders.find((item) => item.id === document.folder_id)?.name ?? "A folder you cannot see";
  }

  function selectFolder(next: string) {
    setFolder(next);
    setDocumentId(null);
    setExtraDocument(null);
    setPanel("files");
    navigate(filesRoute(next, null), { filesPanel: "files" });
  }

  function openDocument(document: DocumentSummary) {
    setDocumentId(document.id);
    setPanel("preview");
    navigate(filesRoute(folder, document.id), { filesPanel: "preview" });
  }

  function showPanel(next: FilesPanel, replace = false) {
    setPanel(next);
    navigate(filesRoute(folder, documentId), { filesPanel: next, replace });
  }

  // Same contract as the Notes Back button: step back through entries this visit pushed, otherwise
  // switch panels in place so the in-app Back never leaves MyNotes.
  function back(fallback: FilesPanel) {
    if (isMobileViewport() && readHistoryDepth(window.history.state) > 0 && readFilesHistorySnapshot(window.history.state, userId)) {
      window.history.back();
      return;
    }
    showPanel(fallback, true);
  }

  function leaveFiles(action: () => void) {
    if (pendingUploads && !window.confirm("Uploads still in progress will be canceled. Leave Files?")) return;
    action();
  }

  function chooseFiles(list: FileList | null) {
    if (!list?.length || uploadFolderId === undefined) return;
    const uploads = Array.from(list).map((file) => {
      const id = crypto.randomUUID();
      filesRef.current.set(id, file);
      return { id, key: crypto.randomUUID(), name: file.name, size: file.size, folderId: uploadFolderId };
    });
    dispatch({ type: "enqueue", uploads });
    setQueueOpen(true);
  }

  // Starts queued uploads as slots free up. Each attempt runs once, even if React re-runs the effect.
  useEffect(() => {
    for (const item of uploadsToStart(queue)) {
      const attemptKey = `${item.id}:${item.attempt + 1}`;
      if (startedRef.current.has(attemptKey)) continue;
      startedRef.current.add(attemptKey);
      const file = filesRef.current.get(item.id);
      dispatch({ type: "start", id: item.id });
      if (!file) {
        dispatch({ type: "fail", id: item.id, error: "The file is no longer available. Choose it again." });
        continue;
      }
      const controller = new AbortController();
      controllersRef.current.set(item.id, controller);
      uploadFile(file, item.folderId, item.key, (loaded, total) => dispatch({ type: "progress", id: item.id, loaded, total }), controller.signal)
        .then(({ document }) => {
          dispatch({ type: "succeed", id: item.id, documentId: document.id });
          filesRef.current.delete(item.id);
          setData((current) => current ? { ...current, documents: mergeDocument(current.documents, document) } : current);
        })
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          dispatch({ type: "fail", id: item.id, error: reason instanceof Error ? reason.message : "Upload failed", code: reason instanceof UploadRequestError ? reason.code : null, status: reason instanceof UploadRequestError ? reason.status : undefined });
        })
        .finally(() => { if (controllersRef.current.get(item.id) === controller) controllersRef.current.delete(item.id); });
    }
  }, [queue]);

  function cancelUpload(id: string) {
    dispatch({ type: "cancel", id });
    controllersRef.current.get(id)?.abort();
  }

  function clearFinished() {
    for (const item of queue.items) if (item.status === "done" || item.status === "canceled") filesRef.current.delete(item.id);
    dispatch({ type: "clearFinished" });
  }

  const uploadDestination = folder === "all" ? defaultFolder?.name ?? "Default" : currentFolder?.name ?? "";

  return <main className={`workspace files-workspace ${collapsed ? "nav-collapsed" : ""}`} data-mobile-panel={panel === "files" ? "notes" : panel === "preview" ? "editor" : "folders"}>
    <aside className="folder-pane" id="file-folders">
      <header className="sidebar-header">
        <button className="sidebar-brand sidebar-home-button" onClick={() => leaveFiles(onHome)} aria-label="Open MyNotes home" title="Back to Home"><span className="brand-dot"><Sparkles /></span><span className="brand-text"><small>MyNotes</small><strong>Files</strong></span></button>
        <button className="icon-button desktop-only" onClick={() => setCollapsed(true)} aria-label="Collapse folders sidebar" aria-controls="file-folders" aria-expanded={!collapsed} title="Collapse folders"><PanelLeftClose /></button>
      </header>
      <nav className="folder-nav" aria-label="File folders">
        <button className="nav-home" onClick={() => leaveFiles(onHome)} title="Back to Home"><House /><span>Home</span></button>
        <button className={folder === "all" ? "active" : ""} aria-current={folder === "all" ? "page" : undefined} onClick={() => selectFolder("all")}><Files /><span>All files</span><b>{documents.length}</b></button>
        <button className={folder === "shared" ? "active" : ""} aria-current={folder === "shared" ? "page" : undefined} onClick={() => selectFolder("shared")}><Users /><span>Shared with me</span><b>{documents.filter((item) => item.is_owner === 0).length}</b></button>
        <div className="nav-label"><span>Folders</span></div>
        {owned.map((item) => <button key={item.id} className={`folder-link${folder === item.id ? " active" : ""}`} aria-current={folder === item.id ? "page" : undefined} onClick={() => selectFolder(item.id)}>
          <FolderIcon /><span className="folder-copy">{item.name}</span><b>{documents.filter((document) => document.folder_id === item.id).length}</b>
        </button>)}
        {shared.length > 0 && <div className="nav-label"><span>Shared folders</span></div>}
        {shared.map((item) => <button key={item.id} className={`folder-link${folder === item.id ? " active" : ""}`} aria-current={folder === item.id ? "page" : undefined} onClick={() => selectFolder(item.id)}>
          <FolderIcon /><span className="folder-copy">{item.name}<small>{item.owner_name}</small></span><b>{documents.filter((document) => document.folder_id === item.id).length}</b>
        </button>)}
      </nav>
      <footer className="sidebar-footer">
        <button className="footer-settings" title={displayName} onClick={onSettings} aria-haspopup="dialog" aria-controls="account-settings-dialog" aria-label={`Open settings for ${displayName}`}>
          <strong>{displayName}</strong>
          <span><Settings />Settings</span>
        </button>
        <button className="footer-signout" onClick={() => leaveFiles(onSignOut)}><LogOut />Sign out</button>
      </footer>
    </aside>

    <section className="note-pane file-pane">
      <header className="note-pane-header">
        <button className="icon-button collapsed-trigger collapsed-sidebar-toggle" onClick={() => setCollapsed(false)} aria-label="Open folders sidebar" aria-controls="file-folders" aria-expanded={!collapsed} title="Open folders"><PanelLeftOpen /><span>Folders</span></button>
        <div className="mobile-header"><button className="icon-button" onClick={() => back("folders")} aria-label="Back to folders"><ChevronLeft /></button><strong>{folderTitle}</strong></div>
        <div className="note-heading"><span className="eyebrow">{folder === "shared" || currentFolder?.is_owner === 0 ? "Shared" : "Library"}</span><h1 title={folderTitle}>{folderTitle}</h1></div>
        <div className="file-header-row">
          <span className="file-count">{visible.length === 1 ? "1 file" : `${visible.length} files`}</span>
          {canUpload && <button className="primary-button files-upload-button" onClick={() => fileInputRef.current?.click()} title={`Upload to ${uploadDestination}`}><Upload />Upload</button>}
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
        </div>
      </header>
      <div className="note-list file-list" role="list" aria-label={folderTitle}>
        {visible.map((item) => {
          const Icon = kindIcon(item.preview_kind);
          return <div role="listitem" key={item.id}>
            <button className={`file-row${documentId === item.id ? " selected" : ""}`} aria-current={documentId === item.id ? "true" : undefined} onClick={() => openDocument(item)}>
              <span className="file-row-icon"><Icon aria-hidden="true" /></span>
              <span className="file-row-copy">
                <span className="file-row-name" title={item.name}>{item.name}</span>
                <span className="file-row-meta"><span>{formatBytes(item.size_bytes)}</span><time dateTime={item.updated_at}>{relativeTime(item.updated_at)}</time>{item.is_owner === 0 && <span className="owner-badge">{item.owner_name}</span>}</span>
              </span>
              {item.visibility !== "private" && <Users className="file-row-shared" aria-label="Shared" />}
            </button>
          </div>;
        })}
        {data && !visible.length && <div className="empty-state"><div><Files /></div><h2>No files here</h2><p>{folder === "shared" ? "Files other people share with you will appear here." : canUpload ? `Upload a file to add it to ${uploadDestination}.` : "Nothing has been shared in this folder yet."}</p>{canUpload && <button onClick={() => fileInputRef.current?.click()}>Upload files</button>}</div>}
        {!data && <p className="file-preview-note">Loading files…</p>}
      </div>
      <p className="sr-only" aria-live="polite">{summary}</p>
      {queue.items.length > 0 && <section className="upload-queue" aria-label="Uploads">
        <header className="upload-queue-header">
          <button className="upload-queue-toggle" onClick={() => setQueueOpen((open) => !open)} aria-expanded={queueOpen} aria-controls="upload-queue-items">{queueOpen ? <ChevronDown /> : <ChevronUp />}<span>{summary}</span></button>
          {queue.items.some((item) => item.status === "done" || item.status === "canceled") && <button className="text-action" onClick={clearFinished}>Clear</button>}
        </header>
        {queueOpen && <ul id="upload-queue-items" className="upload-queue-items">
          {queue.items.map((item) => <li key={item.id} className={`upload-item ${item.status}`}>
            <div className="upload-item-row">
              <span className="upload-item-name" title={item.name}>{item.name}</span>
              <span className="upload-item-status">{item.status === "uploading" ? `${Math.round(item.progress * 100)}%` : statusLabels[item.status]}</span>
              {(item.status === "queued" || item.status === "uploading") && <button className="icon-button" onClick={() => cancelUpload(item.id)} aria-label={`Cancel upload of ${item.name}`} title="Cancel"><X /></button>}
              {canRetryUpload(item) && <button className="icon-button" onClick={() => dispatch({ type: "retry", id: item.id })} aria-label={`Retry upload of ${item.name}`} title="Retry"><RotateCcw /></button>}
            </div>
            <div className="upload-progress" role="progressbar" aria-label={`${item.name} upload progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}><span style={{ width: `${Math.round(item.progress * 100)}%` }} /></div>
            {item.error && <p className="upload-item-error">{item.error}</p>}
          </li>)}
        </ul>}
      </section>}
    </section>

    <section className="editor-pane file-preview-pane">
      {selected
        ? <FilePreview key={selected.id} document={selected} folderName={folderLabel(selected)} onBack={() => back("files")} />
        : <div className="editor-empty"><div className="empty-glyph"><Files /></div><h2>Select a file</h2><p>Choose one from the list to preview it and see its details.</p></div>}
    </section>

    <nav className="mobile-tabbar" aria-label="Files panels">
      <button className={panel === "folders" ? "active" : ""} onClick={() => showPanel("folders")}><Menu />Folders</button>
      <button className={panel === "files" ? "active" : ""} onClick={() => showPanel("files")}><Files />Files</button>
      <button className={panel === "preview" ? "active" : ""} disabled={!selected} onClick={() => showPanel("preview")}><Sparkles />Preview</button>
    </nav>
  </main>;
}
