import { describe, expect, test } from "bun:test";
import { createUser, db, request, type Session } from "./support/harness";

const { runSweep } = await import("../server/sweeper");

type BinItem = { type: string; id: string; title: string; folder_id: string | null; folder_name: string | null; purging: boolean; can_purge: boolean };

async function json<T>(response: Response) {
  return (await response.json()) as T;
}

const send = (session: Session, method: string, path: string, body?: unknown) =>
  request(path, { method, body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body) }, session);

async function newCalendar(session: Session, name: string) {
  const response = await send(session, "POST", "/calendars", { name });
  expect(response.status).toBe(201);
  return (await json<{ calendar: { id: string } }>(response)).calendar.id;
}

async function newEvent(session: Session, calendarId: string, title: string) {
  const response = await send(session, "POST", `/calendars/${calendarId}/events`, { title, allDay: true, startDate: "2026-05-04", endDate: "2026-05-05" });
  expect(response.status).toBe(201);
  return (await json<{ event: { id: string } }>(response)).event.id;
}

async function share(owner: Session, calendarId: string, shareRole: "viewer" | "editor", users: Session[]) {
  expect((await send(owner, "PUT", `/calendars/${calendarId}/sharing`, { visibility: "selected", shareRole, userIds: users.map((user) => user.userId) })).status).toBe(200);
}

async function bin(session: Session, query = "") {
  const response = await request(`/bin${query}`, {}, session);
  expect(response.status).toBe(200);
  return (await json<{ items: BinItem[] }>(response)).items;
}

const restore = (session: Session, type: string, id: string) => send(session, "POST", `/bin/${type}/${id}/restore`);
const purge = (session: Session, type: string, id: string) => send(session, "DELETE", `/bin/${type}/${id}`);
const eventsOn = async (session: Session, calendarId: string) =>
  (await json<{ occurrences: Array<{ eventId: string }> }>(await request(`/events?from=2026-05-01&to=2026-05-10&calendars=${calendarId}`, {}, session))).occurrences.map((item) => item.eventId);
const row = (table: "calendars" | "events", id: string) => db.query(`SELECT deleted_at, purge_after, purge_started_at FROM ${table} WHERE id = ?`).get(id) as { deleted_at: string | null; purge_after: string | null; purge_started_at: string | null } | null;

