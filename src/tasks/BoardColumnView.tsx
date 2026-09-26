import { useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Ellipsis, MessageSquare, Paperclip, Plus, AlignLeft, UserRound } from "lucide-react";
import { CARD_DRAG_TYPE, isCardDrag, isMoveKey, type MoveKey } from "./boardOrder";
import { assigneeSentence, attachmentCountLabel, cardAssignees, commentCountLabel, dueStatus, localDateString, validateCardTitle, wipCountLabel, wipState } from "./taskActions";
import type { BoardColumn, CardSummary } from "./tasksApi";

type BoardColumnViewProps = {
  column: BoardColumn;
  cards: CardSummary[];
  owner: boolean;
  isFirst: boolean;
  isLast: boolean;
  draggingId: string | null;
  /** Insertion index shown while a card is dragged over this column (cards without the dragged one). */
  dropIndex: number | null;
  /** A card from another column is being dragged and this column is full: the drop is refused (D108). */
  refuseDrop?: boolean;
  onDragStart: (card: CardSummary) => void;
  onDragEnd: () => void;
  onDragOverIndex: (index: number | null) => void;
  onDropAt: (cardId: string | null, index: number) => void;
  onKeyMove: (card: CardSummary, key: MoveKey) => void;
  onCardMenu: (card: CardSummary, trigger: HTMLElement) => void;
  onOpenCard: (card: CardSummary) => void;
  onColumnMenu: (trigger: HTMLElement) => void;
  onMoveColumn: (direction: -1 | 1) => void;
  onAddCard: (title: string) => Promise<void>;
  /** With filters on (13E), `cards` are the matching ones and this is the column's real count (for WIP). */
  totalCount?: number;
};

/** Which slot a pointer at `clientY` points to among the column's card elements (the dragged one excluded). */
function dropIndexFor(list: HTMLElement, clientY: number, draggingId: string | null) {
  const items = Array.from(list.querySelectorAll<HTMLElement>("[data-card-id]")).filter((element) => element.dataset.cardId !== draggingId);
  const index = items.findIndex((element) => {
    const box = element.getBoundingClientRect();
    return clientY < box.top + box.height / 2;
  });
  return index < 0 ? items.length : index;
}

