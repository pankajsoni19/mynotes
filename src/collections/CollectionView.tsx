import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Columns3, Eye, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { ApiError } from "../api";
import { NameDialog } from "../files/RenameDialog";
import { formatRoute } from "../router";
import { collectionsRoute } from "../collectionsRoute";
import type { GoOptions } from "./CollectionsApp";
import {
  deleteRow,
  errorCode,
  errorMessage,
  errorPayload,
  getCollection,
  renameCollection,
  undoRow,
  type CollectionDetail,
  type CollectionRole,
  type CollectionRow,
  type CollectionView as SavedView,
  type FieldValue
} from "./collectionsApi";
import { CollectionTable } from "./CollectionTable";
import { useDialogLayer } from "./dialogLayers";
import { FieldEditor } from "./FieldEditor";
import { CollectionIcon } from "./icons";
import { OptionPicker } from "./OptionPicker";
import { RowActionSheet } from "./RowActionSheet";
import { useRows } from "./useRows";
import { roleLabel, rowCountLabel, validateCollectionName } from "./values";

type CollectionViewProps = {
  userId: string;
  collectionId: string;
  /** The saved view on screen (for a row entry, the view it was opened over). */
  viewId: string | null;
  rowId: string | null;
  go: (route: ReturnType<typeof collectionsRoute>, options?: GoOptions) => void;
  onBack: () => void;
  onMissing: (what: "collection" | "view" | "row") => void;
  notify: (message: string) => void;
};

type Dialog =
  | { kind: "fields" }
  | { kind: "rename" }
  | { kind: "picker"; rowId: string; fieldId: string }
  | { kind: "actions"; rowId: string };