describe("calendars and events in the Bin", () => {
  test("a binned calendar hides its events, is listed for its owner only, and restores with them", async () => {
    const owner = await createUser("Calendar bin owner");
    const member = await createUser("Calendar bin member");
    const calendarId = await newCalendar(owner, "Family");
    await share(owner, calendarId, "editor", [member]);
    const eventId = await newEvent(owner, calendarId, "Picnic");
    expect((await send(owner, "DELETE", `/calendars/${calendarId}`)).status).toBe(200);

    expect(await eventsOn(owner, calendarId)).toEqual([]);
    expect((await send(member, "GET", `/events/${eventId}`)).status).toBe(404);
    const items = await bin(owner);
    expect(items.find((item) => item.id === calendarId)).toMatchObject({ type: "calendar", title: "Family", folder_id: null, purging: false, can_purge: true });
    // Its events are not listed one by one; they come back with the calendar.
    expect(items.some((item) => item.id === eventId)).toBe(false);
    expect((await bin(member)).some((item) => item.id === calendarId)).toBe(false);
    expect((await bin(owner, "?type=calendar")).map((item) => item.id)).toContain(calendarId);
    expect((await bin(owner, "?type=event")).some((item) => item.id === calendarId)).toBe(false);
    expect((await request("/bin?type=calendars", {}, owner)).status).toBe(400);

    expect((await restore(member, "calendar", calendarId)).status).toBe(404);
    const restored = await restore(owner, "calendar", calendarId);
    expect(restored.status).toBe(200);
    expect(await json(restored)).toEqual({ ok: true, calendarId, calendarName: "Family" });
    expect(await json(await restore(owner, "calendar", calendarId))).toMatchObject({ ok: true, alreadyRestored: true });
    expect(await eventsOn(member, calendarId)).toEqual([eventId]);
    const audit = db.query("SELECT metadata_json FROM audit_log WHERE event_type = 'calendar.restore' AND actor_id = ?").get(owner.userId) as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json)).toEqual({ calendarId });
  });

  test("an event binned by an editor is listed for the owner and the deleter; either restores, only the owner purges", async () => {
    const owner = await createUser("Event bin owner");
    const editor = await createUser("Event bin editor");
    const viewer = await createUser("Event bin viewer");
    const calendarId = await newCalendar(owner, "Shared");
    await share(owner, calendarId, "editor", [editor]);
    const eventId = await newEvent(owner, calendarId, "Recital");
    expect((await send(editor, "DELETE", `/events/${eventId}`)).status).toBe(200);
    expect(row("events", eventId)?.deleted_at).not.toBeNull();

    expect((await bin(owner)).find((item) => item.id === eventId)).toMatchObject({ type: "event", title: "Recital", folder_id: calendarId, folder_name: "Shared", can_purge: true });
    expect((await bin(editor)).find((item) => item.id === eventId)).toMatchObject({ type: "event", can_purge: false });
    expect((await bin(viewer)).some((item) => item.id === eventId)).toBe(false);

    // The deleter may restore but never purge.
    expect((await purge(editor, "event", eventId)).status).toBe(404);
    expect((await restore(editor, "event", eventId)).status).toBe(200);
    expect(row("events", eventId)?.deleted_at).toBeNull();
    expect((await send(editor, "DELETE", `/events/${eventId}`)).status).toBe(200);

    // Losing edit access removes the item from the deleter's Bin and blocks their restore.
    await share(owner, calendarId, "viewer", [editor]);
    expect((await bin(editor)).some((item) => item.id === eventId)).toBe(false);
    expect((await restore(editor, "event", eventId)).status).toBe(404);
    expect((await restore(viewer, "event", eventId)).status).toBe(404);

    db.query("INSERT INTO event_links (event_id, target_type, target_id, linked_by, created_at) VALUES (?, 'card', ?, ?, ?)").run(eventId, crypto.randomUUID(), owner.userId, new Date().toISOString());
    expect((await purge(owner, "event", eventId)).status).toBe(200);
    expect(row("events", eventId)).toBeNull();
    expect((db.query("SELECT COUNT(*) AS count FROM event_links WHERE event_id = ?").get(eventId) as { count: number }).count).toBe(0);
    expect((await purge(owner, "event", eventId)).status).toBe(404);
    const audit = db.query("SELECT metadata_json FROM audit_log WHERE event_type = 'event.purge' AND actor_id = ?").get(owner.userId) as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json)).toEqual({ eventId, reason: "user" });
  });

  test("restoring an event whose calendar is in the Bin returns 409 PARENT_IN_BIN", async () => {
    const owner = await createUser("Parent bin owner");
    const editor = await createUser("Parent bin editor");
    const calendarId = await newCalendar(owner, "Trips");
    await share(owner, calendarId, "editor", [editor]);
    const eventId = await newEvent(owner, calendarId, "Lisbon");
    expect((await send(editor, "DELETE", `/events/${eventId}`)).status).toBe(200);
    expect((await send(owner, "DELETE", `/calendars/${calendarId}`)).status).toBe(200);

    for (const session of [owner, editor]) {
      const blocked = await restore(session, "event", eventId);
      expect(blocked.status).toBe(409);
      expect((await json<{ code: string }>(blocked)).code).toBe("PARENT_IN_BIN");
    }
    expect((await restore(owner, "calendar", calendarId)).status).toBe(200);
    // The calendar is back without the event that was binned on its own.
    expect(await eventsOn(owner, calendarId)).toEqual([]);
    expect((await restore(editor, "event", eventId)).status).toBe(200);
    expect(await eventsOn(owner, calendarId)).toEqual([eventId]);
    expect((await purge(owner, "event", eventId)).status).toBe(409);
  });

  test("a tombstoned item is unreadable and unrestorable, and the sweeper finishes it; retention purges cascade", async () => {
    const owner = await createUser("Sweep owner");
    const calendarId = await newCalendar(owner, "Old");
    const eventId = await newEvent(owner, calendarId, "Gone");
    const keptId = await newEvent(owner, calendarId, "Kept with calendar");
    expect((await send(owner, "DELETE", `/events/${eventId}`)).status).toBe(200);
    db.query("UPDATE events SET purge_started_at = ? WHERE id = ?").run(new Date().toISOString(), eventId);
    expect((await restore(owner, "event", eventId)).status).toBe(409);
    expect((await bin(owner)).find((item) => item.id === eventId)?.purging).toBe(true);
    await runSweep();
    expect(row("events", eventId)).toBeNull();

    expect((await send(owner, "DELETE", `/calendars/${calendarId}`)).status).toBe(200);
    // Not due yet: kept.
    await runSweep();
    expect(row("calendars", calendarId)).not.toBeNull();
    db.query("UPDATE calendars SET purge_after = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), calendarId);
    await runSweep();
    expect(row("calendars", calendarId)).toBeNull();
    expect(row("events", keptId)).toBeNull();
    const audit = db.query("SELECT metadata_json FROM audit_log WHERE event_type = 'calendar.purge' AND metadata_json LIKE ?").get(`%${calendarId}%`) as { metadata_json: string };
    expect(JSON.parse(audit.metadata_json)).toEqual({ calendarId, reason: "retention" });
  });

  test("Empty Bin purges the owner's calendars and events but not events the caller deleted elsewhere", async () => {
    const owner = await createUser("Empty owner");
    const editor = await createUser("Empty editor");
    const shared = await newCalendar(owner, "Shared empty");
    await share(owner, shared, "editor", [editor]);
    const theirs = await newEvent(owner, shared, "Owner's event");
    expect((await send(editor, "DELETE", `/events/${theirs}`)).status).toBe(200);
    const own = await newCalendar(editor, "Editor own");
    expect((await send(editor, "DELETE", `/calendars/${own}`)).status).toBe(200);

    const emptied = await send(editor, "DELETE", "/bin");
    expect(emptied.status).toBe(200);
    expect(await json(emptied)).toMatchObject({ ok: true, purged: 1 });
    expect(row("calendars", own)).toBeNull();
    expect(row("events", theirs)?.deleted_at).not.toBeNull();
    expect((await bin(editor)).map((item) => item.id)).toEqual([theirs]);
    expect((await send(owner, "DELETE", "/bin")).status).toBe(200);
    expect(row("events", theirs)).toBeNull();
  });

  test("restoring a calendar past the 20-calendar cap returns 409 LIMIT_REACHED", async () => {
    const owner = await createUser("Cap restore owner");
    const binned = await newCalendar(owner, "Binned first");
    expect((await send(owner, "DELETE", `/calendars/${binned}`)).status).toBe(200);
    for (let index = 0; index < 20; index += 1) await newCalendar(owner, `Live ${index}`);
    const blocked = await restore(owner, "calendar", binned);
    expect(blocked.status).toBe(409);
    expect((await json<{ code: string }>(blocked)).code).toBe("LIMIT_REACHED");
  });
});
