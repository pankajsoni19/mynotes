import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarSummary } from "../src/calendar/calendarApi";
import { CalendarsDialog } from "../src/calendar/CalendarsDialog";
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
