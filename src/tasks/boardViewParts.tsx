import { Ban, CalendarDays, CircleAlert, Eye, Pause } from "lucide-react";
import type { TaskFlag } from "../../shared/taskQuery";
import { FLAG_LABELS, tagLabel, type BoardCard, type BoardData } from "./boardQuery";
import { dueStatus } from "./taskActions";

// Small read-only pieces the table, list, and calendar views share. Every label is React text (T98).

const FLAG_ICONS: Record<TaskFlag, typeof Ban> = { urgent: CircleAlert, blocked: Ban, needs_review: Eye, on_hold: Pause };

export function FlagIcons({ flags }: { flags: readonly string[] }) {
  const known = flags.filter((flag): flag is TaskFlag => flag in FLAG_LABELS);
  if (!known.length) return null;
  return <span className="task-flags">
    {known.map((flag) => {
      const Icon = FLAG_ICONS[flag];
      return <Icon key={flag} className={`task-flag flag-${flag}`} role="img" aria-label={FLAG_LABELS[flag]} />;
    })}
  </span>;
}

/** Up to `max` tag chips, then "+N". */
export function TagChips({ tagIds, board, max = 3 }: { tagIds: readonly string[]; board: BoardData; max?: number }) {
  if (!tagIds.length) return null;
  const shown = tagIds.slice(0, max);
  const names = tagIds.map((id) => tagLabel(id, board));
  return <span className="task-tags" aria-label={`Tags ${names.join(", ")}`} role="group">
    {shown.map((id) => {
      const tag = board.tags.find((item) => item.id === id);
      return <span key={id} className={`task-tag tone-${tag?.color ?? "gray"}`} aria-hidden="true">{tag?.name ?? "Unknown tag"}</span>;
    })}
    {tagIds.length > max && <span className="task-tag more" aria-hidden="true">+{tagIds.length - max}</span>}
  </span>;
}

export function DueChip({ card, today, done }: { card: BoardCard; today: string; done: boolean }) {
  const due = dueStatus(card.due_on, today, done, { dueAt: card.due_at });
  if (!due) return null;
  return <span className={`task-due-chip ${due.tone}`} title={due.description}><CalendarDays aria-hidden="true" /><span aria-hidden="true">{due.label}</span><span className="sr-only">{due.description}</span></span>;
}

export function assigneeNames(card: BoardCard) {
  return card.assignees.map((person) => person.can_read === 1 ? person.display_name : `${person.display_name} (no access)`);
}

export function shortTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
