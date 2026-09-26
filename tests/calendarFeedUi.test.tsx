import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarSummary } from "../src/calendar/calendarApi";
import { CalendarsDialog } from "../src/calendar/CalendarsDialog";
import { EventSheet, RepeatSheet } from "../src/calendar/EventSheet";
import { newEventForm } from "../src/calendar/calendarFormat";
import { FEED_WARNING, FeedDialog } from "../src/calendar/FeedDialog";

const calendar = (overrides: Partial<CalendarSummary> = {}): CalendarSummary => ({
  id: "k1", owner_id: "u1", owner_name: "Ada", is_owner: 1, role: "owner", name: "Family", color: "green",
  visibility: "private", share_role: "viewer", created_at: "", updated_at: "", ...overrides
});

test("the Feed dialog warns that the link is readable by anyone and by cloud calendars", () => {
  expect(FEED_WARNING).toContain("Anyone with this link");
  expect(FEED_WARNING).toContain("tailnet");
  const markup = renderToStaticMarkup(<FeedDialog calendar={calendar()} onClose={() => undefined} flash={() => undefined} />);
  expect(markup).toContain("Subscribe to “Family”");
  expect(markup).toContain("Busy only");
  expect(markup).toContain("Full details");
  expect(markup).toContain("Create link");
});

test("every calendar, owned or shared, offers subscribe links", () => {
  const noop = () => undefined;
  const markup = renderToStaticMarkup(<CalendarsDialog calendars={[calendar(), calendar({ id: "k2", is_owner: 0, role: "viewer", name: "Club", owner_id: "u2", owner_name: "Bo" })]}
    hidden={new Set()} busy={false} onToggle={noop} onCreate={async () => undefined} onUpdate={async () => undefined} onShare={noop} onFeeds={noop} onDelete={noop}
    onClose={noop} showTasks={false} onToggleTasks={noop} />);
  expect(markup).toContain("Subscribe links for Family");
  expect(markup).toContain("Subscribe links for Club");
});

test("calendar pickers are custom dropdowns with colour swatches (D91)", () => {
  const noop = () => undefined;
  const dialog = renderToStaticMarkup(<CalendarsDialog calendars={[calendar()]} hidden={new Set()} busy={false} onToggle={noop} onCreate={async () => undefined}
    onUpdate={async () => undefined} onShare={noop} onFeeds={noop} onDelete={noop} onClose={noop} showTasks={false} onToggleTasks={noop} />);
  expect(dialog).not.toContain("<select");
  expect(dialog).toMatch(/class="ui-select ui-select-compact ui-select-swatch-only" role="combobox"[^>]*aria-label="Colour of Family"/);
  expect(dialog).toContain('<span class="ui-option-swatch color-green" aria-hidden="true"></span>');
  const shared = calendar({ id: "k2", is_owner: 0, role: "editor", name: "Club", owner_name: "Bo", color: "violet" });
  const form = newEventForm("2026-09-26", "2026-09-26", new Date("2026-09-26T09:00:00Z"), "Europe/Berlin");
  const sheet = renderToStaticMarkup(<EventSheet mode="create" form={form} calendars={[calendar(), shared]} calendarId="k1" busy={false} error={null} conflict={false}
    onChange={noop} onCalendarChange={noop} onRepeat={noop} onSave={noop} onReload={noop} onClose={noop} />);
  expect(sheet).not.toContain("<select");
  expect(sheet).toMatch(/role="combobox" aria-haspopup="listbox"[^>]*aria-labelledby="[^"]+"/);
  expect(sheet).toContain('<span class="ui-select-value">Family</span>');
  const repeat = renderToStaticMarkup(<RepeatSheet rule={null} startDate="2026-09-30" onDone={noop} onCancel={noop} />);
  expect(repeat).not.toContain("<select");
  expect(repeat).toContain('<span class="ui-select-value">Does not repeat</span>');
});
