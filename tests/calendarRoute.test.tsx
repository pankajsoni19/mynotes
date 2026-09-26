import { expect, test } from "bun:test";
import { TODAY_APPS } from "../src/today/todayApps";
import { createAppHistoryState, readAppHistorySection, withHistoryDepth } from "../src/appShellNavigation";
import { carriedCalendarState, createCalendarHistoryState, occurrenceFor, readCalendarHint, selectedDayFor } from "../src/calendarNavigation";
import { addDays, agendaRoute, calendarBackAction, calendarHomeRoute, eventRoute, monthGridDays, monthRoute, parentCalendarRoute, resolveMonth, shiftMonth } from "../src/calendarRoute";
import { formToInput, formFromEvent, newEventForm, occurrenceDays, repeatSummary, sameForm } from "../src/calendar/calendarFormat";
import type { EventDetail, Occurrence } from "../src/calendar/calendarApi";
import { formatRoute, parseRoute, type Route } from "../src/router";
import { guardDialogPop } from "../src/calendar/hooks";

const eventId = "a1b2c3d4-e5f6-4a7b-9c8d-0e1f2a3b4c5d";

test("Calendar routes parse and format back to the same URL", () => {
  const rows: Array<[string, Route]> = [
    ["/calendar", { app: "calendar", view: "agenda", month: null, eventId: null }],
    ["/calendar/month/2026-05", { app: "calendar", view: "month", month: "2026-05", eventId: null }],
    [`/calendar/event/${eventId}`, { app: "calendar", view: "agenda", month: null, eventId }]
  ];
  for (const [path, route] of rows) {
    expect(parseRoute(path)).toEqual(route);
    expect(formatRoute(route)).toBe(path);
  }
});

test("malformed Calendar URLs fall back instead of throwing", () => {
  expect(parseRoute("/calendar/")).toEqual(agendaRoute());
  expect(parseRoute("/calendar/month")).toEqual(monthRoute(null));
  expect(parseRoute("/calendar/month/../etc")).toEqual(agendaRoute());
  for (const month of ["2026-13", "2026-5", "1899-12", "2026-00", "..", "x"]) expect(parseRoute(`/calendar/month/${month}`)).toEqual(monthRoute(null));
  expect(parseRoute("/calendar/month/2026-05/extra")).toEqual(agendaRoute());
  expect(parseRoute("/calendar/event/not-a-uuid")).toEqual(agendaRoute());
  expect(parseRoute(`/calendar/event/${eventId}/edit`)).toEqual(agendaRoute());
  expect(parseRoute(`/calendar/event/${eventId.toUpperCase()}`)).toEqual(eventRoute(eventId));
  expect(parseRoute("/calendarx")).toEqual({ app: "home" });
  expect(formatRoute(monthRoute("bogus"))).toBe("/calendar/month");
  expect(formatRoute({ app: "calendar", view: "month", month: "2026-05", eventId: "bogus" })).toBe("/calendar/month/2026-05");
});

test("month helpers page, resolve, and lay out six Monday-first weeks", () => {
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2026-05", 14)).toBe("2027-07");
  expect(resolveMonth(null, "2026-09-25")).toBe("2026-09");
  expect(resolveMonth("2026-13", "2026-09-25")).toBe("2026-09");
  expect(resolveMonth("2027-02", "2026-09-25")).toBe("2027-02");
  const grid = monthGridDays("2026-09");
  expect(grid.length).toBe(42);
  // 2026-09-01 is a Tuesday, so the grid starts on Monday 2026-08-31.
  expect(grid[0]).toBe("2026-08-31");
  expect(grid[41]).toBe("2026-10-11");
  expect(monthGridDays("2026-06")[0]).toBe("2026-06-01");
  expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
});