export function CollectionView({ collectionId, viewId, rowId, go, onBack, onMissing, notify }: CollectionViewProps) {
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [role, setRole] = useState<CollectionRole>("viewer");
  const [views, setViews] = useState<SavedView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const rows = useRows(collectionId, notify);
  const editable = role !== "viewer";
  const isOwner = role === "owner";

  const loadCollection = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await getCollection(collectionId);
      setCollection(result.collection);
      setRole(result.role);
      setViews(result.views);
      return result;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) onMissing("collection");
      else setLoadError(errorMessage(reason, "Could not open this collection"));
      return null;
    }
  }, [collectionId, onMissing]);

  useEffect(() => { void loadCollection(); }, [loadCollection]);

  const view = viewId ? views.find((item) => item.id === viewId) ?? null : null;
  useEffect(() => {
    if (!collection) return;
    if (viewId && !view) {
      onMissing("view");
      return;
    }
    void rows.load(viewId ? { viewId } : {});
    // rows.load is stable per collection; reload when the view or the schema changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection?.id, collection?.schema_version, viewId, view?.id]);

  // The row panel arrives with stage A commit 5; until then a row URL opens its collection.
  useEffect(() => {
    if (rowId) go(collectionsRoute(collectionId, { viewId }), { replace: true });
  }, [collectionId, go, rowId, viewId]);

  const closeDialog = useCallback(() => setDialog(null), []);
  useDialogLayer(dialog !== null, closeDialog);

  const fields = useMemo(() => {
    const hidden = new Set(view?.config.hiddenFieldIds ?? []);
    return (collection?.fields ?? []).filter((field, index) => index === 0 || !hidden.has(field.id));
  }, [collection?.fields, view?.config.hiddenFieldIds]);

  const findRow = (id: string) => rows.rows.find((row) => row.id === id) ?? null;

  function openRow(row: CollectionRow) {
    go(collectionsRoute(collectionId, { rowId: row.id }), { underlyingViewId: viewId });
  }

  async function undo(row: CollectionRow) {
    setDialog(null);
    try {
      rows.replaceRow((await undoRow(row.id, row.revision)).row);
      notify("Change undone");
    } catch (reason) {
      if (errorCode(reason) === "ROW_CHANGED") {
        const current = errorPayload<{ row?: CollectionRow }>(reason)?.row;
        if (current) rows.replaceRow(current);
        notify("Someone else changed this row since. Check it before undoing.");
      } else notify(errorMessage(reason, "Could not undo"));
    }
  }

  async function remove(row: CollectionRow) {
    setDialog(null);
    try {
      await deleteRow(row.id);
      rows.removeRow(row.id);
      notify("Row moved to the Bin");
    } catch (reason) {
      notify(errorMessage(reason, "Could not delete the row"));
    }
  }

  async function copyLink(row: CollectionRow) {
    setDialog(null);
    const url = `${window.location.origin}${formatRoute(collectionsRoute(collectionId, { rowId: row.id }))}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copied");
    } catch {
      notify(url);
    }
  }

  async function add(title: string) {
    const primary = collection?.fields[0];
    if (!primary) return false;
    return Boolean(await rows.create({ [primary.id]: title }));
  }

  if (loadError) return <section className="collection-view"><div className="bin-state bin-error collection-state" role="alert">
    <span className="bin-state-icon"><TriangleAlert /></span>
    <h2>Could not open this collection</h2>
    <p>{loadError}</p>
    <button className="primary-button" onClick={() => { void loadCollection(); }}><RotateCcw />Try again</button>
  </div></section>;
  if (!collection) return <section className="collection-view"><p className="bin-loading collection-state" role="status">Opening collection…</p></section>;

  const dialogRow = dialog && (dialog.kind === "picker" || dialog.kind === "actions") ? findRow(dialog.rowId) : null;
  const pickerField = dialog?.kind === "picker" ? collection.fields.find((field) => field.id === dialog.fieldId) ?? null : null;

  return <section className="collection-view" aria-labelledby="collection-title">
    <header className="collection-header">
      <button className="icon-button" onClick={onBack} aria-label="Back"><ArrowLeft /></button>
      <span className="collection-icon"><CollectionIcon name={collection.icon} /></span>
      <div className="collection-heading">
        <span className="eyebrow">{view ? view.name : collection.is_owner ? "Collection" : `${collection.owner_name}'s collection`}</span>
        <h1 id="collection-title" title={collection.name}>{collection.name}</h1>
      </div>
      <span className="collection-count">{rowCountLabel(rows.total)}</span>
      {!editable && <span className="collection-role role-viewer"><Eye aria-hidden="true" />{roleLabel(role)}</span>}
      {role === "editor" && <span className="collection-role role-editor">{roleLabel(role)}</span>}
      {isOwner && <span className="collection-header-actions">
        <button className="icon-button" onClick={() => setDialog({ kind: "rename" })} aria-haspopup="dialog" aria-label="Rename collection" title="Rename"><Pencil /></button>
        <button className="secondary-button collection-action" onClick={() => setDialog({ kind: "fields" })} aria-haspopup="dialog"><Columns3 />Fields</button>
      </span>}
    </header>

    {rows.loadError && <div className="bin-state bin-error collection-state" role="alert">
      <h2>Could not load the rows</h2>
      <p>{rows.loadError}</p>
      <button className="primary-button" onClick={() => { void rows.reload(); }}><RotateCcw />Try again</button>
    </div>}
    {!rows.loadError && rows.loading && !rows.rows.length && <p className="bin-loading collection-state" role="status">Loading rows…</p>}
    {!rows.loadError && !(rows.loading && !rows.rows.length) && <div className="collection-body">
      <CollectionTable
        fields={fields}
        rows={rows.rows}
        editable={editable}
        conflicts={rows.conflicts}
        activeRowId={rowId}
        onSave={(row, values: Record<string, FieldValue | null>) => rows.save(row.id, values)}
        onOpenRow={openRow}
        onRowActions={(row) => setDialog({ kind: "actions", rowId: row.id })}
        onOpenPicker={(row, field) => setDialog({ kind: "picker", rowId: row.id, fieldId: field.id })}
        onReloadRow={(row) => rows.acceptConflict(row.id)}
        onAdd={editable ? add : undefined}
      />
      {!rows.rows.length && <p className="collection-empty">{editable ? "No rows yet. Add one below." : "No rows yet."}</p>}
      {rows.nextCursor && <button className="secondary-button collection-more" onClick={() => { void rows.loadMore(); }}>Load more ({rows.rows.length} of {rows.total})</button>}
    </div>}

    {dialog?.kind === "fields" && <FieldEditor collection={collection} onClose={closeDialog} onReload={() => { setDialog(null); void loadCollection(); }} onSaved={(saved) => {
      setDialog(null);
      setCollection(saved);
      notify("Fields saved");
    }} />}
    {dialog?.kind === "rename" && <NameDialog title="Rename collection" eyebrow="Collections" label="Name" initialValue={collection.name} submitLabel="Rename" hint="Up to 120 characters."
      validate={(value) => validateCollectionName(value, collection.name)} onCancel={closeDialog} onSubmit={async (name) => {
        const { collection: saved } = await renameCollection(collection.id, name);
        setCollection(saved);
        setDialog(null);
      }} />}
    {dialog?.kind === "picker" && dialogRow && pickerField && <OptionPicker field={pickerField} selected={Array.isArray(dialogRow.values[pickerField.id]) ? dialogRow.values[pickerField.id] as string[] : []}
      onClose={closeDialog} onSave={(ids) => rows.save(dialogRow.id, { [pickerField.id]: ids.length ? ids : null })} />}
    {dialog?.kind === "actions" && dialogRow && <RowActionSheet row={dialogRow} editable={editable} onClose={closeDialog}
      onUndo={() => { void undo(dialogRow); }} onDelete={() => { void remove(dialogRow); }} onCopyLink={() => { void copyLink(dialogRow); }} />}
  </section>;
}
