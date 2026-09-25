import { useEffect, useState } from "react";
import { Lock, Share2, Users, X } from "lucide-react";
import { api } from "../api";
import type { User } from "../types";
import { trapTabKey } from "../files/Dialog";
import { getBoardSharing, saveBoardSharing, type BoardSummary, type BoardVisibility } from "./tasksApi";

type BoardSharePanelProps = {
  board: BoardSummary;
  onClose: () => void;
  onChanged: () => void;
};

// Mirrors FileSharePanel (same markup and styles) over /api/tasks/boards/:id/sharing. Boards have no
// folder to inherit from. Everyone who can open the board can edit and move its cards (D38).
export function BoardSharePanel({ board, onClose, onChanged }: BoardSharePanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [visibility, setVisibility] = useState<BoardVisibility>(board.visibility);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api<{ users: User[] }>("/users"), getBoardSharing(board.id)]).then(([allUsers, sharing]) => {
      if (!active) return;
      setUsers(allUsers.users);
      setVisibility(sharing.visibility);
      setSelected(sharing.users.map((user) => user.id));
      setBusy(false);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load sharing");
    });
    return () => { active = false; };
  }, [board.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveBoardSharing(board.id, visibility, selected);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update sharing");
      setBusy(false);
    }
  }

  const option = (value: BoardVisibility, Icon: typeof Lock, label: string, hint: string) =>
    <label><input type="radio" name="board-visibility" checked={visibility === value} onChange={() => setVisibility(value)} autoFocus={visibility === value} /><span><Icon />{label}<small>{hint}</small></span></label>;

  return <>
    <button className="panel-scrim" onClick={onClose} aria-label="Close sharing" tabIndex={-1} />
    <aside className="side-panel share-panel file-share-panel" role="dialog" aria-modal="true" aria-labelledby="board-share-title" onKeyDown={trapTabKey}>
      <header><div><span className="eyebrow">Access</span><h2 id="board-share-title" title={board.name}>Share board</h2></div><button className="icon-button" onClick={onClose} aria-label="Close sharing"><X /></button></header>
      <p className="task-share-copy">People with access can add, edit, and move cards. Only you can rename the board, change its columns, or share it.</p>
      <div className="share-options" role="radiogroup" aria-label="Who can open this board">
        {option("private", Lock, "Private", "Only you can open this board")}
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
