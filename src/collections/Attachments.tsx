import { useRef, useState } from "react";
import { Download, ExternalLink, Paperclip, X } from "lucide-react";
import { contentUrl, formatBytes } from "../files/filesApi";
import { attachDocument, detachDocument, errorMessage, uploadAttachment, type CollectionRow, type FieldDefinition } from "./collectionsApi";

type AttachmentsProps = {
  row: CollectionRow;
  field: FieldDefinition;
  editable: boolean;
  onChanged: (row: CollectionRow) => void;
  notify: (message: string) => void;
};

// A file field in the row panel: the row's linked documents, each opened through the content route
// (readable while the row and collection are). Editors attach uploads (up to 20 per row) and remove
// links; removing the last link to an upload moves it to the uploader's Bin.
export function Attachments({ row, field, editable, onChanged, notify }: AttachmentsProps) {
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const files = row.files?.[field.id] ?? [];

  async function attach(list: FileList | null) {
    const chosen = list ? [...list] : [];
    if (inputRef.current) inputRef.current.value = "";
    for (const file of chosen) {
      try {
        setProgress(0);
        const document = await uploadAttachment(file, setProgress);
        const { row: saved } = await attachDocument(row.id, document.id, field.id);
        onChanged(saved);
      } catch (reason) {
        notify(errorMessage(reason, `Could not attach ${file.name}`));
        break;
      } finally {
        setProgress(null);
      }
    }
  }

  async function remove(documentId: string, name: string) {
    try {
      const result = await detachDocument(row.id, documentId);
      onChanged(result.row);
      notify(result.documentBinned ? `Removed ${name}. It is in your Bin for 30 days.` : `Removed ${name}`);
    } catch (reason) {
      notify(errorMessage(reason, "Could not remove the file"));
    }
  }

  return <div className="row-attachments">
    {files.length > 0 && <ul aria-label={`${field.name} files`}>
      {files.map((file) => <li key={file.id}>
        <a href={contentUrl(file.id, file.preview_kind === "none" ? "attachment" : "inline")} target="_blank" rel="noopener noreferrer" className="row-attachment-open">
          {file.preview_kind === "none" ? <Download aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
          <span>{file.name}<small>{formatBytes(file.size_bytes)}</small></span>
        </a>
        {editable && <button className="icon-button" onClick={() => { void remove(file.id, file.name); }} aria-label={`Remove ${file.name}`}><X /></button>}
      </li>)}
    </ul>}
    {!files.length && !editable && <span className="cell-empty">No files</span>}
    {editable && <>
      <input ref={inputRef} type="file" multiple hidden onChange={(event) => { void attach(event.target.files); }} />
      <button className="secondary-button row-attachment-add" onClick={() => inputRef.current?.click()} disabled={progress !== null || files.length >= 20}>
        <Paperclip />{progress !== null ? `Uploading… ${Math.round(progress * 100)}%` : "Attach files"}
      </button>
    </>}
  </div>;
}
