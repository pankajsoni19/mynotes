import { beforeEach, describe, expect, test } from "bun:test";
import { createUser, db, origin, request, type Session } from "./support/harness";

const { createMcpApiKey } = await import("../server/mcp");
const { invokeMcpToolForTests } = await import("../server/mcpTools");
const { resetMcpLimits, consumeMcpLimits, MCP_LIMITS } = await import("../server/mcpRateLimit");
type McpScope = import("../server/mcpScopes").McpScope;

beforeEach(() => resetMcpLimits());

type Key = { id: string; token: string };

/** A key with exactly `scopes` stored, as the keys API would store them. */
function makeKey(session: Session, scopes: McpScope[], name = "Agent") {
  const key = createMcpApiKey(session.userId, name);
  db.query("UPDATE mcp_api_keys SET scopes = ? WHERE id = ?").run(JSON.stringify(scopes), key.id);
  return { id: key.id, token: key.token } satisfies Key;
}

let rpcId = 0;
/** One JSON-RPC call over Streamable HTTP. Handles JSON and SSE responses. */
async function rpc(key: Key, method: string, params: unknown = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params })
  });
  const text = await response.text();
  if (response.status !== 200) return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
  const json = text.trimStart().startsWith("{")
    ? text
    : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
  return { status: response.status, body: JSON.parse(json) as { result?: Record<string, unknown>; error?: { code: number; message: string } } };
}

async function toolNames(key: Key) {
  const { body } = await rpc(key, "tools/list");
  return ((body as { result: { tools: Array<{ name: string }> } }).result.tools).map((tool) => tool.name).sort();
}

type ToolOutcome = { isError: boolean; value: Record<string, unknown> };

/** Calls a tool and parses its JSON text content. A JSON-RPC error counts as an error outcome. */
async function callTool(key: Key, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const { status, body } = await rpc(key, "tools/call", { name, arguments: args });
  expect(status).toBe(200);
  const envelope = body as { result?: { isError?: boolean; content: Array<{ text: string }> }; error?: { message: string } };
  if (envelope.error) return { isError: true, value: { error: envelope.error.message } };
  const text = envelope.result!.content[0]!.text;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    value = { error: text };
  }
  return { isError: envelope.result!.isError === true, value };
}

async function json<T>(response: Response) {
  return await response.json() as T;
}

async function publishedNote(session: Session, markdown: string, folderId: string | null = null) {
  const { note } = await json<{ note: { id: string } }>(await request("/notes", { method: "POST", body: JSON.stringify({ folderId }) }, session));
  expect((await request(`/notes/${note.id}/draft`, { method: "PUT", body: JSON.stringify({ markdown, revision: 1 }) }, session)).status).toBe(200);
  expect((await request(`/notes/${note.id}/publish`, { method: "POST", body: "{}" }, session)).status).toBe(200);
  return note.id;
}

const NOTES_READ_TOOLS = ["list_folders", "list_notes", "read_note", "search_notes"];

