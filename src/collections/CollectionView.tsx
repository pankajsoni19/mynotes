import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Columns3, Eye, Pencil, RotateCcw, Share2, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
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
import { CollectionCards, useIsPhone } from "./CollectionCards";
import { CollectionSharePanel } from "./CollectionSharePanel";
import { CollectionTable } from "./CollectionTable";
import { useDialogLayer } from "./dialogLayers";
import { FieldEditor } from "./FieldEditor";
import { CollectionIcon } from "./icons";
import { OptionPicker } from "./OptionPicker";
import { RowActionSheet } from "./RowActionSheet";
import { RowPanel } from "./RowPanel";
import { SortFilterSheet, type SortFilter } from "./SortFilterSheet";
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
  | { kind: "sortFilter" }
  | { kind: "share" }
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
  // Sort and filters chosen in the sheet override the saved view's until the view changes.
  const [local, setLocal] = useState<SortFilter | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [detached, setDetached] = useState<Record<string, CollectionRow>>({});
  const phone = useIsPhone();
  useEffect(() => { setLocal(null); }, [viewId]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!collection) return;
    if (viewId && !view) {
      onMissing("view");
      return;
    }
    void rows.load({ ...(viewId ? { viewId } : {}), ...(local ? { sort: local.sort, filters: local.filters } : {}), ...(q ? { q } : {}) });
    // rows.load is stable per collection; reload when the view, the schema, or the spec changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection?.id, collection?.schema_version, viewId, view?.id, local, q]);

  const closeDialog = useCallback(() => setDialog(null), []);
  useDialogLayer(dialog !== null, closeDialog);

  const effective: SortFilter = local ?? { sort: view?.config.sort ?? [], filters: view?.config.filters ?? [] };
  const activeCount = effective.sort.length + effective.filters.length;
  const closeRow = useCallback(() => onBack(), [onBack]);
  const rowMissing = useCallback(() => onMissing("row"), [onMissing]);

  const fields = useMemo(() => {
    const hidden = new Set(view?.config.hiddenFieldIds ?? []);
    return (collection?.fields ?? []).filter((field, index) => index === 0 || !hidden.has(field.id));
  }, [collection?.fields, view?.config.hiddenFieldIds]);

  const findRow = (id: string) => rows.rows.find((row) => row.id === id) ?? detached[id] ?? null;
  // Rows outside the loaded page (a deep link, a filtered-out row) are kept here after an undo.
  const showRow = (row: CollectionRow) => {
    rows.replaceRow(row);
    if (!rows.rows.some((item) => item.id === row.id)) setDetached((items) => ({ ...items, [row.id]: row }));
  };

  function openRow(row: CollectionRow) {
    go(collectionsRoute(collectionId, { rowId: row.id }), { underlyingViewId: viewId });
  }

  async function undo(row: CollectionRow) {
    setDialog(null);
    try {
      showRow((await undoRow(row.id, row.revision)).row);
      notify("Change undone");
    } catch (reason) {
      if (errorCode(reason) === "ROW_CHANGED") {
        const current = errorPayload<{ row?: CollectionRow }>(reason)?.row;
        if (current) showRow(current);
        notify("Someone else changed this row since. Check it before undoing.");
      } else notify(errorMessage(reason, "Could not undo"));
    }
  }

  async function remove(row: CollectionRow) {
    setDialog(null);
    try {
      await deleteRow(row.id);
      rows.removeRow(row.id);
      if (rowId === row.id) onBack();
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
        <button className="secondary-button collection-action" onClick={() => setDialog({ kind: "fields" })} aria-haspopup="dialog"><Columns3 /><span>Fields</span></button>
        <button className="secondary-button collection-action" onClick={() => setDialog({ kind: "share" })} aria-haspopup="dialog" aria-label="Share collection"><Share2 /><span>Share</span></button>
      </span>}
    </header>

    <div className="collection-toolbar" role="toolbar" aria-label="Rows">
      <input className="collection-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find rows" aria-label="Find rows" maxLength={200} />
      <button className={`collection-chip${activeCount ? " active" : ""}`} onClick={() => setDialog({ kind: "sortFilter" })} aria-haspopup="dialog"><SlidersHorizontal />{activeCount ? `Sort & filter · ${activeCount}` : "Sort & filter"}</button>
      {local && <button className="collection-chip" onClick={() => setLocal(null)}><X />{view ? `Reset to ${view.name}` : "Clear"}</button>}
    </div>

    <div className="collection-main">
      {rows.loadError && <div className="bin-state bin-error collection-state" role="alert">
        <h2>Could not load the rows</h2>
        <p>{rows.loadError}</p>
        <button className="primary-button" onClick={() => { void rows.reload(); }}><RotateCcw />Try again</button>
      </div>}
      {!rows.loadError && rows.loading && !rows.rows.length && <p className="bin-loading collection-state" role="status">Loading rows…</p>}
      {!rows.loadError && !(rows.loading && !rows.rows.length) && <div className="collection-body">
        {phone
          ? <CollectionCards fields={fields} rows={rows.rows} editable={editable} conflicts={rows.conflicts} onOpenRow={openRow}
            onRowActions={(row) => setDialog({ kind: "actions", rowId: row.id })} onReloadRow={(row) => rows.acceptConflict(row.id)} onAdd={editable ? add : undefined} />
          : <CollectionTable
            fields={fields}
            rows={rows.rows}
            editable={editable}
            conflicts={rows.conflicts}
            activeRowId={rowId}
            onSave={async (row, values: Record<string, FieldValue | null>) => (await rows.save(row.id, values)) !== null}
            onOpenRow={openRow}
            onRowActions={(row) => setDialog({ kind: "actions", rowId: row.id })}
            onOpenPicker={(row, field) => setDialog({ kind: "picker", rowId: row.id, fieldId: field.id })}
            onReloadRow={(row) => rows.acceptConflict(row.id)}
            onAdd={editable ? add : undefined}
          />}
        {!rows.rows.length && <p className="collection-empty">{q || activeCount ? "No rows match." : editable ? "No rows yet. Add one above." : "No rows yet."}</p>}
        {rows.nextCursor && <button className="secondary-button collection-more" onClick={() => { void rows.loadMore(); }}>Load more ({rows.rows.length} of {rows.total})</button>}
      </div>}

      {rowId && <RowPanel
        key={rowId}
        collection={collection}
        rowId={rowId}
        editable={editable}
        listed={findRow(rowId)}
        conflict={rows.conflicts[rowId] ?? null}
        save={rows.save}
        onAcceptConflict={() => rows.acceptConflict(rowId)}
        onActions={(row) => {
          if (!findRow(row.id)) setDetached((items) => ({ ...items, [row.id]: row }));
          setDialog({ kind: "actions", rowId: row.id });
        }}
        onClose={closeRow}
        onMissing={rowMissing}
      />}
    </div>

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
    {dialog?.kind === "share" && <CollectionSharePanel collection={collection} onClose={closeDialog} onChanged={() => {
      setDialog(null);
      notify("Sharing updated");
      void loadCollection();
    }} />}
    {dialog?.kind === "sortFilter" &&<SortFilterSheet fields={collection.fields} value={effective} onClose={closeDialog} onApply={(next) => {
      setDialog(null);
      setLocal(next);
    }} />}
    {dialog?.kind === "picker" && dialogRow && pickerField && <OptionPicker field={pickerField} selected={Array.isArray(dialogRow.values[pickerField.id]) ? dialogRow.values[pickerField.id] as string[] : []}
      onClose={closeDialog} onSave={async (ids) => (await rows.save(dialogRow.id, { [pickerField.id]: ids.length ? ids : null })) !== null} />}
    {dialog?.kind === "actions" && dialogRow && <RowActionSheet row={dialogRow} editable={editable} onClose={closeDialog}
      onUndo={() => { void undo(dialogRow); }} onDelete={() => { void remove(dialogRow); }} onCopyLink={() => { void copyLink(dialogRow); }} />}
  </section>;
}
