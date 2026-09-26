import { useId, useState } from "react";
import { CircleCheck } from "lucide-react";
import { TASK_STATES, type TaskState } from "../../../shared/taskQuery";
import { Select } from "../../ui/Select";
import { taskErrorMessage, type BoardColumn } from "../tasksApi";
import { columnState, updateColumnState, type StatefulColumn } from "../home/homeApi";
import { STATE_LABELS } from "../home/homeResults";

const STATE_HINTS: Record<TaskState, string> = {
  todo: "Not started yet",
  doing: "Being worked on",
  done: "Finished: left out of Today and the due chip"
};

type ColumnStateFieldProps = {
  column: BoardColumn;
  /** The board's columns after the change (the server keeps `is_done` = state done, T121). */
  onChanged: (columns: BoardColumn[], column: StatefulColumn) => void;
  onError: (message: string) => void;
};

/**
 * The column's state in the owner's column menu (17C, D141): To do, In progress, or Done, the
 * shared vocabulary of `state:` filters, My work, and the view lanes. Done is the old "done
 * column" switch, so the two can never disagree.
 */
export function ColumnStateField({ column, onChanged, onError }: ColumnStateFieldProps) {
  const labelId = useId();
  const [busy, setBusy] = useState(false);
  const current = columnState(column as StatefulColumn);

  async function change(state: TaskState) {
    if (state === current || busy) return;
    setBusy(true);
    try {
      const { columns, column: saved } = await updateColumnState(column.id, state);
      onChanged(columns, saved);
    } catch (reason) {
      onError(taskErrorMessage(reason, "Could not change the column"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="task-column-state">
    <CircleCheck aria-hidden="true" />
    <span className="task-column-state-copy">
      <span id={labelId}>State</span>
      <small>{STATE_HINTS[current]}</small>
    </span>
    <Select<TaskState> variant="chip" label="Column state" labelledBy={labelId} value={current} disabled={busy} searchable={false} onChange={(state) => { void change(state); }}
      options={TASK_STATES.map((state) => ({ value: state, label: STATE_LABELS[state], description: STATE_HINTS[state] }))} />
  </div>;
}
