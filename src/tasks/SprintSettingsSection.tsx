import { useId, useState } from "react";
import { CircleCheck, Pencil, Play, Plus, Timer, Trash2 } from "lucide-react";
import { SPRINT_NAME_MAX } from "../../shared/sprintPlan";
import { activeSprint, newSprintDefaults, sprintDateRange, sprintStateLabel } from "./sprintModel";
import { listSprints, taskErrorMessage, type SprintFields, type SprintSummary } from "./tasksApi";

type SprintSettingsSectionProps = {
  boardId: string;
  sprints: readonly SprintSummary[];
  owner: boolean;
  today: string;
  /** "Tasks": what a sprint holds. */
  plural: string;
  onCreate: (fields: SprintFields & { name: string }) => Promise<SprintSummary | null>;
  onUpdate: (sprint: SprintSummary, change: SprintFields) => Promise<boolean>;
  onStart: (sprint: SprintSummary) => Promise<void>;
  onDelete: (sprint: SprintSummary) => Promise<void>;
  /** Opens the close dialog (it replaces Board settings, like Rename). */
  onComplete: (sprint: SprintSummary) => void;
};

type Draft = { name: string; startOn: string; endOn: string };

/** Name and dates, inline in the section (a new sprint, or editing one). */
function SprintForm({ initial, submitLabel, busy, onSubmit, onCancel }: { initial: Draft; submitLabel: string; busy: boolean; onSubmit: (draft: Draft) => void; onCancel: () => void }) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const name = draft.name.trim();
  const backwards = Boolean(draft.startOn && draft.endOn && draft.startOn > draft.endOn);
  return <form className="task-sprint-form" noValidate onSubmit={(event) => { event.preventDefault(); if (name && !backwards) onSubmit({ ...draft, name }); }}
    onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <label htmlFor={`${id}-name`}>Name</label>
    <input id={`${id}-name`} value={draft.name} maxLength={SPRINT_NAME_MAX} autoFocus disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
    <span className="task-sprint-dates">
      <label>Starts<input type="date" value={draft.startOn} min="1900-01-01" max="2999-12-31" disabled={busy} onChange={(event) => setDraft({ ...draft, startOn: event.target.value })} /></label>
      <label>Ends<input type="date" value={draft.endOn} min={draft.startOn || "1900-01-01"} max="2999-12-31" disabled={busy} onChange={(event) => setDraft({ ...draft, endOn: event.target.value })} /></label>
    </span>
    {backwards && <p className="file-dialog-error" role="alert">The sprint cannot end before it starts.</p>}
    <span className="task-settings-actions">
      <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" className="primary-button" disabled={busy || !name || backwards}>{busy ? "Saving…" : submitLabel}</button>
    </span>
  </form>;
}

/**
 * Board settings → Sprints (research 2026-09-26 §7.1, §7.5, D132): the board's sprints with their
 * state, dates, and card counts. The owner adds one (named and dated after the latest), renames or
 * re-dates it, starts a planned sprint (one active at a time), completes the active one (the close
 * dialog), and deletes an empty planned one. Everyone else sees the list.
 */
