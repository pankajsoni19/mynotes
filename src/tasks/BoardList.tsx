import { useCallback, useEffect, useState } from "react";
import { KanbanSquare, Pencil, Plus, RotateCcw, Share2, TriangleAlert, Users } from "lucide-react";
import { relativeTime } from "../files/format";
import { NameDialog } from "../files/RenameDialog";
import { BoardSharePanel } from "./BoardSharePanel";
import { cardCountLabel, sharingLabel, validateBoardName } from "./taskActions";
import { createBoard, listBoards, renameBoard, taskErrorMessage, type BoardSummary } from "./tasksApi";
import { useHistoryDialogGuard } from "./useHistoryDialogGuard";

type BoardListProps = {
  onOpen: (board: BoardSummary) => void;
  notify: (message: string) => void;
};

type ListDialog = { kind: "new" } | { kind: "rename" | "share"; boardId: string };

export function BoardList({ onOpen, notify }: BoardListProps) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ListDialog | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setBoards((await listBoards()).boards);
    } catch (reason) {
      setLoadError(taskErrorMessage(reason, "Could not load your boards"));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const closeDialog = useCallback(() => setDialog(null), []);
  useHistoryDialogGuard(dialog !== null, closeDialog);

  const all = boards ?? [];
  const owned = all.filter((board) => board.is_owner === 1);
  const shared = all.filter((board) => board.is_owner !== 1);
  const dialogBoard = dialog && dialog.kind !== "new" ? all.find((board) => board.id === dialog.boardId) ?? null : null;

  async function create(name: string) {
    const { board } = await createBoard(name);
    setDialog(null);
    setBoards((current) => current ? [...current, board] : [board]);
    onOpen(board);
  }

  async function rename(board: BoardSummary, name: string) {
    const { board: saved } = await renameBoard(board.id, name);
    setBoards((current) => current?.map((item) => item.id === saved.id ? saved : item) ?? current);
    setDialog(null);
    notify(`Renamed to “${saved.name}”`);
  }

  const row = (board: BoardSummary) => <li key={board.id} className="task-board-row">
    <button className="task-board-open" onClick={() => onOpen(board)}>
      <span className="task-board-icon" aria-hidden="true"><KanbanSquare /></span>
      <span className="task-board-copy">
        <span className="task-board-name" title={board.name}>{board.name}</span>
        <span className="task-board-meta">
          <span>{cardCountLabel(board.card_count)}</span>
          <time dateTime={board.updated_at}>Updated {relativeTime(board.updated_at)}</time>
          {board.is_owner === 0 ? <span className="owner-badge">{board.owner_name}</span> : board.visibility !== "private" && <span className="task-shared"><Users aria-hidden="true" />{sharingLabel(board.visibility)}</span>}
        </span>
      </span>
    </button>
    {board.is_owner === 1 && <span className="task-board-actions">
      <button className="icon-button" onClick={() => setDialog({ kind: "rename", boardId: board.id })} aria-haspopup="dialog" aria-label={`Rename ${board.name}`} title="Rename"><Pencil /></button>
      <button className="icon-button" onClick={() => setDialog({ kind: "share", boardId: board.id })} aria-haspopup="dialog" aria-label={`Share ${board.name}`} title="Share"><Share2 /></button>
    </span>}
  </li>;

  return <section className="tasks-content" aria-labelledby="tasks-title">
    <div className="tasks-intro">
      <div>
        <span className="eyebrow">Task boards</span>
        <h1 id="tasks-title">Tasks</h1>
        <p>Plan work on boards you share. Everyone with access can add, edit, and move cards.</p>
      </div>
      <button className="primary-button tasks-new-button" onClick={() => setDialog({ kind: "new" })} aria-haspopup="dialog"><Plus />New board</button>
    </div>

    {loadError && <div className="bin-state bin-error" role="alert">
      <span className="bin-state-icon"><TriangleAlert /></span>
      <h2>Could not load your boards</h2>
      <p>{loadError}</p>
      <button className="primary-button" onClick={() => { void load(); }}><RotateCcw />Try again</button>
    </div>}
    {!loadError && !boards && <p className="bin-loading" role="status">Loading boards…</p>}
    {!loadError && boards && !all.length && <div className="bin-state">
      <span className="bin-state-icon"><KanbanSquare /></span>
      <h2>No boards yet</h2>
      <p>Create a board to start with To do, Doing, and Done columns.</p>
      <button className="primary-button" onClick={() => setDialog({ kind: "new" })}><Plus />New board</button>
    </div>}
    {owned.length > 0 && <><h2 className="tasks-section-label">Your boards</h2><ul className="task-board-list" aria-label="Your boards">{owned.map(row)}</ul></>}
    {shared.length > 0 && <><h2 className="tasks-section-label">Shared with you</h2><ul className="task-board-list" aria-label="Boards shared with you">{shared.map(row)}</ul></>}

    {dialog?.kind === "new" && <NameDialog title="New board" eyebrow="Tasks" label="Board name" initialValue="" submitLabel="Create board" hint="Up to 120 characters. It starts with To do, Doing, and Done." validate={(value) => validateBoardName(value)} onSubmit={create} onCancel={closeDialog} />}
    {dialog?.kind === "rename" && dialogBoard && <NameDialog title="Rename board" eyebrow="Tasks" label="Board name" initialValue={dialogBoard.name} submitLabel="Rename" hint="Up to 120 characters." validate={(value) => validateBoardName(value, dialogBoard.name)} onSubmit={(name) => rename(dialogBoard, name)} onCancel={closeDialog} />}
    {dialog?.kind === "share" && dialogBoard && <BoardSharePanel board={dialogBoard} onClose={closeDialog} onChanged={() => {
      setDialog(null);
      notify("Sharing updated");
      void load();
    }} />}
  </section>;
}