test("in-app Back steps through history, else to the agenda, else Home", () => {
  expect(calendarBackAction(eventRoute(eventId), 2)).toEqual({ kind: "history" });
  expect(calendarBackAction(eventRoute(eventId), 0)).toEqual({ kind: "replace", route: agendaRoute() });
  expect(calendarBackAction(monthRoute("2026-05"), 0)).toEqual({ kind: "home" });
  expect(calendarBackAction(agendaRoute(), 0)).toEqual({ kind: "home" });
  expect(parentCalendarRoute(agendaRoute())).toBeNull();
  expect(calendarHomeRoute(true, "2026-09-25")).toEqual(agendaRoute());
  expect(calendarHomeRoute(false, "2026-09-25")).toEqual(monthRoute("2026-09"));
});

test("the month hint keeps the selected day per month and user, and survives other state", () => {
  const base = withHistoryDepth(createAppHistoryState("user-1", "calendar", null), 3);
  const state = createCalendarHistoryState("user-1", { month: "2026-05", day: "2026-05-14", eventId: null, occurrence: null }, base);
  expect(readAppHistorySection(state, "user-1")).toBe("calendar");
  expect((state as Record<string, unknown>)["mynotes.depth"]).toBe(3);
  expect(selectedDayFor(state, "user-1", "2026-05")).toBe("2026-05-14");
  expect(selectedDayFor(state, "user-1", "2026-06")).toBeNull();
  expect(selectedDayFor(state, "user-2", "2026-05")).toBeNull();
  // A day outside its month, or a malformed one, is dropped.
  expect(readCalendarHint(createCalendarHistoryState("user-1", { month: "2026-05", day: "2026-06-01", eventId: null, occurrence: null }, null), "user-1")?.day).toBeNull();
  expect(readCalendarHint({ "mynotes.calendar-navigation": { version: 1, userId: "user-1", hint: { month: "2026-99", day: "x" } } }, "user-1")).toEqual({ month: null, day: null, eventId: null, occurrence: null });
  expect(readCalendarHint({ "mynotes.calendar-navigation": { version: 2, userId: "user-1", hint: {} } }, "user-1")).toBeNull();
  expect(readCalendarHint(null, "user-1")).toBeNull();

  const eventState = createCalendarHistoryState("user-1", { month: null, day: null, eventId, occurrence: "2026-05-18" }, null);
  expect(occurrenceFor(eventState, "user-1", eventId)).toBe("2026-05-18");
  expect(occurrenceFor(eventState, "user-1", crypto.randomUUID())).toBeNull();
});

test("carried hints stay only on the same month or event", () => {
  const monthState = createCalendarHistoryState("user-1", { month: "2026-05", day: "2026-05-14", eventId: null, occurrence: null }, null);
  expect(readCalendarHint(carriedCalendarState("user-1", monthRoute("2026-05"), monthState), "user-1")?.day).toBe("2026-05-14");
  expect(carriedCalendarState("user-1", monthRoute("2026-06"), monthState)).toBeNull();
  expect(carriedCalendarState("user-1", agendaRoute(), monthState)).toBeNull();
  const eventState = createCalendarHistoryState("user-1", { month: null, day: null, eventId, occurrence: "2026-05-18" }, null);
  expect(readCalendarHint(carriedCalendarState("user-1", eventRoute(eventId), eventState), "user-1")?.occurrence).toBe("2026-05-18");
  expect(carriedCalendarState("user-1", eventRoute(crypto.randomUUID()), eventState)).toBeNull();
  expect(carriedCalendarState("user-2", eventRoute(eventId), eventState)).toBeNull();
});

test("the app shell accepts the Calendar section and Today launches it", () => {
  expect(readAppHistorySection(createAppHistoryState("user-1", "calendar", null), "user-1")).toBe("calendar");
  expect(readAppHistorySection(createAppHistoryState("user-1", "notifications", null), "user-1")).toBe("notifications");
  expect(TODAY_APPS.find((app) => app.section === "calendar")).toMatchObject({ label: "Calendar", href: "/calendar" });
});