export function BoardColumnView(props: BoardColumnViewProps) {
  const { column, cards, owner, isFirst, isLast, draggingId, dropIndex } = props;
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const others = cards.filter((card) => card.id !== draggingId);
  const today = localDateString();

  function dragOver(event: ReactDragEvent<HTMLElement>) {
    if (!isCardDrag(event.dataTransfer.types) || !listRef.current) return;
    if (props.refuseDrop) {
      // Not calling preventDefault leaves the drop disallowed; the hint says why.
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    props.onDragOverIndex(dropIndexFor(listRef.current, event.clientY, draggingId));
  }

  function drop(event: ReactDragEvent<HTMLElement>) {
    if (!isCardDrag(event.dataTransfer.types) || !listRef.current || props.refuseDrop) return;
    event.preventDefault();
    const index = dropIndexFor(listRef.current, event.clientY, draggingId);
    props.onDropAt(event.dataTransfer.getData(CARD_DRAG_TYPE), index);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const check = validateCardTitle(title);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onAddCard(check.name);
      setTitle("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the card");
    } finally {
      setBusy(false);
      // Stay in the field so several cards can be added in a row.
      inputRef.current?.focus();
    }
  }

  function cardKeyDown(event: ReactKeyboardEvent<HTMLElement>, card: CardSummary) {
    if (!event.altKey || event.ctrlKey || event.metaKey || !isMoveKey(event.key)) return;
    event.preventDefault();
    props.onKeyMove(card, event.key);
  }

  const indicator = (index: number) => dropIndex === index ? <li className="task-drop-indicator" aria-hidden="true" /> : null;

  const count = props.totalCount ?? cards.length;
  const wip = wipState(count, column.wip_limit);

  return <section className={`task-column${dropIndex !== null ? " drop-active" : ""}${props.refuseDrop ? " drop-refused" : ""}`} aria-labelledby={`column-${column.id}`} data-column-id={column.id}
    onDragOver={dragOver} onDragEnter={dragOver} onDrop={drop}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onDragOverIndex(null); }}>
    <header className="task-column-header">
      <h2 id={`column-${column.id}`} title={column.name}>{column.name}</h2>
      <b className={wip ? `task-wip ${wip}` : undefined} aria-label={wipCountLabel(count, column.wip_limit)} title={wip ? `WIP limit ${column.wip_limit}` : undefined}>
        {wip ? `${count} / ${column.wip_limit}` : count}
      </b>
      {owner && <span className="task-column-controls">
        <button className="icon-button desktop-only" onClick={() => props.onMoveColumn(-1)} disabled={isFirst} aria-label={`Move ${column.name} left`} title="Move column left"><ChevronLeft /></button>
        <button className="icon-button desktop-only" onClick={() => props.onMoveColumn(1)} disabled={isLast} aria-label={`Move ${column.name} right`} title="Move column right"><ChevronRight /></button>
        <button className="icon-button" onClick={(event) => props.onColumnMenu(event.currentTarget)} aria-haspopup="dialog" aria-label={`Column actions for ${column.name}`} title="Column actions"><Ellipsis /></button>
      </span>}
    </header>
    {props.refuseDrop && <p className="task-column-full-hint" role="status">Full: it takes at most {column.wip_limit} {column.wip_limit === 1 ? "card" : "cards"}.</p>}
    <ul ref={listRef} className="task-card-list" aria-label={`${column.name} cards`}>
      {cards.map((card) => {
        // The dragged card stays rendered (removing it would cancel the drag); slots count the others.
        const slot = others.indexOf(card);
        return <li key={card.id} className="task-card-item">
        {slot >= 0 && indicator(slot)}
        <div
          className={`task-card${draggingId === card.id ? " dragging" : ""}`}
          tabIndex={0}
          data-card-id={card.id}
          draggable
          aria-roledescription="Draggable card"
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
          aria-describedby="task-card-keys"
          onDragStart={(event) => {
            event.dataTransfer.setData(CARD_DRAG_TYPE, card.id);
            event.dataTransfer.effectAllowed = "move";
            props.onDragStart(card);
          }}
          onDragEnd={props.onDragEnd}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              event.preventDefault();
              props.onOpenCard(card);
              return;
            }
            cardKeyDown(event, card);
          }}
          onClick={(event) => { if (!(event.target as Element).closest("button")) props.onOpenCard(card); }}
        >
          <span className="task-card-title">{card.title}</span>
          {(() => {
            const due = dueStatus(card.due_on, today, column.is_done === 1, { dueAt: card.due_at });
            return due && <span className={`task-due-chip ${due.tone}`} title={due.description}><CalendarDays aria-hidden="true" /><span aria-hidden="true">{due.label}</span><span className="sr-only">{due.description}</span></span>;
          })()}
          {(() => {
            const people = cardAssignees(card);
            const names = people.map((person) => person.display_name);
            const assigned = names.length ? `Assigned to ${assigneeSentence(names)}` : "";
            return (card.has_description === 1 || card.comment_count > 0 || card.attachment_count > 0 || names.length > 0) && <span className="task-card-meta">
            {names.length > 0 && <span title={assigned}><UserRound aria-hidden="true" /><span className="task-card-assignee" aria-hidden="true">{names[0]}</span>{names.length > 1 && <span className="task-card-more-people" aria-hidden="true">+{names.length - 1}</span>}<span className="sr-only">{assigned}</span></span>}
            {card.has_description === 1 && <span title="Has a description"><AlignLeft aria-label="Has a description" /></span>}
            {card.comment_count > 0 && <span title="Comments"><MessageSquare aria-hidden="true" /><span aria-hidden="true">{card.comment_count}</span><span className="sr-only">{commentCountLabel(card.comment_count)}</span></span>}
            {card.attachment_count > 0 && <span title="Attachments"><Paperclip aria-hidden="true" /><span aria-hidden="true">{card.attachment_count}</span><span className="sr-only">{attachmentCountLabel(card.attachment_count)}</span></span>}
          </span>;
          })()}
          <button className="icon-button task-card-more" onClick={(event) => props.onCardMenu(card, event.currentTarget)} aria-haspopup="dialog" aria-label={`Move “${card.title}”`} title="Move to…" draggable={false}><Ellipsis /></button>
        </div>
      </li>;
      })}
      {dropIndex !== null && dropIndex >= others.length && <li className="task-drop-indicator" aria-hidden="true" />}
      {!cards.length && dropIndex === null && <li className="task-column-empty">{count > 0 ? "No matching cards" : "No cards yet"}</li>}
    </ul>
    <footer className="task-column-footer">
      {adding
        ? <form className="task-quick-add" onSubmit={submit}>
          <input
            ref={inputRef}
            autoFocus
            value={title}
            onChange={(event) => { setTitle(event.target.value); setError(null); }}
            onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setAdding(false); setTitle(""); setError(null); } }}
            placeholder="Card title"
            aria-label={`New card title in ${column.name}`}
            aria-invalid={error ? true : undefined}
            maxLength={200}
          />
          {error && <p className="file-dialog-error" role="alert">{error}</p>}
          <span className="task-quick-add-actions">
            <button type="submit" className="primary-button" aria-busy={busy || undefined} disabled={!title.trim()}>{busy ? "Adding…" : "Add card"}</button>
            <button type="button" className="secondary-button" onClick={() => { setAdding(false); setTitle(""); setError(null); }}>Done</button>
          </span>
        </form>
        : <button className="task-add-card" onClick={() => setAdding(true)}><Plus />Add a card</button>}
    </footer>
  </section>;
}
