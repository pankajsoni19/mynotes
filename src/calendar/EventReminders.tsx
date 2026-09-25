import { useEffect, useState } from "react";
import { Bell, Check, Plus, X } from "lucide-react";
import { api } from "../api";
import { ModalDialog } from "../files/Dialog";

export type ReminderSummary = { id: string; eventId: string | null; offsetMinutes: number | null; title: string | null; tz: string; nextFireAt: string | null; lastFiredAt: string | null; createdAt: string };

export const listEventReminders = (eventId: string) => api<{ reminders: ReminderSummary[] }>(`/reminders?eventId=${encodeURIComponent(eventId)}`);
export const addEventReminder = (eventId: string, offsetMinutes: number, tz: string) =>
  api<{ reminder: ReminderSummary }>("/reminders", { method: "POST", body: JSON.stringify({ eventId, offsetMinutes, tz }) });
export const removeReminder = (id: string) => api<{ ok: true }>(`/reminders/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });

/** Choices offered in the picker. All-day events start at local midnight, so "9:00 on the day" is -540. */
export const TIMED_OFFSETS = [0, 5, 10, 15, 30, 60, 120, 1440, 10_080];
export const ALL_DAY_OFFSETS = [-540, 900, 2340, 9540];

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** How a reminder reads: "15 minutes before", "At the start", "9:00 the day before". */
export function reminderLabel(offsetMinutes: number, allDay: boolean) {
  if (allDay) {
    // Fire time relative to the day's midnight, as a wall time on some day.
    const minutesIntoDay = ((-offsetMinutes % 1440) + 1440) % 1440;
    const daysBefore = Math.ceil(offsetMinutes / 1440);
    const time = `${Math.floor(minutesIntoDay / 60)}:${String(minutesIntoDay % 60).padStart(2, "0")}`;
    if (daysBefore <= 0) return `${time} on the day`;
    if (daysBefore === 1) return `${time} the day before`;
    if (daysBefore === 7) return `${time} a week before`;
    return `${time}, ${plural(daysBefore, "day")} before`;
  }
  if (offsetMinutes === 0) return "At the start";
  const after = offsetMinutes < 0;
  const minutes = Math.abs(offsetMinutes);
  const amount = minutes % 10_080 === 0 ? plural(minutes / 10_080, "week")
    : minutes % 1440 === 0 ? plural(minutes / 1440, "day")
    : minutes % 60 === 0 ? plural(minutes / 60, "hour")
    : plural(minutes, "minute");
  return `${amount} ${after ? "after the start" : "before"}`;
}

type EventRemindersProps = { eventId: string; allDay: boolean; reloadKey: number; onAdd: (existing: number[]) => void; onRemove: (reminder: ReminderSummary) => void };

/** The event page's "My reminders": private to the viewer, whatever their role on the calendar. */
export function EventReminders({ eventId, allDay, reloadKey, onAdd, onRemove }: EventRemindersProps) {
  const [reminders, setReminders] = useState<ReminderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setError(null);
    listEventReminders(eventId).then((result) => { if (active) setReminders(result.reminders); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load your reminders"); });
    return () => { active = false; };
  }, [eventId, reloadKey]);

  const existing = (reminders ?? []).map((reminder) => reminder.offsetMinutes ?? 0);
  return <section className="calendar-event-section" aria-labelledby="calendar-reminders-title">
    <h2 id="calendar-reminders-title"><Bell />My reminders</h2>
    {error && <p className="file-dialog-error" role="alert">{error}</p>}
    {reminders && !reminders.length && <p className="calendar-note">Only you see your reminders. They appear under the bell when they are due.</p>}
    {reminders && reminders.length > 0 && <ul className="calendar-links">
      {reminders.map((reminder) => {
        const label = reminderLabel(reminder.offsetMinutes ?? 0, allDay);
        return <li key={reminder.id}>
          <span className="calendar-link"><Bell aria-hidden="true" /><span><strong>{label}</strong><small>{reminder.nextFireAt ? `Next ${new Date(reminder.nextFireAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "No upcoming time"}</small></span></span>
          <button className="icon-button" onClick={() => onRemove(reminder)} aria-label={`Remove reminder ${label}`}><X /></button>
        </li>;
      })}
    </ul>}
    {reminders && reminders.length < 10 && <button className="secondary-button calendar-link-add" onClick={() => onAdd(existing)}><Plus />Add reminder</button>}
  </section>;
}

type ReminderPickerProps = { allDay: boolean; existing: number[]; onPick: (offsetMinutes: number) => Promise<void>; onClose: () => void };

/** The reminder picker sheet. Pushes no history entry; Back closes it (D69). */
export function ReminderPicker({ allDay, existing, onPick, onClose }: ReminderPickerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = allDay ? ALL_DAY_OFFSETS : TIMED_OFFSETS;

  async function pick(offset: number) {
    setBusy(true);
    setError(null);
    try {
      await onPick(offset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the reminder");
      setBusy(false);
    }
  }

  return <ModalDialog title="Remind me" eyebrow="Event" onClose={onClose} variant="sheet" busy={busy}>
    <div className="move-list" role="list" aria-label="When">
      {options.map((offset, index) => {
        const taken = existing.includes(offset);
        return <button key={offset} role="listitem" className="move-option" disabled={taken || busy} autoFocus={index === options.findIndex((item) => !existing.includes(item))} onClick={() => { void pick(offset); }}>
          <Bell aria-hidden="true" />
          <span>{reminderLabel(offset, allDay)}{taken && <small>Already set</small>}</span>
          {taken && <Check aria-hidden="true" />}
        </button>;
      })}
    </div>
    {error && <p className="file-dialog-error" role="alert">{error}</p>}
  </ModalDialog>;
}
