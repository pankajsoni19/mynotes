import { describe, expect, test } from "bun:test";
import { addSprintDays, nextSprintDates, nextSprintName, sprintDaysBetween } from "../shared/sprintPlan";

describe("sprint naming and dates (shared/sprintPlan.ts)", () => {
  test("the next name increments a trailing number, else adds 2", () => {
    expect(nextSprintName("Sprint 12")).toBe("Sprint 13");
    expect(nextSprintName("Sprint 9")).toBe("Sprint 10");
    expect(nextSprintName("S1")).toBe("S2");
    expect(nextSprintName("Hardening")).toBe("Hardening 2");
    expect(nextSprintName("  ")).toBe("Sprint 1");
    expect(nextSprintName(null)).toBe("Sprint 1");
    expect(nextSprintName(`${"x".repeat(58)} 9`).length).toBeLessThanOrEqual(60);
    expect(nextSprintName("x".repeat(60)).length).toBe(60);
  });

  test("the next sprint starts the day after and lasts as long; without an end, two weeks from today", () => {
    expect(nextSprintDates({ start_on: "2026-09-21", end_on: "2026-10-04" }, "2026-01-01")).toEqual({ startOn: "2026-10-05", endOn: "2026-10-18" });
    expect(nextSprintDates({ start_on: "2026-12-28", end_on: "2027-01-03" }, "2026-01-01")).toEqual({ startOn: "2027-01-04", endOn: "2027-01-10" });
    expect(nextSprintDates({ start_on: null, end_on: "2026-10-04" }, "2026-01-01")).toEqual({ startOn: "2026-10-05", endOn: "2026-10-18" });
    expect(nextSprintDates({ start_on: null, end_on: null }, "2026-02-20")).toEqual({ startOn: "2026-02-20", endOn: "2026-03-05" });
    expect(nextSprintDates(null, "2026-02-20")).toEqual({ startOn: "2026-02-20", endOn: "2026-03-05" });
    expect(addSprintDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(sprintDaysBetween("2026-03-28", "2026-04-02")).toBe(5);
  });
});
