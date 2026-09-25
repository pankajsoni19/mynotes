import { useState } from "react";
import { FileUp } from "lucide-react";
import { ModalDialog } from "../files/Dialog";
import { errorCode, errorMessage, errorPayload, importCsv, type CollectionDetail, type ImportError, type ImportPreview } from "./collectionsApi";
import { displayValue } from "./values";

type ImportDialogProps = {
  collection: CollectionDetail;
  onImported: (count: number) => void;
  onClose: () => void;
};

const MAX_BYTES = 2_000_000;

/** The import button: what it will do, or, while the check found problems, what stands in the way. */
export function importButtonLabel(preview: Pick<ImportPreview, "valid" | "errorCount"> | null, busy: boolean) {
  if (busy) return "Working…";
  if (!preview) return "Import";
  if (preview.errorCount > 0) return preview.errorCount === 1 ? "Fix 1 problem to import" : `Fix ${preview.errorCount} problems to import`;
  return `Import ${preview.valid} ${preview.valid === 1 ? "row" : "rows"}`;
}

// CSV import wizard: choose a file (≤ 2 MB, header row plus ≤ 5000 rows), check it (a dry run maps
// columns to fields by name and lists problems), adjust the mapping, then import all rows or none.
// A full-screen sheet on phones; pushes no history entry (dialogLayers).
export function ImportDialog({ collection, onImported, onClose }: ImportDialogProps) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Array<string | null> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<ImportError[]>([]);
  const importable = collection.fields.filter((field) => field.type !== "file");
  const fieldName = (id: string | null) => collection.fields.find((field) => field.id === id)?.name ?? "the row";

  async function check(text: string, nextMapping: Array<string | null> | undefined) {
    setBusy(true);
    setError(null);
    setFailures([]);
    try {
      const result = await importCsv(collection.id, text, nextMapping, true) as ImportPreview;
      setPreview(result);
      setMapping(result.mapping);
    } catch (reason) {
      setPreview(null);
      setError(errorMessage(reason, "Could not read the CSV"));
    } finally {
      setBusy(false);
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("CSV imports can be at most 2 MB");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setMapping(undefined);
    await check(text, undefined);
  }

  async function run() {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importCsv(collection.id, csv, mapping, false) as { inserted: number };
      onImported(result.inserted);
    } catch (reason) {
      setError(errorMessage(reason, "Could not import"));
      if (errorCode(reason) === "IMPORT_INVALID") setFailures(errorPayload<{ errors?: ImportError[] }>(reason)?.errors ?? []);
      setBusy(false);
    }
  }

  const ready = preview && preview.errorCount === 0 && preview.total > 0 && !preview.wouldExceedLimit;
  const shownErrors = failures.length ? failures : preview?.errors ?? [];
  const previewFields = collection.fields.filter((field) => mapping?.includes(field.id));

  return <ModalDialog title="Import CSV" eyebrow={collection.name} onClose={onClose} variant="sheet" busy={busy}>
    <div className="import-dialog">
      <label className="secondary-button import-choose">
        <FileUp aria-hidden="true" />{fileName ? `Chosen: ${fileName}` : "Choose a CSV file"}
        <input type="file" accept=".csv,text/csv" hidden onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} disabled={busy} />
      </label>
      <p className="file-dialog-hint">The first row names the columns. Up to 5000 rows and 50 columns; nothing is imported unless every row is valid. Options match by label; separate several with “;”.</p>

      {preview && <>
        <h3>Columns</h3>
        <div className="import-mapping">
          {preview.header.map((name, index) => <label key={index}>
            <span title={name}>{name || `Column ${index + 1}`}</span>
            <select value={mapping?.[index] ?? ""} disabled={busy} onChange={(event) => {
              const next = [...(mapping ?? preview.header.map(() => null))];
              next[index] = event.target.value || null;
              setMapping(next);
            }}>
              <option value="">Skip</option>
              {importable.map((field) => <option key={field.id} value={field.id} disabled={field.id !== mapping?.[index] && mapping?.includes(field.id)}>{field.name}</option>)}
            </select>
          </label>)}
        </div>
        <button className="secondary-button import-recheck" onClick={() => { if (csv) void check(csv, mapping); }} disabled={busy || !csv}>Check again</button>
        <p className="import-summary" role="status">
          {preview.total} {preview.total === 1 ? "row" : "rows"}, {preview.valid} ready{preview.errorCount ? `, ${preview.errorCount} ${preview.errorCount === 1 ? "problem" : "problems"}` : ""}.
          {preview.wouldExceedLimit && " This would pass the 10,000-row limit."}
        </p>
        {preview.preview.length > 0 && previewFields.length > 0 && <div className="import-preview"><table>
          <thead><tr>{previewFields.map((field) => <th key={field.id}>{field.name}</th>)}</tr></thead>
          <tbody>{preview.preview.slice(0, 5).map((values, index) => <tr key={index}>
            {previewFields.map((field) => <td key={field.id}>{displayValue(field, { values, links: {}, files: {} })}</td>)}
          </tr>)}</tbody>
        </table></div>}
      </>}
      {shownErrors.length > 0 && <ul className="import-errors" aria-label="Problems">
        {shownErrors.map((item, index) => <li key={index}>Row {item.row}{item.column ? `, column ${item.column}` : ""} ({fieldName(item.fieldId)}): {item.message}</li>)}
      </ul>}
    </div>
    {error && <p className="file-dialog-error import-error" role="alert">{error}</p>}
    <footer className="file-dialog-actions">
      <button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="primary-button" onClick={() => { void run(); }} disabled={busy || !ready}>{importButtonLabel(preview, busy)}</button>
    </footer>
  </ModalDialog>;
}
