import { useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Check, Columns3 } from "lucide-react";
import { ModalDialog } from "../files/Dialog";
import { canEnterColumn } from "./taskActions";
import type { BoardColumn, CardSummary } from "./tasksApi";

export type MovePlace = "top" | "bottom";

type MoveCardSheetProps = {
  card: CardSummary;
  columns: BoardColumn[];
  /** The board's cards, to tell which columns are full (D108). */
  cards?: readonly CardSummary[];
  onMove: (columnId: string, place: MovePlace) => Promise<void>;
  onCancel: () => void;
};

// "Move to…": a dialog on desktop, a full-screen sheet on phones. Lists the board's columns and
// Top or Bottom; the current column is allowed, so a card can jump to the top or bottom of its own.
// A column at its WIP limit is listed but disabled.
export function MoveCardSheet({ card, columns, cards = [], onMove, onCancel }: MoveCardSheetProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [place, setPlace] = useState<MovePlace>("bottom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = columns.find((column) => column.id === chosen) ?? null;
  const full = (column: BoardColumn) => !canEnterColumn(cards, column, card.id);
  const firstOpen = columns.findIndex((column) => !full(column));

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(target.id, place);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not move the card");
      setBusy(false);
    }
  }

  return <ModalDialog title={`Move “${card.title}”`} eyebrow="Move to" onClose={onCancel} variant="sheet" busy={busy}>
    <div className="move-list" role="radiogroup" aria-label="Column">
      {columns.map((column, index) => {
        const current = column.id === card.column_id;
        const refused = full(column);
        return <button key={column.id} role="radio" aria-checked={chosen === column.id} className={`move-option${chosen === column.id ? " active" : ""}`} disabled={busy || refused} autoFocus={index === firstOpen} onClick={() => setChosen(column.id)}>
          <Columns3 aria-hidden="true" />
          <span>{column.name}{current ? <small>Current column</small> : refused && <small>Full (limit {column.wip_limit})</small>}</span>
          {chosen === column.id && <Check aria-hidden="true" />}
        </button>;
      })}
    </div>
    <div className="task-move-place" role="radiogroup" aria-label="Position">
      <button role="radio" aria-checked={place === "top"} className={place === "top" ? "active" : ""} onClick={() => setPlace("top")} disabled={busy}><ArrowUpToLine aria-hidden="true" />Top</button>
      <button role="radio" aria-checked={place === "bottom"} className={place === "bottom" ? "active" : ""} onClick={() => setPlace("bottom")} disabled={busy}><ArrowDownToLine aria-hidden="true" />Bottom</button>
    </div>
    {error && <p className="file-dialog-error" role="alert">{error}</p>}
    <footer className="file-dialog-actions">
      <button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className="primary-button" onClick={() => { void confirm(); }} disabled={!target || busy}>{busy ? "Moving…" : target ? `Move to ${place === "top" ? "top" : "bottom"} of ${target.name}` : "Move"}</button>
    </footer>
  </ModalDialog>;
}
