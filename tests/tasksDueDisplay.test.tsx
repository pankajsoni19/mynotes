import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskRow } from "../src/calendar/AgendaView";
import { viewerTimeZone, type DueTask } from "../src/calendar/calendarApi";
import { tasksByDay, taskTimeLabel, zonedParts } from "../src/calendar/calendarFormat";
import { TODAY_SECTIONS } from "../src/today/todaySections";

const base = { boardId: "b1", boardName: "Launch", title: "Ship it" };

test("the overlay places cards on the server's viewer-local day, falling back to dueOn", () => {
  const tasks: DueTask[] = [
    // Due 2026-03-06 23:30 at UTC+14; the server placed it on the 5th for a UTC−12 viewer.
    { ...base, cardId: "k1", dueOn: "2026-03-06", dueTime: "23:30", dueTz: "Pacific/Kiritimati", dueAt: "2026-03-06T09:30:00.000Z", date: "2026-03-05" },
    { ...base, cardId: "k2", dueOn: "2026-03-06", dueTime: null, dueTz: null, dueAt: null, date: "2026-03-06" },
    { ...base, cardId: "k3", dueOn: "2026-03-06" }
  ];
  const days = tasksByDay(tasks);
  expect(days.get("2026-03-05")?.map((task) => task.cardId)).toEqual(["k1"]);
  expect(days.get("2026-03-06")?.map((task) => task.cardId)).toEqual(["k2", "k3"]);
  expect(taskTimeLabel(tasks[0]!, "Etc/GMT+12")).toBe("21:30");
  expect(taskTimeLabel(tasks[0]!, "Pacific/Kiritimati")).toBe("23:30");
  expect(taskTimeLabel(tasks[1]!, "UTC")).toBe("Due");
});

test("a timed overlay row shows its local time, a date-only row says Due", () => {
  const timed = renderToStaticMarkup(<TaskRow task={{ ...base, cardId: "k1", dueOn: "2026-03-06", dueTime: "09:30", dueTz: "UTC", dueAt: "2026-03-06T09:30:00.000Z", date: "2026-03-06" }} />);
  const local = zonedParts("2026-03-06T09:30:00.000Z", viewerTimeZone()).time;
  expect(timed).toContain(`aria-label="Task due at ${local}: Ship it"`);
  expect(timed).toContain(`<span class="calendar-occurrence-time">${local}</span>`);
  const dateOnly = renderToStaticMarkup(<TaskRow task={{ ...base, cardId: "k2", dueOn: "2026-03-06" }} />);
  expect(dateOnly).toContain('aria-label="Task due: Ship it"');
  expect(dateOnly).toContain('<span class="calendar-occurrence-time">Due</span>');
});

test("Today task rows show the time of a timed card and keep date-only copy", () => {
  const row = TODAY_SECTIONS.tasksDue!.row!;
  const dueAt = "2999-01-01T09:30:00.000Z";
  const local = zonedParts(dueAt, viewerTimeZone());
  const timed = row({ ...base, cardId: "k1", dueOn: "2999-01-01", dueTime: "09:30", dueTz: "UTC", dueAt, reason: "assigned" }, local.date);
  expect(timed.meta).toBe(`Launch · Due today at ${local.time} · Assigned to you`);
  expect(timed.tone).toBe("today");
  const dateOnly = row({ ...base, cardId: "k2", dueOn: "2999-01-01", dueTime: null, dueTz: null, dueAt: null }, "2999-01-01");
  expect(dateOnly.meta).toBe("Launch · Due today");
  const past = row({ ...base, cardId: "k3", dueOn: "2020-01-01", dueTime: "08:00", dueTz: "UTC", dueAt: "2020-01-01T08:00:00.000Z" }, "2020-01-01");
  expect(past.tone).toBe("overdue");
});