describe("MCP scopes", () => {
  test("a key created through the API defaults to notes:read and sees only the read tools", async () => {
    const owner = await createUser("Scope default");
    const created = await request("/mcp/keys", { method: "POST", body: JSON.stringify({ name: "Default", password: owner.password }) }, owner);
    expect(created.status).toBe(201);
    const { key } = await json<{ key: Key }>(created);
    expect((db.query("SELECT scopes FROM mcp_api_keys WHERE id = ?").get(key.id) as { scopes: string }).scopes).toBe('["notes:read"]');
    expect(await toolNames(key)).toEqual(NOTES_READ_TOOLS);
  });

  test("tools are registered only for the key's scopes, and handlers re-check the scope", async () => {
    const owner = await createUser("Scope matrix");
    const filesOnly = makeKey(owner, ["files:read"]);
    const names = await toolNames(filesOnly);
    expect(names).toContain("list_folders");
    for (const tool of ["list_notes", "read_note", "search_notes", "create_note", "update_note_draft", "get_note_draft"]) expect(names).not.toContain(tool);

    // An unregistered tool cannot be called over the transport.
    const hidden = await callTool(filesOnly, "list_notes");
    expect(hidden.isError).toBe(true);
    expect(JSON.stringify(hidden.value)).not.toContain("\"notes\"");

    // The handler checks again even when the tool is reached directly.
    const direct = await invokeMcpToolForTests("list_notes", {}, filesOnly.id);
    expect(direct.isError).toBe(true);
    expect(JSON.parse(direct.content[0]!.text)).toMatchObject({ code: "SCOPE_REQUIRED" });

    const notesKey = makeKey(owner, ["notes:read"]);
    expect((await invokeMcpToolForTests("list_notes", {}, notesKey.id)).isError).toBeUndefined();
  });

  test("a revoked key is refused by the transport and by the handler re-check", async () => {
    const owner = await createUser("Scope revoked");
    const key = makeKey(owner, ["notes:read"]);
    expect((await rpc(key, "tools/list")).status).toBe(200);
    expect((await request(`/mcp/keys/${key.id}`, { method: "DELETE", body: "{}" }, owner)).status).toBe(200);
    expect((await rpc(key, "tools/list")).status).toBe(401);
    const direct = await invokeMcpToolForTests("list_notes", {}, key.id);
    expect(JSON.parse(direct.content[0]!.text)).toMatchObject({ code: "SCOPE_REQUIRED" });
  });
});

describe("MCP search_notes and list_folders", () => {
  test("search finds published text the user can read, never drafts, with plain-text snippets", async () => {
    const owner = await createUser("Search owner");
    const reader = await createUser("Search reader");
    const stranger = await createUser("Search stranger");
    const noteId = await publishedNote(owner, "# Quokka field notes\n\nThe quokka smiles near the ferry.");
    // A newer draft that must never be searched or titled from.
    expect((await request(`/notes/${noteId}/draft`, { method: "PUT", body: JSON.stringify({ markdown: "# Secret wombat title\n\nquokka wombatdraft", revision: null }) }, owner)).status).toBe(200);
    await request(`/notes/${noteId}/sharing`, { method: "PUT", body: JSON.stringify({ visibility: "selected", userIds: [reader.userId] }) }, owner);

    const ownerKey = makeKey(owner, ["notes:read"]);
    const found = await callTool(ownerKey, "search_notes", { query: "quokka" });
    expect(found.isError).toBe(false);
    const results = found.value.results as Array<{ id: string; title: string; snippet: string; version: number }>;
    expect(results.map((hit) => hit.id)).toEqual([noteId]);
    expect(results[0]!.title).toBe("Quokka field notes");
    expect(results[0]!.version).toBe(1);
    expect(results[0]!.snippet).toContain("quokka");
    expect(results[0]!.snippet).not.toMatch(/[\u0000-\u001f<>]/);
    expect(JSON.stringify(found.value)).not.toContain("wombat");
    expect((await callTool(ownerKey, "search_notes", { query: "wombatdraft" })).value.results).toEqual([]);

    const readerKey = makeKey(reader, ["notes:read"]);
    expect(((await callTool(readerKey, "search_notes", { query: "quokka" })).value.results as unknown[]).length).toBe(1);
    const strangerKey = makeKey(stranger, ["notes:read"]);
    expect((await callTool(strangerKey, "search_notes", { query: "quokka" })).value.results).toEqual([]);

    // Unsharing takes effect at once.
    await request(`/notes/${noteId}/sharing`, { method: "PUT", body: JSON.stringify({ visibility: "private", userIds: [] }) }, owner);
    expect((await callTool(readerKey, "search_notes", { query: "quokka" })).value.results).toEqual([]);

    // Folder filter, limit bounds, and FTS syntax treated as words.
    const { folder } = await json<{ folder: { id: string } }>(await request("/folders", { method: "POST", body: JSON.stringify({ name: "Marsupials", parentId: null }) }, owner));
    const inFolder = await publishedNote(owner, "# Numbat\n\nquokka cousin", folder.id);
    const filtered = await callTool(ownerKey, "search_notes", { query: "quokka", folderId: folder.id });
    expect((filtered.value.results as Array<{ id: string }>).map((hit) => hit.id)).toEqual([inFolder]);
    expect((await callTool(ownerKey, "search_notes", { query: "quokka", limit: 21 })).isError).toBe(true);
    expect((await callTool(ownerKey, "search_notes", { query: "quokka OR NEAR(x) title:*" })).isError).toBe(false);

    // Binned notes disappear.
    expect((await request(`/notes/${inFolder}`, { method: "DELETE", body: "{}" }, owner)).status).toBe(200);
    expect((await callTool(ownerKey, "search_notes", { query: "numbat" })).value.results).toEqual([]);
  });

  test("list_folders follows the GET /api/folders rules for notes:read and files:read keys", async () => {
    const owner = await createUser("Folder owner");
    const reader = await createUser("Folder reader");
    const { folder } = await json<{ folder: { id: string } }>(await request("/folders", { method: "POST", body: JSON.stringify({ name: "Shared plans", parentId: null }) }, owner));
    await request("/folders", { method: "POST", body: JSON.stringify({ name: "Private plans", parentId: null }) }, owner);
    await request(`/folders/${folder.id}/sharing`, { method: "PUT", body: JSON.stringify({ visibility: "selected", userIds: [reader.userId] }) }, owner);

    const readerKey = makeKey(reader, ["files:read"]);
    const listed = await callTool(readerKey, "list_folders");
    const names = (listed.value.folders as Array<{ name: string; is_owner: number }>).map((item) => item.name);
    const api = await json<{ folders: Array<{ name: string }> }>(await request("/folders", {}, reader));
    expect(names).toEqual(api.folders.map((item) => item.name));
    expect(names).toContain("Shared plans");
    expect(names).not.toContain("Private plans");
  });
});

