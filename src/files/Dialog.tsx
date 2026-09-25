import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalDialogProps = {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  /** "sheet" becomes a full-screen panel on phones (the Move sheet). */
  variant?: "dialog" | "sheet";
  busy?: boolean;
  /** Id of the element that explains the dialog (the confirm message). */
  describedBy?: string;
};

// In-app modal used by every Files dialog. Escape closes it; it adds no history entry, so browser
// Back is handled by FilesApp (it closes the dialog and keeps the panel, D18).
export function ModalDialog({ title, eyebrow, onClose, children, variant = "dialog", busy = false, describedBy }: ModalDialogProps) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return <>
    <button className="panel-scrim file-dialog-scrim" onClick={() => { if (!busy) onClose(); }} aria-label="Close dialog" tabIndex={-1} />
    <section className={`file-dialog${variant === "sheet" ? " file-dialog-sheet" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} aria-busy={busy || undefined}>
      <header className="file-dialog-header">
        <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId} title={title}>{title}</h2></div>
        <button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      </header>
      {children}
    </section>
  </>;
}

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ title, message, confirmLabel, danger = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const messageId = useId();
  return <ModalDialog title={title} onClose={onCancel} busy={busy} describedBy={messageId}>
    <p id={messageId} className="file-dialog-copy">{message}</p>
    <footer className="file-dialog-actions">
      <button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className={danger ? "danger-button" : "primary-button"} onClick={onConfirm} disabled={busy} autoFocus>{busy ? "Working…" : confirmLabel}</button>
    </footer>
  </ModalDialog>;
}
