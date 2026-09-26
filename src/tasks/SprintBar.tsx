import { CircleCheck, Play, Timer } from "lucide-react";
import { Select } from "../ui/Select";
import { activeSprint, progressLabel, selectionValue, sprintDateRange, sprintProgress, sprintStateLabel, sprintTiming, type SprintSelection } from "./sprintModel";
import type { BoardColumn, CardSummary, SprintSummary } from "./tasksApi";

type SprintBarProps = {
  sprints: readonly SprintSummary[];
  selection: SprintSelection;
  /** The board's cards with their effective sprints (boardData), for the counts. */
  cards: ReadonlyArray<Pick<CardSummary, "id" | "column_id" | "level" | "parent_card_id" | "sprint_id">>;
  columns: readonly BoardColumn[];
  workLevel: number;
  /** "Tasks": the work level's plural. */
  plural: string;
  /** "Task": the work level's name. */
  name: string;
  today: string;
  owner: boolean;
  onSelect: (value: string) => void;
  onStart: (sprint: SprintSummary) => void;
  onComplete: (sprint: SprintSummary, trigger: HTMLElement) => void;
};

/**
 * The sprint switcher and progress strip under the board header (research 2026-09-26 §7.3, §9.4 B
 * and D): a Select-styled button listing the active and planned sprints, Backlog, All cards, and
 * the latest completed sprints; then "Sprint 12 · 4 days left · 8 of 14 done" with a bar by column
 * state (counts only, no points, Q4). The owner starts a planned sprint or completes the active one
 * here. On phones the switcher is a bottom sheet that Back closes (D69).
 */
export function SprintBar({ sprints, selection, cards, columns, workLevel, plural, name, today, owner, onSelect, onStart, onComplete }: SprintBarProps) {
  const count = (sprintId: string | null) => sprintProgress(cards, columns, sprintId, workLevel);
  const options = [
    ...sprints.filter((sprint) => sprint.state !== "completed").map((sprint) => {
      const progress = count(sprint.id);
      return { value: sprint.id, label: sprint.name, description: [sprintStateLabel(sprint), sprintDateRange(sprint), sprint.state === "active" ? `${progress.done}/${progress.total} done` : `${progress.total}`].filter(Boolean).join(" · ") };
    }),
    { value: "backlog", label: "Backlog", description: `No sprint · ${count(null).total}` },
    { value: "all", label: "All cards", description: "Every sprint and the backlog" },
    ...sprints.filter((sprint) => sprint.state === "completed").map((sprint) => ({
      value: sprint.id, label: sprint.name, description: ["Completed", sprintDateRange(sprint)].filter(Boolean).join(" · "), group: "Completed"
    }))
  ];
  const shown = selection.kind === "sprint" ? selection.sprint : null;
  const progress = selection.kind === "all" ? null : count(shown?.id ?? null);
  const active = activeSprint(sprints);
  const percent = (value: number) => progress && progress.total ? `${(value / progress.total) * 100}%` : "0%";

  return <div className="task-sprint-bar" role="group" aria-label="Sprint">
    <Select variant="chip" className="task-sprint-switch" label="Sprint" value={selectionValue(selection)} options={options} onChange={onSelect} searchable="auto" />
    {progress && <p className="task-sprint-strip" aria-live="polite">
      {shown && <span className="task-sprint-timing"><Timer aria-hidden="true" />{[sprintTiming(shown, today), sprintDateRange(shown)].filter(Boolean).join(" · ") || sprintStateLabel(shown)}</span>}
      <span className="task-sprint-count">{shown ? progressLabel(progress, plural) : `${progress.total} ${(progress.total === 1 ? name : plural).toLowerCase()} not in a sprint`}</span>
      {shown && progress.total > 0 && <span className="task-sprint-meter" role="img" aria-label={`${progress.done} done, ${progress.doing} in progress, ${progress.todo} to do`}>
        <i className="done" style={{ width: percent(progress.done) }} /><i className="doing" style={{ width: percent(progress.doing) }} /><i className="todo" style={{ width: percent(progress.todo) }} />
      </span>}
    </p>}
    {owner && shown?.state === "active" && <button type="button" className="secondary-button task-small-button task-sprint-action" aria-haspopup="dialog" onClick={(event) => onComplete(shown, event.currentTarget)}><CircleCheck />Complete…</button>}
    {owner && shown?.state === "planned" && !active && <button type="button" className="secondary-button task-small-button task-sprint-action" onClick={() => onStart(shown)}><Play />Start sprint</button>}
  </div>;
}
