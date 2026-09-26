import { useEffect, useState } from "react";
import { Eye, Lock, Pencil, Share2, Users, X } from "lucide-react";
import { api } from "../api";
import { trapTabKey } from "../files/Dialog";
import type { User } from "../types";
import { getSharing, saveSharing, type CollectionSummary, type ShareRole, type Visibility } from "./collectionsApi";
import { ShareRoleHint } from "../team/roleAccess";

type CollectionSharePanelProps = {
  /** The list passes a summary, the collection view its detail; only these fields are read. */
  collection: Pick<CollectionSummary, "id" | "name" | "visibility" | "share_role">;
  onClose: () => void;
  onChanged: () => void;
};

// Mirrors BoardSharePanel over /api/collections/:id/sharing, plus the audience role (D54): everyone
// shared with is a viewer or an editor. The owner is never a recipient and alone changes the fields,
// views, and sharing.
export function CollectionSharePanel({ collection, onClose, onChanged }: CollectionSharePanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [visibility, setVisibility] = useState<Visibility>(collection.visibility);
  const [role, setRole] = useState<ShareRole>(collection.share_role);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api<{ users: User[] }>("/users"), getSharing(collection.id)]).then(([allUsers, sharing]) => {
      if (!active) return;
      setUsers(allUsers.users);
      setVisibility(sharing.visibility);
      setRole(sharing.role);
      setSelected(sharing.users.map((user) => user.id));
      setBusy(false);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load sharing");
    });
    return () => { active = false; };
  }, [collection.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveSharing(collection.id, visibility, selected, role);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update sharing");
      setBusy(false);
    }
  }

  const option = (value: Visibility, Icon: typeof Lock, label: string, hint: string) =>
    <label><input type="radio" name="collection-visibility" checked={visibility === value} onChange={() => setVisibility(value)} autoFocus={visibility === value} /><span><Icon />{label}<small>{hint}</small></span></label>;
  const roleOption = (value: ShareRole, Icon: typeof Lock, label: string, hint: string) =>
    <label><input type="radio" name="collection-role" checked={role === value} onChange={() => setRole(value)} disabled={visibility === "private"} /><span><Icon />{label}<small>{hint}</small></span></label>;

  return <>
    <button className="panel-scrim" onClick={onClose} aria-label="Close sharing" tabIndex={-1} />
    <aside className="side-panel share-panel file-share-panel" role="dialog" aria-modal="true" aria-labelledby="collection-share-title" onKeyDown={trapTabKey}>
      <header><div><span className="eyebrow">Access</span><h2 id="collection-share-title" title={collection.name}>Share collection</h2></div><button className="icon-button" onClick={onClose} aria-label="Close sharing"><X /></button></header>
      <div className="share-options" role="radiogroup" aria-label="Who can open this collection">
        {option("private", Lock, "Private", "Only you can open this collection")}
        {option("selected", Users, "Selected people", "Choose registered users below")}
        {option("all_users", Share2, "Everyone here", "All signed-in users, never public")}
      </div>
      {visibility === "selected" && <div className="user-picker" role="group" aria-label="People">
        {users.map((user) => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={() => setSelected((items) => items.includes(user.id) ? items.filter((id) => id !== user.id) : [...items, user.id])} /><span>{user.displayName}<ShareRoleHint role={user.role} />{user.email && <small>{user.email}</small>}</span></label>)}
        {!users.length && <p className="empty-copy">Create another account before sharing with selected people.</p>}
      </div>}
      <div className="share-options collection-share-role" role="radiogroup" aria-label="What they can do">
        {roleOption("viewer", Eye, "View only", "They can read rows and export")}
        {roleOption("editor", Pencil, "Can edit rows", "They can add, change, undo, and delete rows")}
      </div>
      <p className="collection-share-copy">Only you can change the fields, saved views, sharing, or delete the collection.</p>
      {error && <p className="file-dialog-error file-share-error" role="alert">{error}</p>}
      <button className="primary-button share-save" onClick={() => { void save(); }} disabled={busy || (visibility === "selected" && !selected.length)}>Save access</button>
    </aside>
  </>;
}
