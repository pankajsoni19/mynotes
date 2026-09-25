import { useEffect, useId, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { ModalDialog } from "../files/Dialog";
import { createCollection, errorMessage, listTemplates, type CollectionDetail, type Template } from "./collectionsApi";
import { CollectionIcon } from "./icons";
import { validateCollectionName } from "./values";

type NewCollectionDialogProps = {
  onCreated: (collection: CollectionDetail) => void;
  onCancel: () => void;
  /** Opens the CSV import once the collection exists (stage D). */
  onImport?: (collection: CollectionDetail) => void;
};

const BLANK = "blank";

// New collection: a name and a starting point (blank, or one of the built-in templates, which are
// copied into the new schema). A sheet on phones. Pushes no history entry (D69).
export function NewCollectionDialog({ onCreated, onCancel, onImport }: NewCollectionDialogProps) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [choice, setChoice] = useState(BLANK);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();

  useEffect(() => {
    let active = true;
    listTemplates().then((result) => { if (active) setTemplates(result.templates); }).catch(() => { if (active) setTemplates([]); });
    return () => { active = false; };
  }, []);

  const template = templates?.find((item) => item.id === choice) ?? null;
  const effectiveName = name.trim() || template?.name || "";
  const check = validateCollectionName(effectiveName);

  async function submit(event: FormEvent, importAfter = false) {
    event.preventDefault();
    setTouched(true);
    if (!check.ok) return;
    setBusy(true);
    setError(null);
    try {
      const { collection } = await createCollection({ name: check.name, ...(template ? { templateId: template.id } : {}) });
      if (importAfter && onImport) onImport(collection);
      else onCreated(collection);
    } catch (reason) {
      setError(errorMessage(reason, "Could not create the collection"));
      setBusy(false);
    }
  }

  const option = (id: string, label: string, description: string, icon: string, fields?: string) =>
    <button key={id} type="button" role="radio" aria-checked={choice === id} className={`move-option collection-template${choice === id ? " active" : ""}`} onClick={() => setChoice(id)} disabled={busy}>
      <CollectionIcon name={icon} />
      <span>{label}<small>{description}</small>{fields && <small className="collection-template-fields">{fields}</small>}</span>
      {choice === id ? <Check aria-hidden="true" /> : <span aria-hidden="true" />}
    </button>;

  return <ModalDialog title="New collection" eyebrow="Collections" onClose={onCancel} variant="sheet" busy={busy}>
    <form className="collection-new" onSubmit={(event) => { void submit(event); }} noValidate>
      <div className="file-dialog-form">
        <label htmlFor={nameId}>Name</label>
        <input id={nameId} value={name} placeholder={template?.name ?? "My collection"} onChange={(event) => { setName(event.target.value); setTouched(true); setError(null); }} autoComplete="off" autoFocus disabled={busy} aria-invalid={touched && !check.ok ? true : undefined} />
        {touched && !check.ok && <p className="file-dialog-error" role="alert">{check.error}</p>}
      </div>
      <p className="collection-new-label" id={`${nameId}-start`}>Start from</p>
      <div className="move-list collection-template-list" role="radiogroup" aria-labelledby={`${nameId}-start`}>
        {option(BLANK, "Blank", "A Name and a Notes field; add your own", "table")}
        {templates === null && <p className="bin-loading" role="status">Loading templates…</p>}
        {templates?.map((item) => option(item.id, item.name, item.description, item.icon, item.fields.map((field) => field.name).join(" · ")))}
      </div>
      {error && <p className="file-dialog-error collection-new-error" role="alert">{error}</p>}
      <footer className="file-dialog-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
        {onImport && <button type="button" className="secondary-button" onClick={(event) => { void submit(event, true); }} disabled={busy}>Create and import CSV</button>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
      </footer>
    </form>
  </ModalDialog>;
}