test("event forms convert to API bodies and back", () => {
  const form = newEventForm("2026-05-04", "2026-05-01", new Date(2026, 4, 1, 15, 20), "Europe/Berlin");
  expect(form).toMatchObject({ startDate: "2026-05-04", startTime: "09:00", endDate: "2026-05-04", endTime: "10:00", tz: "Europe/Berlin" });
  expect(formToInput(form)).toEqual({ error: "Give the event a title" });
  expect(formToInput({ ...form, title: " Dentist " })).toEqual({ input: { title: "Dentist", location: "", description: "", repeat: null, allDay: false, startLocal: "2026-05-04T09:00", tz: "Europe/Berlin", durationMinutes: 60 } });
  expect(formToInput({ ...form, title: "Late", endDate: "2026-05-05", endTime: "01:30" })).toMatchObject({ input: { durationMinutes: 990 } });
  expect(formToInput({ ...form, title: "Backwards", endTime: "08:00" })).toEqual({ error: "The event ends before it starts" });
  expect(formToInput({ ...form, title: "Trip", allDay: true, endDate: "2026-05-06" })).toMatchObject({ input: { allDay: true, startDate: "2026-05-04", endDate: "2026-05-07" } });

  const detail = { title: "Trip", all_day: true, start_date: "2026-05-04", end_date: "2026-05-07", start_local: null, tz: null, duration_minutes: null, location: "", description: "", repeat: null } as unknown as EventDetail;
  const back = formFromEvent(detail, "UTC");
  expect(back).toMatchObject({ allDay: true, startDate: "2026-05-04", endDate: "2026-05-06" });
  expect(sameForm(back, { ...back })).toBe(true);
  expect(sameForm(back, { ...back, title: "Trip!" })).toBe(false);
});

test("occurrences cover the right local days and rules read naturally", () => {
  const timed = { allDay: false, start: "2026-05-04T22:30:00.000Z", end: "2026-05-05T00:30:00.000Z" } as Occurrence;
  expect(occurrenceDays(timed, "UTC", "2026-05-01", "2026-06-01")).toEqual(["2026-05-04", "2026-05-05"]);
  expect(occurrenceDays(timed, "Europe/Berlin", "2026-05-01", "2026-06-01")).toEqual(["2026-05-05"]);
  expect(occurrenceDays({ ...timed, end: "2026-05-05T00:00:00.000Z" } as Occurrence, "UTC", "2026-05-01", "2026-06-01")).toEqual(["2026-05-04"]);
  const trip = { allDay: true, start: "2026-04-29", end: "2026-05-03" } as Occurrence;
  expect(occurrenceDays(trip, "UTC", "2026-05-01", "2026-06-01")).toEqual(["2026-05-01", "2026-05-02"]);
  expect(repeatSummary(null, "2026-05-04")).toBe("Does not repeat");
  expect(repeatSummary({ freq: "weekly", interval: 1, byDay: ["MO", "WE"] }, "2026-05-04")).toBe("Every week on Mon, Wed");
  expect(repeatSummary({ freq: "daily", interval: 2, count: 5 }, "2026-05-04")).toBe("Every 2 days, 5 times");
  expect(repeatSummary({ freq: "monthly", interval: 1 }, "2026-01-31")).toBe("Every month on day 31");
});

test("a forced dialog pop closes everything, or restores the URL when the dialog is kept", () => {
  const state = (depth: number) => withHistoryDepth({}, depth);
  let restored = 0;
  const undone: string[] = [];
  const calls: boolean[] = [];
  const restore = () => { restored += 1; };
  const undo = (direction: "back" | "forward") => { undone.push(direction); };
  // Direction known: the top dialog closes and the move is undone.
  expect(guardDialogPop(3, state(2), (forced) => { calls.push(forced); }, restore, undo)).toBe(true);
  expect([calls, undone, restored]).toEqual([[false], ["back"], 0]);
  // Direction unknown and discarded: everything closes and the route handlers follow the browser.
  expect(guardDialogPop(3, state(3), (forced) => { calls.push(forced); }, restore, undo)).toBe(false);
  expect(restored).toBe(0);
  // Direction unknown and kept: the popstate is consumed and the dialog's URL restored.
  expect(guardDialogPop(3, state(3), () => "keep", restore, undo)).toBe(true);
  expect(restored).toBe(1);
  expect(undone).toEqual(["back"]);
});
