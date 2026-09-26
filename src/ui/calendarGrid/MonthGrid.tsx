import { useState, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthGridDays, monthOf, weekdayLabels } from "../../calendarRoute";
import { dayHeading, monthHeading } from "../../calendar/calendarFormat";

export type MonthGridProps = {
  /** `yyyy-mm`. */
  month: string;
  /** The viewer's local date. */
  today: string;
  /** The day shown as selected (the caller resolves the default). */
  selectedDay: string;
  /** Phones: a dot grid of buttons; the caller lists the selected day below (`children`). */
  compact: boolean;
  /** Items on a day, for the cell's accessible name ("…, 2 items"). */
  countFor: (day: string) => number;
  /** A full cell's chips. */
  renderDay: (day: string) => ReactNode;
  /** A compact cell's dots. */
  renderDots: (day: string) => ReactNode;
  onSelectDay: (day: string) => void;
  onShiftMonth: (delta: number) => void;
  onToday: () => void;
  /** Shown instead of the grid (an error, for example). */
  status?: ReactNode;
  /** The grid is showing another month's data while this one loads. */
  busy?: boolean;
  titleId?: string;
  /** Drag and drop onto full cells: `accepts` checks the drag's types, `onDropOnDay` gets its data. */
  drop?: { accepts: (types: readonly string[]) => boolean; type: string; onDropOnDay: (day: string, payload: string) => void };
  /** After the grid: the selected day's list. */
  children?: ReactNode;
};

/**
 * The presentational month grid shared by Calendar and the board calendar view
 * (WAVE_13_TASK_CARD_UX.md §4.5a): six Monday-first weeks with a heading and prev/next/Today.
 * It fetches nothing; each caller renders its own items into the cells.
 */
export function MonthGrid(props: MonthGridProps) {
  const { month, today, selectedDay, compact, countFor, renderDay, renderDots, onSelectDay, onShiftMonth, onToday, status, busy = false, titleId = "calendar-month-title", drop, children } = props;
  const [dropDay, setDropDay] = useState<string | null>(null);
  const days = monthGridDays(month);

  const dropHandlers = (cell: string) => drop ? {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (!drop.accepts(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropDay !== cell) setDropDay(cell);
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDay((current) => current === cell ? null : current);
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      if (!drop.accepts(Array.from(event.dataTransfer.types))) return;
      event.preventDefault();
      setDropDay(null);
      drop.onDropOnDay(cell, event.dataTransfer.getData(drop.type));
    }
  } : {};

  return <section className={`calendar-month${compact ? " compact" : ""}`} aria-labelledby={titleId}>
    <div className="calendar-month-bar">
      <button className="icon-button calendar-nav-button" onClick={() => onShiftMonth(-1)} aria-label="Previous month"><ChevronLeft /></button>
      <h2 id={titleId} aria-live="polite">{monthHeading(month)}</h2>
      <button className="icon-button calendar-nav-button" onClick={() => onShiftMonth(1)} aria-label="Next month"><ChevronRight /></button>
      {monthOf(today) !== month && <button className="secondary-button calendar-today-button" onClick={onToday}>Today</button>}
    </div>

    {status}

    {!status && <div className={`calendar-grid${busy ? " loading" : ""}`} role="grid" aria-label={monthHeading(month)} aria-busy={busy || undefined}>
      <div className="calendar-grid-row calendar-weekdays" role="row">
        {weekdayLabels.map((label) => <span key={label} role="columnheader">{compact ? label.slice(0, 1) : label}</span>)}
      </div>
      {Array.from({ length: 6 }, (_, week) => <div key={week} className="calendar-grid-row" role="row">
        {days.slice(week * 7, week * 7 + 7).map((cell) => {
          const markers = countFor(cell);
          const outside = !cell.startsWith(month);
          const label = `${dayHeading(cell, today)}${markers ? `, ${markers === 1 ? "1 item" : `${markers} items`}` : ""}`;
          const className = `calendar-cell${outside ? " outside" : ""}${cell === today ? " today" : ""}${cell === selectedDay ? " selected" : ""}${dropDay === cell ? " drop-target" : ""}`;
          if (compact) {
            return <button key={cell} role="gridcell" className={className} aria-selected={cell === selectedDay} aria-label={label} onClick={() => onSelectDay(cell)}>
              <span className="calendar-cell-number">{Number(cell.slice(8))}</span>
              <span className="calendar-cell-dots" aria-hidden="true">{renderDots(cell)}</span>
            </button>;
          }
          return <div key={cell} role="gridcell" className={className} aria-selected={cell === selectedDay} data-day={drop ? cell : undefined} {...dropHandlers(cell)}>
            <button className="calendar-cell-number" onClick={() => onSelectDay(cell)} aria-label={label}>{Number(cell.slice(8))}</button>
            <div className="calendar-cell-chips">{renderDay(cell)}</div>
          </div>;
        })}
      </div>)}
    </div>}

    {children}
  </section>;
}
