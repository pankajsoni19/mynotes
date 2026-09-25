import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Pencil, RotateCcw, Share2, TriangleAlert } from "lucide-react";
import { ApiError } from "../api";
import { NameDialog } from "../files/RenameDialog";
import { BoardSharePanel } from "./BoardSharePanel";
import { cardCountLabel, validateBoardName } from "./taskActions";
import { getBoard, renameBoard, taskErrorMessage, type BoardDetail } from "./tasksApi";
import { useHistoryDialogGuard } from "./useHistoryDialogGuard";

type BoardViewProps = {
  userId: string;
  boardId: string;
  /** A card the URL named; the card dialog arrives with stage B, so the board opens with it in view. */
  focusCardId: string | null;
  onBack: () => void;
  onMissing: () => void;
  notify: (message: string) => void;
};

type BoardDialog = { kind: "rename" | "share" };

export function BoardView({ boardId, focusCardId, onBack, onMissing, notify }: BoardViewProps) {
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BoardDialog | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDetail(await getBoard(boardId));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) onMissing();
      else setLoadError(taskErrorMessage(reason, "Could not load this board"));
    }
  }, [boardId, onMissing]);
  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail || !focusCardId) return;
    window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(focusCardId)}"]`)?.focus();
  }, [detail, focusCardId]);

  const closeDialog = useCallback(() => setDialog(null), []);
  useHistoryDialogGuard(dialog !== null, closeDialog);

  const board = detail?.board ?? null;
  const owner = board?.is_owner === 1;

  async function rename(name: string) {
    const { board: saved } = await renameBoard(boardId, name);
    setDetail((current) => current ? { ...current, board: saved } : current);
    setDialog(null);
    notify(`Renamed to “${saved.name}”`);
  }

  return <section className="task-board" aria-labelledby="task-board-title">
    <header className="task-board-header">
      <button className="icon-button task-back" onClick={onBack} aria-label="Back to boards" title="Back to boards"><ChevronLeft /></button>
      <div className="task-board-heading">
        <span className="eyebrow">{board && !owner ? `${board.owner_name}’s board` : "Board"}</span>
        <h1 id="task-board-title" title={board?.name}>{board?.name ?? "Loading…"}</h1>
      </div>
      {board && <span className="task-board-count">{cardCountLabel(board.card_count)}</span>}
      {owner && <span className="task-board-actions">
        <button className="icon-button" onClick={() => setDialog({ kind: "rename" })} aria-haspopup="dialog" aria-label="Rename board" title="Rename board"><Pencil /></button>
        <button className="icon-button" onClick={() => setDialog({ kind: "share" })} aria-haspopup="dialog" aria-label="Share board" title="Share board"><Share2 /></button>
      </span>}
    </header>

    {loadError && <div className="bin-state bin-error task-board-state" role="alert">
      <span className="bin-state-icon"><TriangleAlert /></span>
      <h2>Could not load this board</h2>
      <p>{loadError}</p>
      <button className="primary-button" onClick={() => { void load(); }}><RotateCcw />Try again</button>
    </div>}
    {!loadError && !detail && <p className="bin-loading task-board-state" role="status">Loading the board…</p>}
    {detail && <div className="task-columns">
      {detail.columns.map((column) => {
        const cards = detail.cards.filter((card) => card.column_id === column.id);
        return <section key={column.id} className="task-column" aria-label={column.name}>
          <header className="task-column-header"><h2 title={column.name}>{column.name}</h2><b>{cards.length}</b></header>
          <ul className="task-card-list">
            {cards.map((card) => <li key={card.id}><div className="task-card" tabIndex={0} data-card-id={card.id}><span className="task-card-title">{card.title}</span></div></li>)}
          </ul>
        </section>;
      })}
    </div>}

    {dialog?.kind === "rename" && board && <NameDialog title="Rename board" eyebrow="Tasks" label="Board name" initialValue={board.name} submitLabel="Rename" hint="Up to 120 characters." validate={(value) => validateBoardName(value, board.name)} onSubmit={rename} onCancel={closeDialog} />}
    {dialog?.kind === "share" && board && <BoardSharePanel board={board} onClose={closeDialog} onChanged={() => {
      setDialog(null);
      notify("Sharing updated");
      void load();
    }} />}
  </section>;
}
