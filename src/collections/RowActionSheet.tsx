import { useEffect } from "react";
import { Link2, Trash2, Undo2, X } from "lucide-react";
import { trapTabKey } from "../files/Dialog";
import type { CollectionRow } from "./collectionsApi";
import { rowTitle } from "./values";

type RowActionSheetProps = {
  row: CollectionRow;
  editable: boolean;
  onUndo: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onClose: () => void;
};

// Row actions: Undo last change, Delete (to the Bin), Copy link. A bottom sheet on phones and a
// small dialog on desktop. Pushes no history entry; Back and Escape close it (dialogLayers).
export function RowActionSheet({ row, editable, onUndo, onDelete, onCopyLink, onClose }: RowActionSheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const title = rowTitle(row);
  return <>
    <button className="panel-scrim" onClick={onClose} aria-label="Close actions" tabIndex={-1} />
    <div className="file-sheet collection-row-sheet" role="dialog" aria-modal="true" aria-labelledby="row-sheet-title" onKeyDown={trapTabKey}>
      <header>
        <strong id="row-sheet-title" title={title}>{title}</strong>
        <button className="icon-button" onClick={onClose} aria-label="Close actions"><X /></button>
      </header>
      {editable && <button onClick={onUndo} disabled={!row.can_undo} autoFocus={row.can_undo}><Undo2 />{row.can_undo ? "Undo last change" : "Nothing to undo"}</button>}
      <button onClick={onCopyLink} autoFocus={!editable || !row.can_undo}><Link2 />Copy link</button>
      {editable && <button className="danger" onClick={onDelete}><Trash2 />Move to Bin</button>}
      <button onClick={onClose}>Cancel</button>
    </div>
  </>;
}
