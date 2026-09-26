import type { Key, ReactNode } from "react";
import { dayHeading } from "../../calendar/calendarFormat";

export type AgendaDay<T> = { day: string; items: T[] };

export type AgendaListProps<T> = {
  days: AgendaDay<T>[];
  today: string;
  label: string;
  itemKey: (item: T) => Key;
  renderItem: (item: T, day: string) => ReactNode;
  /** Shown when there are no days. */
  empty?: ReactNode;
  /** Heading id prefix, one heading per day. */
  idPrefix?: string;
  /** After the days: a note such as "Showing the first 1000 events". */
  children?: ReactNode;
};

/**
 * The presentational agenda shared by Calendar and the board calendar view
 * (WAVE_13_TASK_CARD_UX.md §4.5a): one section per day with a "Today"/"Tomorrow"/date heading
 * and a list of items. It fetches nothing; each caller renders its own rows.
 */
export function AgendaList<T>({ days, today, label, itemKey, renderItem, empty, idPrefix = "agenda-", children }: AgendaListProps<T>) {
  return <section className="calendar-agenda" aria-label={label}>
    {!days.length && empty}
    {days.map(({ day, items }) => <section key={day} className="calendar-day-group" aria-labelledby={`${idPrefix}${day}`}>
      <h2 id={`${idPrefix}${day}`} className={day === today ? "today" : undefined}>{dayHeading(day, today)}</h2>
      <ul>
        {items.map((item) => <li key={itemKey(item)}>{renderItem(item, day)}</li>)}
      </ul>
    </section>)}
    {children}
  </section>;
}
