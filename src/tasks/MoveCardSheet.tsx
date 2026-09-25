import { useState } from "react";
import { Check, Columns3 } from "lucide-react";
import { ModalDialog } from "../files/Dialog";
import type { BoardColumn, CardSummary } from "./tasksApi";

type MoveCardSheetProps = {
  card: CardSummary;
  columns: BoardColumn[];
  onMove: (columnId: string) => Promise<void>;
  onCancel: () => void;
};

// "Move to…": a dialog on desktop, a full-screen sheet on phones. Lists the board's columns; the
// card goes to the bottom of the chosen one.
export function MoveCardSheet({ card, columns, onMove, onCancel }: MoveCardSheetProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = columns.find((column) => column.id === chosen) ?? null;

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(target.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not move the card");
      setBusy(false);
    }
  }

  return <ModalDialog title={`Move “${card.title}”`} eyebrow="Move to" onClose={onCancel} variant="sheet" busy={busy}>
    <div className="move-list" role="radiogroup" aria-label="Columns">
      {columns.map((column, index) => {
        const current = column.id === card.column_id;
        return <button key={column.id} role="radio" aria-checked={chosen === column.id} className={`move-option${chosen === column.id ? " active" : ""}`} disabled={current || busy} autoFocus={index === columns.findIndex((item) => item.id !== card.column_id)} onClick={() => setChosen(column.id)}>
          <Columns3 aria-hidden="true" />
          <span>{column.name}{current && <small>Current column</small>}</span>
          {chosen === column.id && <Check aria-hidden="true" />}
        </button>;
      })}
    </div>
    {error && <p className="file-dialog-error" role="alert">{error}</p>}
    <footer className="file-dialog-actions">
      <button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className="primary-button" onClick={() => { void confirm(); }} disabled={!target || busy}>{busy ? "Moving…" : target ? `Move to ${target.name}` : "Move"}</button>
    </footer>
  </ModalDialog>;
}
