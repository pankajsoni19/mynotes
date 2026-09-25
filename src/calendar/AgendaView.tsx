import { useEffect, useState } from "react";
import { CalendarDays, CircleCheck, Repeat, RotateCcw, TriangleAlert } from "lucide-react";
import { addDays, AGENDA_DAYS } from "../calendarRoute";
import { listOccurrences, viewerTimeZone, type DueTask, type Occurrence, type OccurrenceList } from "./calendarApi";
import { agendaDays, dayHeading, occurrenceTimeLabel, tasksByDay } from "./calendarFormat";

type AgendaViewProps = {
  today: string;
  calendarIds: string[] | null;
  showTasks: boolean;
  reloadKey: number;
  onOpen: (occurrence: Occurrence) => void;
};

/** The next 60 days, grouped by the viewer's local day (§4.4), with the "Tasks due" overlay when shown. */
export function AgendaView({ today, calendarIds, showTasks, reloadKey, onOpen }: AgendaViewProps) {
  const [data, setData] = useState<OccurrenceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const from = today;
  const to = addDays(today, AGENDA_DAYS);
  const zone = viewerTimeZone();
  const calendarKey = calendarIds?.join(",") ?? "";

  useEffect(() => {
    let active = true;
    setError(null);
    listOccurrences(from, to, { calendarIds: calendarIds ?? undefined, includeTasks: showTasks })
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load events"); });
    return () => { active = false; };
    // calendarKey stands in for calendarIds.
  }, [from, to, calendarKey, showTasks, reloadKey, attempt]);

  if (error) return <div className="calendar-state" role="alert">
    <TriangleAlert />
    <h2>Could not load your agenda</h2>
    <p>{error}</p>
    <button className="primary-button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw />Try again</button>
  </div>;
  if (!data) return <p className="calendar-loading" role="status">Loading your agenda…</p>;

  const events = new Map(agendaDays(data.occurrences, zone, from, to));
  const tasks = tasksByDay(showTasks ? data.tasks ?? [] : []);
  const days = [...new Set([...events.keys(), ...tasks.keys()])].sort();
  return <section className="calendar-agenda" aria-label="Agenda for the next 60 days">
    {!days.length && <div className="calendar-state">
      <CalendarDays />
      <h2>Nothing planned</h2>
      <p>Events in the next 60 days appear here.</p>
    </div>}
    {days.map((day) => <section key={day} className="calendar-day-group" aria-labelledby={`agenda-${day}`}>
      <h2 id={`agenda-${day}`} className={day === today ? "today" : undefined}>{dayHeading(day, today)}</h2>
      <ul>
        {(tasks.get(day) ?? []).map((task) => <li key={`task:${task.cardId}`}><TaskRow task={task} /></li>)}
        {(events.get(day) ?? []).map((occurrence) => <li key={`${occurrence.eventId}:${occurrence.date}`}>
          <OccurrenceRow occurrence={occurrence} day={day} zone={zone} onOpen={onOpen} />
        </li>)}
      </ul>
    </section>)}
    {data.truncated && <p className="calendar-note">Showing the first 1000 events. Hide some calendars to see the rest.</p>}
  </section>;
}

export function OccurrenceRow({ occurrence, day, zone, onOpen }: { occurrence: Occurrence; day: string; zone: string; onOpen: (occurrence: Occurrence) => void }) {
  return <button className="calendar-occurrence" onClick={() => onOpen(occurrence)}>
    <span className={`calendar-dot color-${occurrence.color}`} aria-hidden="true" />
    <span className="calendar-occurrence-time">{occurrenceTimeLabel(occurrence, zone, day)}</span>
    <span className="calendar-occurrence-copy">
      <strong>{occurrence.title}</strong>
      {occurrence.location && <small>{occurrence.location}</small>}
    </span>
    {occurrence.recurring && <Repeat className="calendar-occurrence-repeat" aria-label="Repeats" />}
  </button>;
}

/** A card due that day (D67). Read-only here: it is changed on its board. */
export function TaskRow({ task }: { task: DueTask }) {
  return <div className="calendar-occurrence calendar-task" role="group" aria-label={`Task due: ${task.title}`}>
    <CircleCheck className="calendar-task-icon" aria-hidden="true" />
    <span className="calendar-occurrence-time">Due</span>
    <span className="calendar-occurrence-copy">
      <strong>{task.title}</strong>
      <small>{task.boardName}</small>
    </span>
  </div>;
}
