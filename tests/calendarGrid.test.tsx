import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgendaView } from "../src/calendar/AgendaView";
import { MonthView } from "../src/calendar/MonthView";
import { AgendaList } from "../src/ui/calendarGrid/AgendaList";
import { MonthGrid } from "../src/ui/calendarGrid/MonthGrid";

// WAVE_13_TASK_CARD_UX.md §4.5a: the presentational month grid and agenda list shared by Calendar
// and the board calendar view. Calendar's own views keep their markup (checked in the browser by a
// DOM diff of month, phone month, and agenda before and after the refactor; see TEST_PLAN.md).
const noop = () => undefined;
const grid = (props: Partial<Parameters<typeof MonthGrid>[0]> = {}) => renderToStaticMarkup(<MonthGrid month="2026-10" today="2026-10-07" selectedDay="2026-10-07" compact={false}
  countFor={(day) => day === "2026-10-09" ? 2 : 0} renderDay={(day) => day === "2026-10-09" ? <b className="chip">Ship &lt;it&gt;</b> : null} renderDots={() => <i className="dot" />}
  onSelectDay={noop} onShiftMonth={noop} onToday={noop} {...props} />);

test("MonthGrid renders six Monday-first weeks with the caller's items and accessible day names", () => {
  const markup = grid();
  expect(markup).toContain('<section class="calendar-month" aria-labelledby="calendar-month-title">');
  expect(markup).toContain('aria-label="Previous month"');
  expect(markup).toContain('aria-label="Next month"');
  expect(markup.match(/role="gridcell"/g)).toHaveLength(42);
  expect(markup).toContain('<span role="columnheader">Mon</span>');
  // 2026-10 starts on a Thursday: the grid opens on Monday 28 September.
  expect(markup.indexOf("calendar-cell outside")).toBeGreaterThan(-1);
  expect(markup).toContain('class="calendar-cell today selected" aria-selected="true"');
  expect(markup).toMatch(/aria-label="[^"]+, 2 items">9<\/button><div class="calendar-cell-chips"><b class="chip">Ship &lt;it&gt;<\/b>/);
  // Today's month shows no Today button; another month does.
  expect(markup).not.toContain("calendar-today-button");
  expect(grid({ today: "2026-11-02" })).toContain(">Today</button>");
});

test("MonthGrid compact cells are buttons with dots, a status replaces the grid, and drops are opt-in", () => {
  const compact = grid({ compact: true, titleId: "board-month" });
  expect(compact).toContain('<section class="calendar-month compact" aria-labelledby="board-month">');
  expect(compact).toContain('<span class="calendar-cell-dots" aria-hidden="true"><i class="dot"></i></span>');
  expect(compact).toContain('<span role="columnheader">M</span>');
  const failed = grid({ status: <p role="alert">Could not load</p>, children: <p>After</p> });
  expect(failed).not.toContain('role="grid"');
  expect(failed).toContain('<p role="alert">Could not load</p><p>After</p>');
  expect(grid()).not.toContain("data-day=");
  expect(grid({ drop: { accepts: () => true, type: "x", onDropOnDay: noop } })).toContain('data-day="2026-10-09"');
  expect(grid({ busy: true })).toContain('class="calendar-grid loading" role="grid" aria-label="October 2026" aria-busy="true"');
});

test("AgendaList renders one section per day with the caller's rows, or its empty state", () => {
  const markup = renderToStaticMarkup(<AgendaList days={[{ day: "2026-10-07", items: ["a", "b"] }, { day: "2026-10-08", items: ["c"] }]} today="2026-10-07" label="Due"
    itemKey={(item) => item} renderItem={(item, day) => <span>{item}@{day}</span>} idPrefix="board-agenda-"><p>note</p></AgendaList>);
  expect(markup).toContain('<section class="calendar-agenda" aria-label="Due">');
  expect(markup).toContain('<section class="calendar-day-group" aria-labelledby="board-agenda-2026-10-07"><h2 id="board-agenda-2026-10-07" class="today">Today</h2><ul><li><span>a@2026-10-07</span></li><li><span>b@2026-10-07</span></li></ul>');
  expect(markup).toContain('<h2 id="board-agenda-2026-10-08">Tomorrow</h2>');
  expect(markup).toContain("<p>note</p></section>");
  const empty = renderToStaticMarkup(<AgendaList days={[]} today="2026-10-07" label="Due" itemKey={(item: string) => item} renderItem={(item) => item} empty={<p>Nothing</p>} />);
  expect(empty).toBe('<section class="calendar-agenda" aria-label="Due"><p>Nothing</p></section>');
});

test("Calendar's MonthView and AgendaView still render their own shells on the shared pieces", () => {
  const month = renderToStaticMarkup(<MonthView month="2026-10" today="2026-10-07" compact={false} selectedDay={null} calendarIds={null} showTasks reloadKey={0} canCreate
    onSelectDay={noop} onOpen={noop} onCreate={noop} onShiftMonth={noop} onToday={noop} />);
  expect(month).toContain('<section class="calendar-month" aria-labelledby="calendar-month-title">');
  expect(month).toContain('<h2 id="calendar-month-title" aria-live="polite">October 2026</h2>');
  expect(month).toContain('class="calendar-grid loading" role="grid" aria-label="October 2026" aria-busy="true"');
  expect(month).toContain('<section class="calendar-day-list" aria-labelledby="calendar-day-title"><header><h3 id="calendar-day-title">Today</h3>');
  expect(month).toContain(">Add event</button>");
  // The agenda shows its loading state until the occurrences arrive.
  expect(renderToStaticMarkup(<AgendaView today="2026-10-07" calendarIds={null} showTasks reloadKey={0} onOpen={noop} />)).toBe('<p class="calendar-loading" role="status">Loading your agenda…</p>');
});
