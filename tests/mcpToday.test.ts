import { beforeEach, describe, expect, test } from "bun:test";
import { createUser, db, origin, request, type Session } from "./support/harness";

const { createMcpApiKey } = await import("../server/mcp");
const { invokeMcpToolForTests } = await import("../server/mcpTools");
const { resetMcpLimits } = await import("../server/mcpRateLimit");
type McpScope = import("../server/mcpScopes").McpScope;

beforeEach(() => resetMcpLimits());

async function rpc(token: string, method: string, params: unknown = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  const json = text.trimStart().startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
  return JSON.parse(json) as { result?: { tools?: Array<{ name: string }>; isError?: boolean; content?: Array<{ text: string }> } };
}

async function getToday(session: Session, scopes: McpScope[], args: Record<string, unknown> = {}) {
  const key = createMcpApiKey(session.userId, "Today agent", scopes);
  const body = await rpc(key.token, "tools/call", { name: "get_today", arguments: args });
  return { isError: body.result?.isError === true, value: JSON.parse(body.result!.content![0]!.text) as Record<string, any>, key };
}

describe("get_today MCP tool", () => {
  test("is offered only with today:read", async () => {
    const user = await createUser("MCP today tools");
    const without = createMcpApiKey(user.userId, "No today", ["notes:read", "files:read", "tasks:write"]);
    expect(((await rpc(without.token, "tools/list")).result!.tools!).map((tool) => tool.name)).not.toContain("get_today");
    const withToday = createMcpApiKey(user.userId, "Today", ["today:read"]);
    expect(((await rpc(withToday.token, "tools/list")).result!.tools!).map((tool) => tool.name)).toContain("get_today");
    // The handler re-checks the scope even when called directly (T72).
    const direct = await invokeMcpToolForTests("get_today", {}, without.id);
    expect(direct.isError).toBe(true);
    expect(JSON.parse(direct.content[0]!.text).code).toBe("SCOPE_REQUIRED");
  });

  test("returns only the sections whose module scope the key also holds (T74)", async () => {
    const user = await createUser("MCP today scopes");
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, user);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;
    await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ markdown: "# Agent visible title\n\nsecret body text", revision: 1 }) }, user);

    const alone = await getToday(user, ["today:read"]);
    expect(alone.isError).toBe(false);
    expect(Object.keys(alone.value.sections)).toEqual(["binSoon", "storage"]);
    expect(JSON.stringify(alone.value)).not.toContain("Agent visible title");

    const notes = await getToday(user, ["today:read", "notes:read"]);
    expect(Object.keys(notes.value.sections)).toEqual(["notesRecent", "drafts", "agentDrafts", "binSoon", "storage"]);
    expect(notes.value.sections.drafts.items).toEqual([expect.objectContaining({ id: noteId, title: "Agent visible title" })]);
    // Titles only: never a body.
    expect(JSON.stringify(notes.value)).not.toContain("secret body text");

    expect(Object.keys((await getToday(user, ["today:read", "files:read"])).value.sections)).toEqual(["files", "binSoon", "storage"]);
    // A write scope implies its read scope.
    expect(Object.keys((await getToday(user, ["today:read", "tasks:write"])).value.sections)).toEqual(["tasksDue", "tasksMine", "binSoon", "storage"]);
    const all = await getToday(user, ["today:read", "notes:read", "files:read", "tasks:read"]);
    expect(Object.keys(all.value.sections)).toEqual(["tasksDue", "tasksMine", "notesRecent", "drafts", "agentDrafts", "files", "binSoon", "storage"]);
  });

  test("validates tz, defaults to UTC, and is not audited", async () => {
    const user = await createUser("MCP today tz");
    const utc = await getToday(user, ["today:read"]);
    expect(utc.value.date).toBe(new Date(utc.value.generatedAt).toISOString().slice(0, 10));
    const bad = await getToday(user, ["today:read"], { tz: "Mars/Olympus" });
    expect(bad.isError).toBe(true);
    expect(bad.value.code).toBe("INVALID");
    expect((await getToday(user, ["today:read"], { tz: "Pacific/Kiritimati" })).isError).toBe(false);
    const audits = db.query("SELECT COUNT(*) AS count FROM audit_log WHERE actor_id = ? AND event_type NOT LIKE 'mcp.key%'").get(user.userId) as { count: number };
    expect(audits.count).toBe(0);
  });
});
