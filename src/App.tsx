import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePlus2,
  Folder as FolderIcon,
  FolderPlus,
  History,
  Lock,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Share2,
  Sparkles,
  Users,
  X
} from "lucide-react";
import { api, ApiError, setCsrfToken } from "./api";
import { NoteEditor } from "./editor/NoteEditor";
import type { Folder, NoteDetail, NoteSummary, User, Version } from "./types";

type SessionResponse = { user: User; csrfToken: string };
type MobilePanel = "folders" | "notes" | "editor";

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (session: SessionResponse) => void }) {
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = registering
        ? { email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") }
        : { email: form.get("email"), password: form.get("password") };
      const session = await api<SessionResponse>(registering ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setCsrfToken(session.csrfToken);
      onAuthenticated(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark"><Sparkles aria-hidden="true" /></div>
        <div className="auth-heading">
          <span className="eyebrow">MyNotes</span>
          <h1>{registering ? "Create your account" : "Welcome back"}</h1>
          <p>Your private workspace for ideas, passwords, and configuration notes.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          {registering && <label>Name<input name="displayName" autoComplete="name" required maxLength={80} /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? 12 : 1} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
        </form>
        <button className="text-button" onClick={() => { setRegistering(!registering); setError(""); }}>
          {registering ? "Already have an account? Sign in" : "Setting up MyNotes? Create the first account"}
        </button>
        <p className="security-note"><Lock /> Your notes stay on this machine.</p>
      </section>
    </main>
  );
}

function lineDiff(previous: string, current: string) {
  const before = previous.split("\n");
  const after = current.split("\n");
  const rows = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0)) as number[][];
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) rows[i][j] = before[i] === after[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const output: Array<{ kind: "same" | "add" | "remove"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      output.push({ kind: "same", text: before[i] }); i += 1; j += 1;
    } else if (j < after.length && (i === before.length || rows[i][j + 1] >= rows[i + 1][j])) {
      output.push({ kind: "add", text: after[j] }); j += 1;
    } else {
      output.push({ kind: "remove", text: before[i] }); i += 1;
    }
  }
  return output;
}

function HistoryPanel({ note, onClose, onRestored }: { note: NoteDetail; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [currentContent, setCurrentContent] = useState("");
  const [previousContent, setPreviousContent] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ versions: Version[] }>(`/notes/${note.id}/versions`).then(({ versions: items }) => {
      setVersions(items);
      setSelected(items[0]?.version_number ?? null);
    });
  }, [note.id]);

  useEffect(() => {
    if (selected === null) return;
    const index = versions.findIndex((version) => version.version_number === selected);
    Promise.all([
      api<{ markdown: string }>(`/notes/${note.id}/versions/${selected}`),
      index >= 0 && versions[index + 1]
        ? api<{ markdown: string }>(`/notes/${note.id}/versions/${versions[index + 1].version_number}`)
        : Promise.resolve({ markdown: "" })
    ]).then(([current, previous]) => {
      setCurrentContent(current.markdown);
      setPreviousContent(previous.markdown);
    });
  }, [note.id, selected, versions]);

  const diff = useMemo(() => lineDiff(previousContent, currentContent), [previousContent, currentContent]);

  async function restore() {
    if (selected === null) return;
    setBusy(true);
    await api(`/notes/${note.id}/versions/${selected}/restore`, { method: "POST", body: "{}" });
    setBusy(false);
    onRestored();
  }

  return (
    <aside className="side-panel history-panel">
      <header><div><span className="eyebrow">Timeline</span><h2>Version history</h2></div><button className="icon-button" onClick={onClose} aria-label="Close history"><X /></button></header>
      <div className="version-list">
        {versions.map((version) => (
          <button key={version.id} className={selected === version.version_number ? "selected" : ""} onClick={() => setSelected(version.version_number)}>
            <span>Version {version.version_number}</span>
            <small>{version.author_name} · {relativeTime(version.created_at)}</small>
          </button>
        ))}
        {!versions.length && <p className="empty-copy">Publish a draft to create the first version.</p>}
      </div>
      {selected !== null && <>
        <div className="diff-heading"><span>Changes in v{selected}</span><span><i className="diff-add" /> Added <i className="diff-remove" /> Removed</span></div>
        <pre className="diff-view">{diff.map((line, index) => <span key={`${index}-${line.kind}`} className={line.kind}>{line.kind === "add" ? "+ " : line.kind === "remove" ? "− " : "  "}{line.text || " "}</span>)}</pre>
        {note.isOwner && <button className="secondary-button restore-button" disabled={busy} onClick={restore}>Restore as draft</button>}
      </>}
    </aside>
  );
}

