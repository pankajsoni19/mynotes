import { describe, expect, test } from "bun:test";
import { dueAt, isDueTime, isDueTimeZone, resolveDue } from "../server/tasks/dueTime";

/** Pure due-time rules (WAVE_13_TASK_CARD_UX.md D100, D101, T94). */

const empty = { due_on: null, due_time: null, due_tz: null };

describe("due time validation", () => {
  test("HH:MM from 00:00 to 23:59 only", () => {
    for (const value of ["00:00", "09:05", "17:30", "23:59"]) expect(isDueTime(value)).toBe(true);
    for (const value of ["24:00", "9:05", "09:5", "12:60", "12:00:00", "1200", "", " 12:00", "12:00 "]) expect(isDueTime(value)).toBe(false);
  });

  test("zones come from Intl, browser aliases included", () => {
    for (const zone of ["UTC", "Europe/Berlin", "America/New_York", "Pacific/Kiritimati", "Etc/GMT+12", "Asia/Calcutta"]) expect(isDueTimeZone(zone)).toBe(true);
    for (const zone of ["", "Mars/Olympus", "Europe/Berlin; DROP", "x".repeat(65), "../etc"]) expect(isDueTimeZone(zone)).toBe(false);
  });
});

describe("the due instant (dueAt)", () => {
  test("is null without a time", () => {
    expect(dueAt(empty)).toBeNull();
    expect(dueAt({ due_on: "2026-10-01", due_time: null, due_tz: null })).toBeNull();
  });

  test("UTC+14 and UTC−12 land on different UTC days", () => {
    expect(dueAt({ due_on: "2026-10-01", due_time: "23:30", due_tz: "Pacific/Kiritimati" })).toBe("2026-10-01T09:30:00.000Z");
    expect(dueAt({ due_on: "2026-10-01", due_time: "23:30", due_tz: "Etc/GMT+12" })).toBe("2026-10-02T11:30:00.000Z");
  });

  test("Berlin and New York across both DST changes", () => {
    // Berlin: CET (+1) before 2026-03-29 02:00, CEST (+2) after; back to CET on 2026-10-25 03:00.
    expect(dueAt({ due_on: "2026-03-28", due_time: "12:00", due_tz: "Europe/Berlin" })).toBe("2026-03-28T11:00:00.000Z");
    expect(dueAt({ due_on: "2026-03-29", due_time: "12:00", due_tz: "Europe/Berlin" })).toBe("2026-03-29T10:00:00.000Z");
    // A wall time inside the spring-forward gap moves forward by the gap.
    expect(dueAt({ due_on: "2026-03-29", due_time: "02:30", due_tz: "Europe/Berlin" })).toBe("2026-03-29T01:30:00.000Z");
    // A wall time in the autumn overlap takes the earlier instant.
    expect(dueAt({ due_on: "2026-10-25", due_time: "02:30", due_tz: "Europe/Berlin" })).toBe("2026-10-25T00:30:00.000Z");
    // New York: EST (−5) until 2026-03-08, EDT (−4) until 2026-11-01.
    expect(dueAt({ due_on: "2026-03-07", due_time: "17:00", due_tz: "America/New_York" })).toBe("2026-03-07T22:00:00.000Z");
    expect(dueAt({ due_on: "2026-03-08", due_time: "17:00", due_tz: "America/New_York" })).toBe("2026-03-08T21:00:00.000Z");
    expect(dueAt({ due_on: "2026-11-01", due_time: "17:00", due_tz: "America/New_York" })).toBe("2026-11-01T22:00:00.000Z");
  });
});

describe("resolveDue", () => {
  const timed = { due_on: "2026-10-01", due_time: "17:00", due_tz: "Europe/Berlin" };

  test("sets a time with a date and a zone", () => {
    expect(resolveDue(empty, { dueOn: "2026-10-01", dueTime: "17:00", dueTz: "Europe/Berlin" })).toEqual({ value: timed, timeChange: "set" });
    expect(resolveDue({ ...empty, due_on: "2026-10-01" }, { dueTime: "17:00", dueTz: "Europe/Berlin" })).toEqual({ value: timed, timeChange: "set" });
  });

  test("refuses a time without a zone or a date, and a zone without a time", () => {
    expect(resolveDue(empty, { dueOn: "2026-10-01", dueTime: "17:00" })).toHaveProperty("error");
    expect(resolveDue(empty, { dueTime: "17:00", dueTz: "UTC" })).toHaveProperty("error");
    expect(resolveDue(timed, { dueOn: null, dueTime: "17:00", dueTz: "UTC" })).toHaveProperty("error");
    expect(resolveDue(timed, { dueTz: "UTC" })).toHaveProperty("error");
    expect(resolveDue(timed, { dueTime: null, dueTz: "UTC" })).toHaveProperty("error");
  });

  test("moving the date keeps the wall time and zone; clearing the date clears the time", () => {
    expect(resolveDue(timed, { dueOn: "2026-10-05" })).toEqual({ value: { ...timed, due_on: "2026-10-05" }, timeChange: null });
    expect(resolveDue(timed, { dueOn: null })).toEqual({ value: empty, timeChange: "cleared" });
    expect(resolveDue(timed, { dueTime: null })).toEqual({ value: { ...timed, due_time: null, due_tz: null }, timeChange: "cleared" });
    expect(resolveDue(timed, { dueTime: null, dueTz: null })).toEqual({ value: { ...timed, due_time: null, due_tz: null }, timeChange: "cleared" });
    expect(resolveDue({ ...empty, due_on: "2026-10-01" }, { dueTime: null })).toEqual({ value: { ...empty, due_on: "2026-10-01" }, timeChange: null });
  });
});
