import { useId, useState, type FormEvent } from "react";
import { ModalDialog } from "../files/Dialog";
import { validateWipLimit, WIP_LIMIT_MAX } from "./taskActions";

type WipLimitDialogProps = {
  columnName: string;
  limit: number | null;
  count: number;
  onSubmit: (limit: number | null) => Promise<void>;
  onCancel: () => void;
};

/**
 * "Set WIP limit…" from the owner's column menu (D108): a whole number of cards from 1 to 1000, or
 * empty for no limit. A limit below the current count is allowed; it only stops cards coming in.
 */
export function WipLimitDialog({ columnName, limit, count, onSubmit, onCancel }: WipLimitDialogProps) {
  const [value, setValue] = useState(limit === null ? "" : String(limit));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const check = validateWipLimit(value);
  const shown = error ?? (touched && !check.ok ? check.error : null);
  const below = check.ok && check.value !== null && check.value < count;

  async function save(next: number | null) {
    if (next === limit) {
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the limit");
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (check.ok) void save(check.value);
  }

  return <ModalDialog title="WIP limit" eyebrow={columnName} onClose={onCancel} busy={busy}>
    <form className="file-dialog-form" onSubmit={submit} noValidate>
      <label htmlFor={inputId}>Most cards in this column</label>
      <input
        id={inputId}
        autoFocus
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        placeholder="No limit"
        onChange={(event) => { setValue(event.target.value); setTouched(true); setError(null); }}
        aria-invalid={shown ? true : undefined}
        aria-describedby={hintId}
        autoComplete="off"
        disabled={busy}
      />
      <p id={hintId} className={shown ? "file-dialog-error" : "file-dialog-hint"} role={shown ? "alert" : undefined}>
        {shown ?? (below
          ? `It holds ${count} now. The cards stay, but no more can come in until it is under the limit.`
          : `1 to ${WIP_LIMIT_MAX} cards. Leave it empty for no limit. Cards cannot be added or moved in once it is full.`)}
      </p>
      <footer className="file-dialog-actions">
        {limit !== null && <button type="button" className="secondary-button" onClick={() => { void save(null); }} disabled={busy}>Remove limit</button>}
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy || (touched && !check.ok)}>{busy ? "Saving…" : "Save"}</button>
      </footer>
    </form>
  </ModalDialog>;
}
