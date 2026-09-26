import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Filter, RotateCcw, TriangleAlert, Undo2 } from "lucide-react";
import { format } from "../../../shared/taskQuery";
import { ApiError } from "../../api";
import { taskErrorMessage } from "../tasksApi";
import { viewerTimeZone, type TaskNotify } from "../taskActions";
import { getView, type QueriedCard, type TaskView } from "../home/homeApi";
import { HomeResultsPane, type HomeDirectory } from "../home/HomeResultsPane";
import { useTasksTitle } from "../home/HomeSegments";
import { isSelectiveQuery, NEW_VIEW, newViewDefault, sameHomeQuery, serverGroup, viewHomeQuery, type HomeQuery } from "../home/homeUrl";
import { viewVisibilityLabel } from "./viewActions";

type ViewPageProps = {
  userId: string;
  viewId: string;
  /** The URL's unsaved change to the view, or undefined for the saved one. */
  query: HomeQuery | undefined;
  /** Replace: the view's filter, group, and sort; push: layouts and committed filter changes. */
  onQuery: (next: HomeQuery | undefined, options: { push: boolean }) => void;
  directory: HomeDirectory;
  notify: TaskNotify;
  onOpenCard: (card: QueriedCard) => void;
  /** Opens another view; `replace` when this entry should go. */
  onOpenView: (view: TaskView, options?: { replace?: boolean }) => void;
  onBack: () => void;
  /** After a delete: the views list, replacing this entry. */
  onDeleted: () => void;
  onMissing: () => void;
};

/**
 * One saved view (§10.2): its filter bar and layouts, run as the viewer. A recipient sees it
 * read-only. `new` is an unsaved view. Nothing runs until the filter has a key other than text (Q11).
 */
export function ViewPage({ userId, viewId, query, onQuery, directory, notify, onOpenCard, onBack, onMissing }: ViewPageProps) {
  const isNew = viewId === NEW_VIEW;
  const [view, setView] = useState<TaskView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoadError(null);
    try {
      setView((await getView(viewId)).view);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) onMissing();
      else setLoadError(taskErrorMessage(reason, "Could not open this view"));
    }
  }, [isNew, viewId, onMissing]);
  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  useTasksTitle(isNew ? "New view · Tasks" : view ? `${view.name} · Views · Tasks` : "Views · Tasks");

  const saved = view ? viewHomeQuery(view) : newViewDefault();
  const effective = query ?? saved;
  const owner = isNew || view?.is_owner === 1;
  const dirty = isNew ? isSelectiveQuery(effective.filter) : Boolean(view && query && !sameHomeQuery(query, saved));
  const selective = isSelectiveQuery(effective.filter);
  const tz = viewerTimeZone();
  const source = !selective || (!isNew && !view) ? null
    : !isNew && !query ? { kind: "view" as const, viewId, tz }
    : { kind: "query" as const, request: { q: format(effective.filter), sort: effective.sort, group: serverGroup(effective.group), tz } };

  const title = isNew ? "New view" : view?.name ?? (loadError ? "View" : "Loading…");
  const readOnly = !owner;

  return <div className="task-view-page">
    <header className="task-view-header">
      <button className="icon-button task-back" onClick={onBack} aria-label="Back to views" title="Back to views"><ChevronLeft /></button>
      <div className="task-board-heading">
        <span className="eyebrow">{isNew ? "Unsaved view" : view && !owner ? `${view.owner_name}’s view · read only` : view ? `View · ${viewVisibilityLabel(view.visibility)}` : "View"}</span>
        <h2 id="task-view-title" title={title}>{title}</h2>
      </div>
      {dirty && !isNew && <span className="task-view-dirty" role="status">Unsaved changes</span>}
      <span className="task-view-actions">
        {!isNew && view && owner && dirty && <button className="icon-button" onClick={() => onQuery(undefined, { push: true })} aria-label="Discard changes" title="Discard changes"><Undo2 /></button>}
      </span>
    </header>
    {loadError && <div className="bin-state bin-error" role="alert">
      <span className="bin-state-icon"><TriangleAlert /></span>
      <h2>Could not open this view</h2>
      <p>{loadError}</p>
      <button className="primary-button" onClick={() => { void load(); }}><RotateCcw />Try again</button>
    </div>}
    {(isNew || view) && <HomeResultsPane userId={userId} query={effective} directory={directory} notify={notify} onOpenCard={onOpenCard} readOnly={readOnly}
      onQuery={(next, options) => onQuery(!isNew && sameHomeQuery(next, saved) ? undefined : next, options)}
      source={source}
      idle={<div className="bin-state task-home-empty">
        <span className="bin-state-icon"><Filter /></span>
        <h2>{readOnly ? "This view has no filter yet" : "Add a filter to see cards"}</h2>
        <p>{readOnly ? "Its owner has not chosen a board, person, state, or other filter." : "Choose a board, a person, a state, a tag, or a due date with + Filter. Views search across every board you can open, so they start with at least one filter."}</p>
      </div>}
      emptyText="No cards on your boards match this view." />}
  </div>;
}
