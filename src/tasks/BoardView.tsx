import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, Pencil, Plus, RotateCcw, Share2, Trash2, TriangleAlert } from "lucide-react";
import { ApiError } from "../api";
import { ConfirmDialog, ModalDialog } from "../files/Dialog";
import { NameDialog } from "../files/RenameDialog";
import { BoardColumnView } from "./BoardColumnView";
import { BoardSharePanel } from "./BoardSharePanel";
import { MoveCardSheet } from "./MoveCardSheet";
import { afterCardIdAt, applyLocalMove, applyPositions, byPosition, cardPlace, columnCards, columnIndexFromScroll, columnMoveAnchor, isNoopMove, keyboardMoveTarget, readCardDragPayload, sheetMoveAnchor, type MoveKey } from "./boardOrder";
import { isMobileViewport } from "../mobileNavigation";
import { formatRoute } from "../router";
import { tasksRoute } from "../tasksRoute";
import { columnIndexFor, createTasksHistoryState } from "../tasksNavigation";
import { cardCountLabel, validateBoardName, validateColumnName } from "./taskActions";
import {
  createCard,
  createColumn,
  deleteColumn,
  getBoard,
  moveCard,
  renameBoard,
  taskErrorCode,
  taskErrorMessage,
  updateColumn,
  type BoardDetail,
  type CardSummary
} from "./tasksApi";
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

type BoardDialog =
  | { kind: "rename" | "share" | "addColumn" }
  | { kind: "columnMenu" | "renameColumn" | "deleteColumn"; columnId: string }
  | { kind: "moveCard"; cardId: string };

export const MAX_COLUMNS = 20;