function SharePanel({ note, onClose, onChanged }: { note: NoteDetail; onClose: () => void; onChanged: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [visibility, setVisibility] = useState<"private" | "selected" | "all_users">(note.visibility);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ users: User[] }>("/users"),
      api<{ visibility: typeof visibility; users: Array<{ id: string }> }>(`/notes/${note.id}/sharing`)
    ]).then(([allUsers, sharing]) => {
      setUsers(allUsers.users);
      setVisibility(sharing.visibility);
      setSelected(sharing.users.map((user) => user.id));
      setBusy(false);
    });
  }, [note.id]);

  async function save() {
    setBusy(true);
    await api(`/notes/${note.id}/sharing`, { method: "PUT", body: JSON.stringify({ visibility, userIds: visibility === "selected" ? selected : [] }) });
    setBusy(false);
    onChanged();
  }

  return (
    <aside className="side-panel share-panel">
      <header><div><span className="eyebrow">Access</span><h2>Share note</h2></div><button className="icon-button" onClick={onClose} aria-label="Close sharing"><X /></button></header>
      <div className="share-options">
        <label><input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} /><span><Lock />Private<small>Only you can open this note</small></span></label>
        <label><input type="radio" checked={visibility === "selected"} onChange={() => setVisibility("selected")} /><span><Users />Selected people<small>Choose registered users below</small></span></label>
        <label><input type="radio" checked={visibility === "all_users"} onChange={() => setVisibility("all_users")} /><span><Share2 />Everyone here<small>All signed-in users, never public</small></span></label>
      </div>
      {visibility === "selected" && <div className="user-picker">
        {users.map((user) => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={() => setSelected((items) => items.includes(user.id) ? items.filter((id) => id !== user.id) : [...items, user.id])} /><span>{user.displayName}{user.email && <small>{user.email}</small>}</span></label>)}
        {!users.length && <p className="empty-copy">Create another account before sharing with selected people.</p>}
      </div>}
      <button className="primary-button share-save" onClick={save} disabled={busy || (visibility === "selected" && !selected.length)}>Save access</button>
    </aside>
  );
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | "all" | "shared">("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("folders");
  const [panel, setPanel] = useState<"history" | "share" | null>(null);
  const [mobileActions, setMobileActions] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [toast, setToast] = useState("");
  const revisionRef = useRef<number | null>(null);
  const loadedRef = useRef("");

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadNavigation = useCallback(async () => {
    const [{ folders: folderRows }, { notes: noteRows }] = await Promise.all([
      api<{ folders: Folder[] }>("/folders"),
      api<{ notes: NoteSummary[] }>("/notes")
    ]);
    setFolders(folderRows);
    setNotes(noteRows);
  }, []);

  const loadNote = useCallback(async (id: string) => {
    const { note: detail } = await api<{ note: NoteDetail }>(`/notes/${id}`);
    setNote(detail);
    setMarkdown(detail.markdown);
    setTitle(detail.title);
    revisionRef.current = detail.draft_revision;
    loadedRef.current = `${detail.title}\0${detail.markdown}`;
    setSaveState("saved");
  }, []);

  useEffect(() => {
    api<SessionResponse>("/auth/me")
      .then((result) => { setCsrfToken(result.csrfToken); setSession(result); })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => { if (session) loadNavigation(); }, [session, loadNavigation]);
  useEffect(() => { if (selectedNoteId) loadNote(selectedNoteId); else setNote(null); }, [selectedNoteId, loadNote]);

  const saveDraft = useCallback(async () => {
    if (!note?.isOwner || `${title}\0${markdown}` === loadedRef.current) return revisionRef.current;
    setSaveState("saving");
    try {
      const result = await api<{ revision: number }>(`/notes/${note.id}/draft`, {
        method: "PUT",
        body: JSON.stringify({ title: title.trim() || "Untitled note", markdown, revision: revisionRef.current })
      });
      revisionRef.current = result.revision;
      loadedRef.current = `${title}\0${markdown}`;
      setNote((current) => current ? { ...current, title, markdown, hasDraft: true, draft_revision: result.revision } : current);
      setSaveState("saved");
      await loadNavigation();
      return result.revision;
    } catch (reason) {
      setSaveState(reason instanceof ApiError && reason.status === 409 ? "conflict" : "error");
      throw reason;
    }
  }, [loadNavigation, markdown, note, title]);

  useEffect(() => {
    if (!note?.isOwner || `${title}\0${markdown}` === loadedRef.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => saveDraft().catch(() => undefined), 900);
    return () => window.clearTimeout(timer);
  }, [markdown, note?.id, note?.isOwner, saveDraft, title]);

  const visibleNotes = useMemo(() => notes.filter((item) => {
    const inSection = selectedFolder === "all" ? item.is_owner === 1 : selectedFolder === "shared" ? item.is_owner === 0 : item.folder_id === selectedFolder;
    return inSection && item.title.toLowerCase().includes(query.toLowerCase());
  }), [notes, query, selectedFolder]);

  async function createFolder() {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    await api("/folders", { method: "POST", body: JSON.stringify({ name: name.trim(), parentId: null }) });
    await loadNavigation();
  }

  async function createNote() {
    const folderId = typeof selectedFolder === "string" && !["all", "shared"].includes(selectedFolder) ? selectedFolder : null;
    const { note: created } = await api<{ note: { id: string } }>("/notes", { method: "POST", body: JSON.stringify({ title: "Untitled note", folderId }) });
    await loadNavigation();
    setSelectedNoteId(created.id);
    setMobilePanel("editor");
  }

  async function publish() {
    if (!note) return;
    await saveDraft();
    await api(`/notes/${note.id}/publish`, { method: "POST", body: "{}" });
    await Promise.all([loadNote(note.id), loadNavigation()]);
    flash("New version published");
  }

  async function discard() {
    if (!note || !window.confirm("Discard this draft and return to the published version?")) return;
    await api(`/notes/${note.id}/draft`, { method: "DELETE", body: "{}" });
    await Promise.all([loadNote(note.id), loadNavigation()]);
    flash("Draft discarded");
  }

  async function logout() {
    await api("/auth/logout", { method: "POST", body: "{}" });
    setCsrfToken("");
    setSession(null);
  }

  if (checking) return <main className="loading-page"><div className="brand-mark"><Sparkles /></div><span>Opening MyNotes…</span></main>;
  if (!session) return <AuthScreen onAuthenticated={(result) => { setSession(result); setChecking(false); }} />;

  return (
    <main className={`workspace ${collapsed ? "nav-collapsed" : ""}`} data-mobile-panel={mobilePanel}>
      <aside className="folder-pane">
        <header className="sidebar-header">
          <div className="workspace-title"><span className="brand-dot"><Sparkles /></span><span><strong>MyNotes</strong><small>{session.user.displayName}</small></span></div>
          <button className="icon-button desktop-only" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar"><PanelLeftClose /></button>
        </header>
        <nav className="folder-nav" aria-label="Note folders">
          <button className={selectedFolder === "all" ? "active" : ""} onClick={() => { setSelectedFolder("all"); setMobilePanel("notes"); }}><Archive /><span>All notes</span><b>{notes.filter((item) => item.is_owner === 1).length}</b></button>
          <button className={selectedFolder === "shared" ? "active" : ""} onClick={() => { setSelectedFolder("shared"); setMobilePanel("notes"); }}><Users /><span>Shared with me</span><b>{notes.filter((item) => item.is_owner === 0).length}</b></button>
          <div className="nav-label"><span>Folders</span><button onClick={createFolder} aria-label="New folder"><FolderPlus /></button></div>
          {folders.map((folder) => <button key={folder.id} className={selectedFolder === folder.id ? "active" : ""} onClick={() => { setSelectedFolder(folder.id); setMobilePanel("notes"); }}><FolderIcon /><span>{folder.name}</span><b>{notes.filter((item) => item.folder_id === folder.id && item.is_owner === 1).length}</b></button>)}
          {!folders.length && <p className="nav-empty">Create a folder to organize your notes.</p>}
        </nav>
        <footer className="sidebar-footer"><button onClick={logout}><LogOut />Sign out</button></footer>
      </aside>

      <section className="note-pane">
        <header className="note-pane-header">
          <div className="mobile-header"><button className="icon-button" onClick={() => setMobilePanel("folders")}><ChevronLeft /></button><strong>Notes</strong></div>
          <div className="note-heading"><span className="eyebrow">{selectedFolder === "shared" ? "Shared" : "Library"}</span><h1>{selectedFolder === "all" ? "All notes" : selectedFolder === "shared" ? "Shared with me" : folders.find((folder) => folder.id === selectedFolder)?.name}</h1></div>
          <button className="icon-button new-note-button" onClick={createNote} aria-label="New note"><FilePlus2 /></button>
          <label className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></label>
        </header>
        <div className="note-list">
          {visibleNotes.map((item) => <button key={item.id} className={selectedNoteId === item.id ? "selected" : ""} onClick={() => { setSelectedNoteId(item.id); setMobilePanel("editor"); }}>
            <span className="note-title">{item.title}</span>
            <span className="note-meta"><time>{relativeTime(item.updated_at)}</time>{item.draft_revision !== null && item.is_owner === 1 ? <em>Draft</em> : item.visibility !== "private" ? <em><Users /> Shared</em> : null}</span>
            {item.is_owner === 0 && <span className="note-owner">by {item.owner_name}</span>}
          </button>)}
          {!visibleNotes.length && <div className="empty-state"><div><FilePlus2 /></div><h2>No notes here</h2><p>{query ? "Try another search." : selectedFolder === "shared" ? "Notes shared with you will appear here." : "Create a note and start writing."}</p>{!query && selectedFolder !== "shared" && <button onClick={createNote}>New note</button>}</div>}
        </div>
      </section>

      <section className="editor-pane">
        {!note ? <div className="editor-empty"><div className="empty-glyph"><Sparkles /></div><h2>Select a note</h2><p>Choose one from the list or create something new.</p></div> : <>
          <header className="editor-toolbar">
            <div className="mobile-editor-nav"><button className="icon-button" onClick={() => setMobilePanel("notes")}><ChevronLeft /></button></div>
            <button className="icon-button collapsed-trigger" onClick={() => setCollapsed(false)} aria-label="Open sidebar"><PanelLeftOpen /></button>
            <div className={`save-indicator ${saveState}`}><span />{saveState === "saving" ? "Saving…" : saveState === "conflict" ? "Save conflict" : saveState === "error" ? "Not saved" : note.hasDraft ? "Draft saved" : `Version ${note.current_version}`}</div>
            <div className="toolbar-actions">
              <button className="icon-button" onClick={() => setPanel("history")} aria-label="Version history"><History /></button>
              {note.isOwner && <button className="icon-button" onClick={() => setPanel("share")} aria-label="Share note"><Share2 /></button>}
              {note.isOwner && note.hasDraft && <button className="text-action" onClick={discard}>Discard</button>}
              {note.isOwner && <button className="publish-button" onClick={publish}>Publish version</button>}
              <button className="icon-button mobile-more" onClick={() => setMobileActions((open) => !open)} aria-label="More actions"><MoreHorizontal /></button>
            </div>
            {mobileActions && <div className="mobile-actions-menu">
              <button onClick={() => { setPanel("history"); setMobileActions(false); }}><History />Version history</button>
              {note.isOwner && <button onClick={() => { setPanel("share"); setMobileActions(false); }}><Share2 />Share note</button>}
              {note.isOwner && note.hasDraft && <button onClick={() => { setMobileActions(false); discard(); }}><X />Discard draft</button>}
            </div>}
          </header>
          <article className="document-shell">
            <input className="note-title-input" value={title} onChange={(event) => setTitle(event.target.value)} readOnly={!note.isOwner} maxLength={240} aria-label="Note title" />
            <div className="document-meta"><span>{note.isOwner ? "Private workspace" : `Shared by ${note.owner_name}`}</span><i /> <span>{markdown.trim().split(/\s+/).filter(Boolean).length} words</span></div>
            <NoteEditor key={note.id} markdown={markdown} editable={note.isOwner} onChange={setMarkdown} />
          </article>
        </>}
      </section>

      {panel === "history" && note && <HistoryPanel note={note} onClose={() => setPanel(null)} onRestored={async () => { setPanel(null); await loadNote(note.id); await loadNavigation(); flash("Version restored as a draft"); }} />}
      {panel === "share" && note && <SharePanel note={note} onClose={() => setPanel(null)} onChanged={async () => { setPanel(null); await loadNote(note.id); await loadNavigation(); flash("Sharing updated"); }} />}
      {panel && <button className="panel-scrim" onClick={() => setPanel(null)} aria-label="Close panel" />}
      {toast && <div className="toast" role="status">{toast}</div>}
      <nav className="mobile-tabbar">
        <button className={mobilePanel === "folders" ? "active" : ""} onClick={() => setMobilePanel("folders")}><Menu />Folders</button>
        <button className={mobilePanel === "notes" ? "active" : ""} onClick={() => setMobilePanel("notes")}><Archive />Notes</button>
        <button className={mobilePanel === "editor" ? "active" : ""} disabled={!note} onClick={() => setMobilePanel("editor")}><Sparkles />Editor</button>
      </nav>
    </main>
  );
}
