import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { DocumentSummary } from "../types";
import { ModalDialog } from "./Dialog";
import { baseNameRange, validateRename } from "./fileActions";

type NameCheck = { ok: true; name: string; changed: boolean } | { ok: false; error: string };

type NameDialogProps = {
  title: string;
  eyebrow: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  /** Characters selected when the dialog opens. */
  selection?: [number, number];
  validate: (value: string) => NameCheck;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
};

export function NameDialog({ title, eyebrow, label, initialValue, submitLabel, selection, validate, onSubmit, onCancel }: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const [start, end] = selection ?? [0, initialValue.length];
    input.setSelectionRange(start, end);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = validate(value);
  const shown = error ?? (touched && !check.ok ? check.error : null);
  const willStore = check.ok && check.name !== value.trim() ? check.name : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!check.ok) return;
    if (!check.changed) {
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(check.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the name");
      setBusy(false);
    }
  }

  return <ModalDialog title={title} eyebrow={eyebrow} onClose={onCancel} busy={busy}>
    <form className="file-dialog-form" onSubmit={submit} noValidate>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        ref={inputRef}
        value={value}
        onChange={(event) => { setValue(event.target.value); setTouched(true); setError(null); }}
        onKeyDown={(event) => {
          // Submit explicitly so Enter works the same with every input method.
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        aria-invalid={shown ? true : undefined}
        aria-describedby={hintId}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      <p id={hintId} className={shown ? "file-dialog-error" : "file-dialog-hint"} role={shown ? "alert" : undefined}>
        {shown ?? (willStore ? `Will be saved as “${willStore}”.` : "Slashes, backslashes, and colons become dashes.")}
      </p>
      <footer className="file-dialog-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy || (touched && !check.ok)}>{busy ? "Saving…" : submitLabel}</button>
      </footer>
    </form>
  </ModalDialog>;
}

export function RenameDialog({ document, onSubmit, onCancel }: { document: DocumentSummary; onSubmit: (name: string) => Promise<void> | void; onCancel: () => void }) {
  return <NameDialog
    title="Rename file"
    eyebrow="File"
    label="Name"
    initialValue={document.name}
    submitLabel="Rename"
    selection={baseNameRange(document.name)}
    validate={(value) => validateRename(value, document.name)}
    onSubmit={onSubmit}
    onCancel={onCancel}
  />;
}