export function BoardView({ userId, boardId, focusCardId, onBack, onMissing, notify }: BoardViewProps) {
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<BoardDialog | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ columnId: string; index: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const detailRef = useRef(detail);
  detailRef.current = detail;
  // The control that opened the current dialog, so focus can return to it.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Phones show one column at a time on a scroll-snap track; the index lives in the entry's hint.
  const [activeColumn, setActiveColumn] = useState(0);
  const activeColumnRef = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const hintTimerRef = useRef<number | null>(null);

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

  // First load: show the column this entry was on (Back/Forward and reloads return to it).
  const loaded = detail !== null;
  useEffect(() => {
    if (!loaded) return;
    const current = detailRef.current!;
    const focusColumn = focusCardId ? current.cards.find((card) => card.id === focusCardId)?.column_id : undefined;
    const ordered = [...current.columns].sort(byPosition);
    const fromCard = focusColumn ? ordered.findIndex((column) => column.id === focusColumn) : -1;
    const index = fromCard >= 0 ? fromCard : columnIndexFor(window.history.state, userId, boardId, ordered.length);
    activeColumnRef.current = index;
    setActiveColumn(index);
    const track = trackRef.current;
    if (track && isMobileViewport()) track.scrollTo({ left: index * track.clientWidth, behavior: "instant" as ScrollBehavior });
    // Only once per board load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, boardId]);

  useEffect(() => () => { if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current); }, []);

  useEffect(() => {
    if (!detail || !focusCardId) return;
    window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(focusCardId)}"]`)?.focus();
    // Only once the board has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail !== null, focusCardId]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target) window.setTimeout(() => { if (target.isConnected) target.focus(); }, 0);
  }, []);
  useHistoryDialogGuard(dialog !== null, closeDialog);

  const openDialog = (next: BoardDialog, trigger?: HTMLElement | null) => {
    returnFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setDialog(next);
  };

  const board = detail?.board ?? null;
  const owner = board?.is_owner === 1;
  const columns = [...(detail?.columns ?? [])].sort(byPosition);
  const cards = detail?.cards ?? [];
  const shownColumn = Math.max(0, Math.min(activeColumn, columns.length - 1));
  const dialogColumn = dialog && "columnId" in dialog ? columns.find((column) => column.id === dialog.columnId) ?? null : null;
  const dialogCard = dialog?.kind === "moveCard" ? cards.find((card) => card.id === dialog.cardId) ?? null : null;

  const setCards = (change: (cards: CardSummary[]) => CardSummary[]) =>
    setDetail((current) => current ? { ...current, cards: change(current.cards) } : current);

  /** Keeps the column index on the current entry with replaceState: swiping never adds history entries. */
  function rememberColumn(index: number) {
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null;
      if (window.location.pathname !== formatRoute(tasksRoute(boardId))) return;
      window.history.replaceState(createTasksHistoryState(userId, { boardId, column: index }, window.history.state), "", window.location.pathname);
    }, 150);
  }

  function onTrackScroll() {
    const track = trackRef.current;
    if (!track || !isMobileViewport()) return;
    const index = columnIndexFromScroll(track.scrollLeft, track.clientWidth, columns.length);
    if (index === activeColumnRef.current) return;
    activeColumnRef.current = index;
    setActiveColumn(index);
    rememberColumn(index);
    window.document.getElementById(`task-tab-${columns[index]?.id}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function showColumn(index: number) {
    const track = trackRef.current;
    activeColumnRef.current = index;
    setActiveColumn(index);
    rememberColumn(index);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track?.scrollTo({ left: index * track.clientWidth, behavior: reduce ? "instant" as ScrollBehavior : "smooth" });
  }

  function focusCard(cardId: string) {
    window.setTimeout(() => window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`)?.focus(), 0);
  }

  /**
   * Optimistic move: the card jumps at once and the server's position replaces the local one. A
   * 409 (someone else changed the column) or any failure rolls back, says so, and reloads.
   */
  async function move(cardId: string, columnId: string, afterCardId: string | null, options: { focus?: boolean } = {}) {
    const current = detailRef.current;
    if (!current || isNoopMove(current.cards, cardId, columnId, afterCardId)) return;
    const before = current.cards;
    const place = cardPlace(applyLocalMove(before, cardId, columnId, afterCardId), current.columns, cardId);
    setCards((items) => applyLocalMove(items, cardId, columnId, afterCardId));
    if (options.focus) {
      focusCard(cardId);
      const index = [...current.columns].sort(byPosition).findIndex((column) => column.id === columnId);
      if (isMobileViewport() && index >= 0 && index !== activeColumnRef.current) showColumn(index);
    }
    try {
      const result = await moveCard(cardId, columnId, afterCardId);
      setCards((items) => {
        const moved = items.map((item) => item.id === cardId ? result.card : item);
        return result.positions ? applyPositions(moved, result.positions) : moved;
      });
      setAnnouncement(`Moved to ${place}`);
    } catch (reason) {
      setCards(() => before);
      if (taskErrorCode(reason) === "STALE_POSITION") notify("The board changed while you moved that card. Showing the latest order.");
      else notify(taskErrorMessage(reason, "Could not move the card"));
      void load();
    }
  }

  function dropAt(columnId: string, payload: string | null, index: number) {
    const cardId = readCardDragPayload(payload) ?? draggingId;
    setDraggingId(null);
    setDropTarget(null);
    const current = detailRef.current;
    // Only cards of this board; a foreign or malformed payload is ignored.
    if (!cardId || !current?.cards.some((card) => card.id === cardId)) return;
    void move(cardId, columnId, afterCardIdAt(columnCards(current.cards, columnId), index, cardId));
  }

  function keyMove(card: CardSummary, key: MoveKey) {
    const current = detailRef.current;
    if (!current) return;
    const target = keyboardMoveTarget(current.cards, current.columns, card.id, key);
    if (!target) return;
    void move(card.id, target.columnId, target.afterCardId, { focus: true });
  }

  async function addCard(columnId: string, title: string) {
    const { card } = await createCard(boardId, columnId, title);
    setDetail((current) => current ? { ...current, cards: [...current.cards, card], board: { ...current.board, card_count: current.board.card_count + 1 } } : current);
  }

  async function rename(name: string) {
    const { board: saved } = await renameBoard(boardId, name);
    setDetail((current) => current ? { ...current, board: saved } : current);
    closeDialog();
    notify(`Renamed to “${saved.name}”`);
  }

  async function addColumn(name: string) {
    const { columns: saved } = await createColumn(boardId, name);
    setDetail((current) => current ? { ...current, columns: saved } : current);
    closeDialog();
    notify(`Added column ${name}`);
  }

  async function renameColumn(columnId: string, name: string) {
    const { columns: saved } = await updateColumn(columnId, { name });
    setDetail((current) => current ? { ...current, columns: saved } : current);
    closeDialog();
  }

  async function moveColumn(columnId: string, direction: -1 | 1) {
    const anchor = columnMoveAnchor(columns, columnId, direction);
    if (anchor === undefined) return;
    try {
      const { columns: saved } = await updateColumn(columnId, { afterColumnId: anchor });
      setDetail((current) => current ? { ...current, columns: saved } : current);
      const moved = saved.find((column) => column.id === columnId);
      setAnnouncement(`${moved?.name ?? "Column"} moved ${direction < 0 ? "left" : "right"}`);
    } catch (reason) {
      notify(taskErrorMessage(reason, "Could not move the column"));
      void load();
    }
  }

  async function removeColumn(columnId: string) {
    setDeleting(true);
    try {
      const { columns: saved } = await deleteColumn(columnId);
      setDetail((current) => current ? { ...current, columns: saved } : current);
      setDialog(null);
      returnFocusRef.current = null;
      notify("Column deleted");
    } catch (reason) {
      closeDialog();
      const code = taskErrorCode(reason);
      notify(code === "COLUMN_NOT_EMPTY" ? "Move or delete the cards in this column first" : code === "LAST_COLUMN" ? "A board needs at least one column" : taskErrorMessage(reason, "Could not delete the column"));
      void load();
    } finally {
      setDeleting(false);
    }
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
        <button className="icon-button" onClick={(event) => openDialog({ kind: "rename" }, event.currentTarget)} aria-haspopup="dialog" aria-label="Rename board" title="Rename board"><Pencil /></button>
        <button className="icon-button" onClick={(event) => openDialog({ kind: "share" }, event.currentTarget)} aria-haspopup="dialog" aria-label="Share board" title="Share board"><Share2 /></button>
      </span>}
    </header>
    <p id="task-card-keys" className="sr-only">Press Alt with an arrow key to move a card up, down, or to the next column.</p>
    <p className="sr-only" aria-live="polite">{announcement}</p>

    {loadError && <div className="bin-state bin-error task-board-state" role="alert">
      <span className="bin-state-icon"><TriangleAlert /></span>
      <h2>Could not load this board</h2>
      <p>{loadError}</p>
      <button className="primary-button" onClick={() => { void load(); }}><RotateCcw />Try again</button>
    </div>}
    {!loadError && !detail && <p className="bin-loading task-board-state" role="status">Loading the board…</p>}
    {detail && <nav className="task-column-tabs" aria-label="Columns">
      {columns.map((column, index) => <button key={column.id} id={`task-tab-${column.id}`} className={index === shownColumn ? "active" : ""} aria-current={index === shownColumn ? "true" : undefined} onClick={() => showColumn(index)}>
        <span>{column.name}</span><b>{columnCards(cards, column.id).length}</b>
      </button>)}
      {owner && columns.length < MAX_COLUMNS && <button className="task-tab-add" onClick={(event) => openDialog({ kind: "addColumn" }, event.currentTarget)} aria-haspopup="dialog" aria-label="Add column"><Plus /></button>}
    </nav>}
    {detail && <div className="task-columns" ref={trackRef} onScroll={onTrackScroll}>
      {columns.map((column, index) => <BoardColumnView
        key={column.id}
        column={column}
        cards={columnCards(cards, column.id)}
        owner={owner}
        isFirst={index === 0}
        isLast={index === columns.length - 1}
        draggingId={draggingId}
        dropIndex={dropTarget?.columnId === column.id ? dropTarget.index : null}
        onDragStart={(card) => setDraggingId(card.id)}
        onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
        onDragOverIndex={(slot) => setDropTarget((current) => slot === null
          ? current?.columnId === column.id ? null : current
          : current?.columnId === column.id && current.index === slot ? current : { columnId: column.id, index: slot })}
        onDropAt={(payload, slot) => dropAt(column.id, payload, slot)}
        onKeyMove={keyMove}
        onCardMenu={(card, trigger) => openDialog({ kind: "moveCard", cardId: card.id }, trigger)}
        onColumnMenu={(trigger) => openDialog({ kind: "columnMenu", columnId: column.id }, trigger)}
        onMoveColumn={(direction) => { void moveColumn(column.id, direction); }}
        onAddCard={(title) => addCard(column.id, title)}
      />)}
      {owner && columns.length < MAX_COLUMNS && <button className="task-add-column" onClick={(event) => openDialog({ kind: "addColumn" }, event.currentTarget)} aria-haspopup="dialog"><Plus />Add column</button>}
    </div>}

    {dialog?.kind === "rename" && board && <NameDialog title="Rename board" eyebrow="Tasks" label="Board name" initialValue={board.name} submitLabel="Rename" hint="Up to 120 characters." validate={(value) => validateBoardName(value, board.name)} onSubmit={rename} onCancel={closeDialog} />}
    {dialog?.kind === "share" && board && <BoardSharePanel board={board} onClose={closeDialog} onChanged={() => {
      closeDialog();
      notify("Sharing updated");
      void load();
    }} />}
    {dialog?.kind === "addColumn" && <NameDialog title="Add column" eyebrow={board?.name ?? "Board"} label="Column name" initialValue="" submitLabel="Add column" hint="Up to 60 characters. It is added at the end." validate={(value) => validateColumnName(value)} onSubmit={addColumn} onCancel={closeDialog} />}
    {dialog?.kind === "columnMenu" && dialogColumn && <ModalDialog title={dialogColumn.name} eyebrow="Column" onClose={closeDialog}>
      <div className="move-list task-menu">
        <button className="move-option" autoFocus onClick={() => setDialog({ kind: "renameColumn", columnId: dialogColumn.id })}><Pencil aria-hidden="true" /><span>Rename</span></button>
        <button className="move-option" disabled={columns[0]?.id === dialogColumn.id} onClick={() => { closeDialog(); void moveColumn(dialogColumn.id, -1); }}><ArrowLeft aria-hidden="true" /><span>Move left</span></button>
        <button className="move-option" disabled={columns[columns.length - 1]?.id === dialogColumn.id} onClick={() => { closeDialog(); void moveColumn(dialogColumn.id, 1); }}><ArrowRight aria-hidden="true" /><span>Move right</span></button>
        <button className="move-option danger" disabled={columns.length <= 1} onClick={() => setDialog({ kind: "deleteColumn", columnId: dialogColumn.id })}><Trash2 aria-hidden="true" /><span>Delete column{columns.length <= 1 && <small>A board needs at least one column</small>}</span></button>
      </div>
    </ModalDialog>}
    {dialog?.kind === "renameColumn" && dialogColumn && <NameDialog title="Rename column" eyebrow="Column" label="Column name" initialValue={dialogColumn.name} submitLabel="Rename" hint="Up to 60 characters." validate={(value) => validateColumnName(value, dialogColumn.name)} onSubmit={(name) => renameColumn(dialogColumn.id, name)} onCancel={closeDialog} />}
    {dialog?.kind === "deleteColumn" && dialogColumn && <ConfirmDialog
      title="Delete this column?"
      message={columnCards(cards, dialogColumn.id).length
        ? `“${dialogColumn.name}” still has cards. Move them to another column first.`
        : `Delete “${dialogColumn.name}”? This cannot be undone.`}
      confirmLabel="Delete column"
      danger
      busy={deleting}
      onConfirm={() => { void removeColumn(dialogColumn.id); }}
      onCancel={closeDialog}
    />}
    {dialog?.kind === "moveCard" && dialogCard && <MoveCardSheet card={dialogCard} columns={columns} onCancel={closeDialog} onMove={async (columnId, place) => {
      const current = detailRef.current;
      setDialog(null);
      returnFocusRef.current = null;
      if (current) await move(dialogCard.id, columnId, sheetMoveAnchor(current.cards, dialogCard.id, columnId, place), { focus: true });
    }} />}
  </section>;
}
