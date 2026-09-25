import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCcw, Table2, TriangleAlert, Users } from "lucide-react";
import { relativeTime } from "../files/format";
import { errorMessage, listCollections, type CollectionDetail, type CollectionSummary } from "./collectionsApi";
import { useDialogLayer } from "./dialogLayers";
import { CollectionIcon } from "./icons";
import { NewCollectionDialog } from "./NewCollectionDialog";
import { roleLabel, rowCountLabel } from "./values";

type CollectionListProps = {
  onOpen: (collection: Pick<CollectionSummary, "id">) => void;
  onOpenRow: (collectionId: string, rowId: string) => void;
  notify: (message: string) => void;
  /** Opens a new collection straight into the CSV import (stage D). */
  onCreatedForImport?: (collection: CollectionDetail) => void;
};

export function CollectionList({ onOpen, notify, onCreatedForImport }: CollectionListProps) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setCollections((await listCollections()).collections);
    } catch (reason) {
      setLoadError(errorMessage(reason, "Could not load your collections"));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const closeDialog = useCallback(() => setCreating(false), []);
  useDialogLayer(creating, closeDialog);

  const all = collections ?? [];
  const owned = all.filter((collection) => collection.is_owner === 1);
  const shared = all.filter((collection) => collection.is_owner !== 1);

  const row = (collection: CollectionSummary) => <li key={collection.id} className="collection-row">
    <button className="collection-open" onClick={() => onOpen(collection)}>
      <span className="collection-icon"><CollectionIcon name={collection.icon} /></span>
      <span className="collection-copy">
        <span className="collection-name" title={collection.name}>{collection.name}</span>
        <span className="collection-meta">
          <span>{rowCountLabel(collection.row_count)}</span>
          <time dateTime={collection.updated_at}>Updated {relativeTime(collection.updated_at)}</time>
          {collection.is_owner === 0
            ? <><span className="owner-badge">{collection.owner_name}</span><span className={`collection-role role-${collection.role}`}>{roleLabel(collection.role)}</span></>
            : collection.visibility !== "private" && <span className="collection-shared"><Users aria-hidden="true" />Shared · {collection.share_role === "editor" ? "can edit" : "view only"}</span>}
        </span>
      </span>
    </button>
  </li>;

  return <section className="collections-content" aria-labelledby="collections-title">
    <div className="collections-intro">
      <div>
        <span className="eyebrow">Typed tables</span>
        <h1 id="collections-title">Collections</h1>
        <p>Track anything in typed tables: inventories, subscriptions, recipes, contacts. Share them view-only or let people edit rows.</p>
      </div>
      <button className="primary-button collections-new-button" onClick={() => setCreating(true)} aria-haspopup="dialog"><Plus />New collection</button>
    </div>

    {loadError && <div className="bin-state bin-error" role="alert">
      <span className="bin-state-icon"><TriangleAlert /></span>
      <h2>Could not load your collections</h2>
      <p>{loadError}</p>
      <button className="primary-button" onClick={() => { void load(); }}><RotateCcw />Try again</button>
    </div>}
    {!loadError && !collections && <p className="bin-loading" role="status">Loading collections…</p>}
    {!loadError && collections && !all.length && <div className="bin-state">
      <span className="bin-state-icon"><Table2 /></span>
      <h2>No collections yet</h2>
      <p>Start from a template such as Home inventory or Recipes, or from a blank table.</p>
      <button className="primary-button" onClick={() => setCreating(true)}><Plus />New collection</button>
    </div>}
    {owned.length > 0 && <><h2 className="collections-section-label">Your collections</h2><ul className="collection-list" aria-label="Your collections">{owned.map(row)}</ul></>}
    {shared.length > 0 && <><h2 className="collections-section-label">Shared with you</h2><ul className="collection-list" aria-label="Collections shared with you">{shared.map(row)}</ul></>}

    {creating && <NewCollectionDialog
      onCancel={closeDialog}
      onCreated={(collection) => {
        setCreating(false);
        notify(`Created “${collection.name}”`);
        onOpen(collection);
      }}
      onImport={onCreatedForImport ? (collection) => { setCreating(false); onCreatedForImport(collection); } : undefined}
    />}
  </section>;
}
