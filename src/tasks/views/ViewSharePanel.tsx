import { useEffect, useState } from "react";
import { Lock, Share2, Users, X } from "lucide-react";
import { api } from "../../api";
import { trapTabKey } from "../../files/Dialog";
import type { User } from "../../types";
import { pickerDetail } from "../taskActions";
import type { BoardVisibility } from "../tasksApi";
import { getViewSharing, saveViewSharing, type TaskView } from "../home/homeApi";
import { ShareRoleHint } from "../../team/roleAccess";

type ViewSharePanelProps = {
  view: Pick<TaskView, "id" | "name" | "visibility" | "owner_id">;
  onClose: () => void;
  onChanged: () => void;
};

// Mirrors BoardSharePanel (same markup and styles) over /api/tasks/views/:id/sharing (§9.2). A view
// is a saved question: recipients run it as themselves and see only cards on boards they can read
// (T115); they cannot change it, only duplicate it (Q13).
export function ViewSharePanel({ view, onClose, onChanged }: ViewSharePanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [visibility, setVisibility] = useState<BoardVisibility>(view.visibility);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api<{ users: User[] }>("/users"), getViewSharing(view.id)]).then(([allUsers, sharing]) => {
      if (!active) return;
      // The owner is never a recipient.
      setUsers(allUsers.users.filter((user) => user.id !== view.owner_id));
      setVisibility(sharing.visibility);
      setSelected(sharing.users.map((user) => user.id));
      setBusy(false);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load sharing");
    });
    return () => { active = false; };
  }, [view.id, view.owner_id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveViewSharing(view.id, visibility, selected);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update sharing");
      setBusy(false);
    }
  }

  const option = (value: BoardVisibility, Icon: typeof Lock, label: string, hint: string) =>
    <label><input type="radio" name="view-visibility" checked={visibility === value} onChange={() => setVisibility(value)} autoFocus={visibility === value} /><span><Icon />{label}<small>{hint}</small></span></label>;

  return <>
    <button className="panel-scrim" onClick={onClose} aria-label="Close sharing" tabIndex={-1} />
    <aside className="side-panel share-panel file-share-panel" role="dialog" aria-modal="true" aria-labelledby="view-share-title" onKeyDown={trapTabKey}>
      <header><div><span className="eyebrow">Access</span><h2 id="view-share-title" title={view.name}>Share view</h2></div><button className="icon-button" onClick={onClose} aria-label="Close sharing"><X /></button></header>
      <p className="task-share-copy">People you share with see the view’s filter and run it as themselves: they only see cards on boards they can already open. Only you can change it; they can duplicate it.</p>
      <div className="share-options" role="radiogroup" aria-label="Who can open this view">
        {option("private", Lock, "Private", "Only you can open this view")}
        {option("selected", Users, "Selected people", "Choose registered users below")}
        {option("all_users", Share2, "Everyone here", "Everyone signed in except guests; never public")}
      </div>
      {visibility === "selected" && <div className="user-picker" role="group" aria-label="People">
        {users.map((user) => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={() => setSelected((items) => items.includes(user.id) ? items.filter((id) => id !== user.id) : [...items, user.id])} /><span>{user.displayName}<ShareRoleHint role={user.role} />{pickerDetail(user, users) && <small>{pickerDetail(user, users)}</small>}</span></label>)}
        {!users.length && <p className="empty-copy">Create another account before sharing with selected people.</p>}
      </div>}
      {error && <p className="file-dialog-error file-share-error" role="alert">{error}</p>}
      <button className="primary-button share-save" onClick={() => { void save(); }} disabled={busy || (visibility === "selected" && !selected.length)}>Save access</button>
    </aside>
  </>;
}