describe("MCP rate limits", () => {
  test("a key gets 120 calls a minute, then RATE_LIMITED; other keys are unaffected", async () => {
    const owner = await createUser("Rate owner");
    const key = makeKey(owner, ["notes:read"]);
    for (let index = 0; index < MCP_LIMITS.call.limit; index += 1) {
      expect((await invokeMcpToolForTests("list_folders", {}, key.id)).isError).toBeUndefined();
    }
    const limited = await callTool(key, "list_folders");
    expect(limited.isError).toBe(true);
    expect(limited.value).toMatchObject({ code: "RATE_LIMITED" });
    expect(limited.value.retryAfterSeconds).toBeGreaterThan(0);
    const other = makeKey(owner, ["notes:read"]);
    expect((await callTool(other, "list_folders")).isError).toBe(false);
  });

  test("write and daily buckets are charged only when every bucket has room", () => {
    const start = 1_000_000;
    for (let index = 0; index < MCP_LIMITS.write.limit; index += 1) expect(consumeMcpLimits("k", ["call", "write"], start)).toBe(0);
    expect(consumeMcpLimits("k", ["call", "write"], start)).toBeGreaterThan(0);
    // The refused write did not use a call.
    expect(consumeMcpLimits("k", ["call"], start)).toBe(0);
    // A minute later the write window resets; the daily bucket keeps counting.
    for (let index = 0; index < MCP_LIMITS.create_note.limit; index += 1) {
      expect(consumeMcpLimits("d", ["create_note"], start + index)).toBe(0);
    }
    expect(consumeMcpLimits("d", ["create_note"], start + 120_000)).toBeGreaterThan(3600);
    expect(consumeMcpLimits("d", ["create_note"], start + 86_400_000)).toBe(0);
    expect(consumeMcpLimits("k", ["call", "write"], start + 60_000)).toBe(0);
  });
});
