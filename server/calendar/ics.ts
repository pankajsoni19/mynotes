import { zonedToUtc, type RecurrenceRule } from "./recurrence";

/**
 * iCalendar (RFC 5545) output for read-only feeds (docs/plan/WAVES_10-12.md §4.3, D66, T65).
 * Pure: the feed route passes plain rows in and gets the text back.
 *
 * - Every TEXT value is escaped (`\` `;` `,` and line breaks), and CR, LF, and every other
 *   control character are neutralised, so a stored value can never start a new property line.
 * - Lines are folded at 75 octets without splitting a UTF-8 sequence, and end in CRLF.
 * - Timed events carry `TZID=` local times and a DURATION; all-day events carry `VALUE=DATE`.
 *   There are no VTIMEZONE blocks (§7): clients resolve IANA names themselves.
 */

export const MAX_FEED_EVENTS = 5000;
export const ICS_LINE_OCTETS = 75;

export type FeedDetail = "busy" | "full";

export type IcsEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  all_day: 0 | 1;
  start_date: string | null;
  end_date: string | null;
  start_local: string | null;
  tz: string | null;
  duration_minutes: number | null;
  rrule_json: string | null;
  exdates_json: string;
  created_at: string;
  updated_at: string;
};

/** Escapes a TEXT value (RFC 5545 §3.3.11). Any line break becomes the two characters `\n`. */
export function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n|\u2028|\u2029/g, "\\n")
    // Tabs are allowed in TEXT; every other control character is dropped.
    .replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, "");
}

/** Folds one content line at 75 octets (§3.1); continuation lines start with a space, which counts. */
export function foldLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).byteLength;
    const limit = parts.length === 0 ? ICS_LINE_OCTETS : ICS_LINE_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (date: string) => date.replace(/-/g, "");
const compactLocal = (local: string) => `${local.replace(/[-:]/g, "")}00`;
const compactUtc = (iso: string) => `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;
// TZID values are IANA names checked on write; anything else is never emitted as a parameter.
const safeTzid = (tz: string) => /^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz) ? tz : "UTC";

function rruleLine(rule: RecurrenceRule, event: IcsEvent) {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`, `INTERVAL=${rule.interval}`];
  if (rule.freq === "weekly") {
    parts.push("WKST=MO");
    if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  }
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) {
    if (event.all_day === 1) parts.push(`UNTIL=${compactDate(rule.until)}`);
    // With a TZID start, UNTIL must be UTC: the last minute of the until day in the event's zone.
    else parts.push(`UNTIL=${compactUtc(new Date(zonedToUtc(`${rule.until}T23:59`, event.tz!) + 59_000).toISOString())}`);
  }
  return `RRULE:${parts.join(";")}`;
}

/** The VEVENT lines for one event. `busy` sends only the time and "Busy". */
export function eventLines(event: IcsEvent, detail: FeedDetail) {
  const lines = ["BEGIN:VEVENT", `UID:${event.id}@nook`, `DTSTAMP:${compactUtc(event.updated_at)}`];
  if (event.all_day === 1) {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.start_date!)}`, `DTEND;VALUE=DATE:${compactDate(event.end_date!)}`);
  } else {
    const tzid = safeTzid(event.tz!);
    lines.push(`DTSTART;TZID=${tzid}:${compactLocal(event.start_local!)}`, `DURATION:PT${event.duration_minutes}M`);
  }
  const rule = event.rrule_json ? JSON.parse(event.rrule_json) as RecurrenceRule : null;
  if (rule) {
    lines.push(rruleLine(rule, event));
    const exdates = JSON.parse(event.exdates_json) as string[];
    if (exdates.length) {
      if (event.all_day === 1) lines.push(`EXDATE;VALUE=DATE:${exdates.map(compactDate).join(",")}`);
      else {
        const time = event.start_local!.slice(10);
        lines.push(`EXDATE;TZID=${safeTzid(event.tz!)}:${exdates.map((date) => compactLocal(`${date}${time}`)).join(",")}`);
      }
    }
  }
  if (detail === "busy") {
    lines.push("SUMMARY:Busy", "CLASS:PRIVATE");
  } else {
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push(`CREATED:${compactUtc(event.created_at)}`, `LAST-MODIFIED:${compactUtc(event.updated_at)}`);
  }
  lines.push("TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}

/** A whole VCALENDAR, folded, CRLF line endings, at most MAX_FEED_EVENTS events. */
export function buildCalendar(name: string, events: readonly IcsEvent[], detail: FeedDetail) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nook//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    // A busy feed does not name the calendar either.
    `X-WR-CALNAME:${escapeText(detail === "busy" ? "Busy" : name)}`
  ];
  for (const event of events.slice(0, MAX_FEED_EVENTS)) lines.push(...eventLines(event, detail));
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