export function SprintSettingsSection({ boardId, sprints, owner, today, plural, onCreate, onUpdate, onStart, onDelete, onComplete }: SprintSettingsSectionProps) {
  const titleId = useId();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [older, setOlder] = useState<{ sprints: SprintSummary[]; cursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = sprints.filter((sprint) => sprint.state !== "completed");
  const recent = sprints.filter((sprint) => sprint.state === "completed");
  const completed = [...recent, ...(older?.sprints ?? []).filter((sprint) => !recent.some((item) => item.id === sprint.id))];
  const active = activeSprint(sprints);
  const defaults = newSprintDefaults(sprints, today);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };

  async function loadOlder() {
    setError(null);
    try {
      // The payload has the latest completed sprints; the rest page from the sprint list.
      const page = await listSprints(boardId, { state: "completed", ...(older?.cursor ? { cursor: older.cursor } : {}) });
      setOlder({ sprints: [...(older?.sprints ?? []), ...page.sprints], cursor: page.nextCursor });
    } catch (reason) {
      setError(taskErrorMessage(reason, "Could not load older sprints"));
    }
  }

  const row = (sprint: SprintSummary) => <li key={sprint.id} className={`task-sprint-row${sprint.state === "active" ? " active" : ""}`}>
    {editing === sprint.id
      ? <SprintForm initial={{ name: sprint.name, startOn: sprint.start_on ?? "", endOn: sprint.end_on ?? "" }} submitLabel="Save" busy={busy}
        onCancel={() => setEditing(null)}
        onSubmit={(draft) => { void run(async () => { if (await onUpdate(sprint, { name: draft.name, startOn: draft.startOn || null, endOn: draft.endOn || null })) setEditing(null); }); }} />
      : <>
        <span className="task-sprint-row-copy">
          <strong title={sprint.name}>{sprint.name}</strong>
          <small>{[sprintStateLabel(sprint), sprintDateRange(sprint), `${sprint.card_count} ${plural.toLowerCase()}${sprint.card_count ? ` · ${sprint.done_count} done` : ""}`].filter(Boolean).join(" · ")}</small>
        </span>
        {owner && <span className="task-sprint-row-actions">
          {sprint.state === "planned" && !active && <button type="button" className="secondary-button task-small-button" disabled={busy} onClick={() => { void run(() => onStart(sprint)); }}><Play />Start</button>}
          {sprint.state === "active" && <button type="button" className="secondary-button task-small-button" aria-haspopup="dialog" disabled={busy} onClick={() => onComplete(sprint)}><CircleCheck />Complete…</button>}
          {sprint.state !== "completed" && <button type="button" className="icon-button" disabled={busy} aria-label={`Edit ${sprint.name}`} title="Edit" onClick={() => setEditing(sprint.id)}><Pencil /></button>}
          {sprint.state === "planned" && <button type="button" className="icon-button" disabled={busy || sprint.card_count > 0} aria-label={`Delete ${sprint.name}`}
            title={sprint.card_count > 0 ? `Move its ${plural.toLowerCase()} out first` : "Delete"} onClick={() => { void run(() => onDelete(sprint)); }}><Trash2 /></button>}
        </span>}
      </>}
  </li>;

  return <section className="task-settings-section" aria-labelledby={titleId}>
    <h3 id={titleId}><Timer aria-hidden="true" />Sprints</h3>
    {open.length
      ? <ul className="task-sprint-list" aria-label="Planned and active sprints">{open.map(row)}</ul>
      : <p className="task-settings-note">No planned sprints.{owner ? " Add one to plan the next piece of work." : ""}</p>}
    {owner && (editing === "new"
      ? <SprintForm initial={defaults} submitLabel="Add sprint" busy={busy} onCancel={() => setEditing(null)}
        onSubmit={(draft) => { void run(async () => { if (await onCreate({ name: draft.name, startOn: draft.startOn || null, endOn: draft.endOn || null })) setEditing(null); }); }} />
      : <button type="button" className="secondary-button task-small-button" disabled={busy} onClick={() => setEditing("new")}><Plus />New sprint</button>)}
    {!owner && <p className="task-settings-note">Only the owner adds, starts, and completes sprints. Anyone can plan {plural.toLowerCase()} in them from the card.</p>}
    {completed.length > 0 && <details className="task-sprint-history">
      <summary>Completed sprints</summary>
      <ul className="task-sprint-list">{completed.map(row)}</ul>
      {(older === null || older.cursor) && <button type="button" className="secondary-button task-small-button" onClick={() => { void loadOlder(); }}>Show older</button>}
    </details>}
    {error && <p className="file-dialog-error" role="alert">{error}</p>}
  </section>;
}
