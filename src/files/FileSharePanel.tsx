import { useEffect, useState } from "react";
import { Folder as FolderIcon, Lock, Share2, Users, X } from "lucide-react";
import { api } from "../api";
import type { DocumentSummary, User } from "../types";
import { getFileSharing, saveFileSharing, type FileSharingVisibility } from "./filesApi";

type FileSharePanelProps = {
  document: DocumentSummary;
  onClose: () => void;
  onChanged: () => void;
};

// Mirrors the notes SharePanel in App.tsx (same markup and styles), over /api/files/:id/sharing.
export function FileSharePanel({ document, onClose, onChanged }: FileSharePanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [visibility, setVisibility] = useState<FileSharingVisibility>("inherit");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api<{ users: User[] }>("/users"), getFileSharing(document.id)]).then(([allUsers, sharing]) => {
      if (!active) return;
      setUsers(allUsers.users);
      setVisibility(sharing.visibility);
      setSelected(sharing.users.map((user) => user.id));
      setBusy(false);
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Could not load sharing");
    });
    return () => { active = false; };
  }, [document.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveFileSharing(document.id, visibility, selected);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update sharing");
      setBusy(false);
    }
  }

  const option = (value: FileSharingVisibility, Icon: typeof Lock, label: string, hint: string) =>
    <label><input type="radio" name="file-visibility" checked={visibility === value} onChange={() => setVisibility(value)} autoFocus={visibility === value} /><span><Icon />{label}<small>{hint}</small></span></label>;

  return <>
    <button className="panel-scrim" onClick={onClose} aria-label="Close sharing" tabIndex={-1} />
    <aside className="side-panel share-panel file-share-panel" role="dialog" aria-modal="true" aria-labelledby="file-share-title">
      <header><div><span className="eyebrow">Access</span><h2 id="file-share-title" title={document.name}>Share file</h2></div><button className="icon-button" onClick={onClose} aria-label="Close sharing"><X /></button></header>
      <div className="share-options" role="radiogroup" aria-label="Who can open this file">
        {option("inherit", FolderIcon, "Use folder access", "Inherit this file’s folder sharing")}
        {option("private", Lock, "Private", "Only you can open this file")}
        {option("selected", Users, "Selected people", "Choose registered users below")}
        {option("all_users", Share2, "Everyone here", "All signed-in users, never public")}
      </div>
      {visibility === "selected" && <div className="user-picker" role="group" aria-label="People">
        {users.map((user) => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={() => setSelected((items) => items.includes(user.id) ? items.filter((id) => id !== user.id) : [...items, user.id])} /><span>{user.displayName}{user.email && <small>{user.email}</small>}</span></label>)}
        {!users.length && <p className="empty-copy">Create another account before sharing with selected people.</p>}
      </div>}
      {error && <p className="file-dialog-error file-share-error" role="alert">{error}</p>}
      <button className="primary-button share-save" onClick={() => { void save(); }} disabled={busy || (visibility === "selected" && !selected.length)}>Save access</button>
    </aside>
  </>;
}
