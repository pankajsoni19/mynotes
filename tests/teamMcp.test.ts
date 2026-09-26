import { beforeEach, describe, expect, test } from "bun:test";
import { createUser, db, origin, request, type Session } from "./support/harness";

const { createMcpApiKey } = await import("../server/mcp");
const { resetMcpLimits } = await import("../server/mcpRateLimit");
const { invokeMcpToolForTests } = await import("../server/mcpTools");
const { resetTeamRateLimits } = await import("../server/team/routes");

beforeEach(() => {
  resetTeamRateLimits();
  resetMcpLimits();
});

type Role = "admin" | "member" | "viewer" | "guest";
const setRoleSql = (session: Session, role: Role) => db.query("UPDATE users SET role = ? WHERE id = ?").run(role, session.userId);

async function user(label: string, role: Role = "member") {
  const session = await createUser(label);
  if (role !== "member") setRoleSql(session, role);
  return session;
}

const call = (session: Session, method: string, path: string, body: unknown = {}) => request(`/team${path}`, { method, body: JSON.stringify(body) }, session);

let rpcId = 0;
async function rpc(token: string, method: string, params: unknown = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params })
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  const json = text.trimStart().startsWith("{") ? text : text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
  return JSON.parse(json) as { result?: { tools?: Array<{ name: string }>; isError?: boolean; content?: Array<{ text: string }> } };
}
const toolNames = async (token: string) => (await rpc(token, "tools/list")).result!.tools!.map((tool) => tool.name);
async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const body = await rpc(token, "tools/call", { name, arguments: args });
  return { isError: body.result!.isError === true, value: JSON.parse(body.result!.content![0]!.text) as Record<string, any> };
}

describe("Team MCP", () => {
  test("team:read is admin-only at key creation", async () => {
    const admin = await user("Key admin", "admin");
    const member = await user("Key member");
    const body = (session: Session) => JSON.stringify({ name: "Team", scopes: ["team:read"], password: session.password });
    const refused = await request("/mcp/keys", { method: "POST", body: body(member) }, member);
    expect(refused.status).toBe(403);
    expect((await refused.json() as { code: string }).code).toBe("SCOPE_NOT_ALLOWED");
    expect((await request("/mcp/keys", { method: "POST", body: body(admin) }, admin)).status).toBe(201);
  });

  test("the tools list members without emails, and a demoted admin's key loses them on the next call", async () => {
    const admin = await user("MCP admin", "admin");
    const target = await user("MCP target");
    const key = createMcpApiKey(admin.userId, "Team key", ["team:read", "notes:read"]);
    expect(await toolNames(key.token)).toEqual(expect.arrayContaining(["list_team_members", "get_team_member", "list_notes"]));

    const listed = await callTool(key.token, "list_team_members", { status: "active" });
    expect(listed.isError).toBe(false);
    const row = listed.value.members.find((member: { id: string }) => member.id === target.userId);
    expect(Object.keys(row).sort()).toEqual(["createdAt", "displayName", "id", "lastSeenAt", "role", "status"]);
    expect(JSON.stringify(listed.value)).not.toContain("@example.test");

    await call(admin, "POST", `/${target.userId}/block`, { reason: "Private reason" });
    const detail = await callTool(key.token, "get_team_member", { userId: target.userId });
    expect(detail.value).toMatchObject({ id: target.userId, status: "blocked" });
    expect(detail.value.events[0]).toMatchObject({ action: "block", actor: "MCP admin" });
    expect(JSON.stringify(detail.value)).not.toContain("Private reason");
    expect(JSON.stringify(detail.value)).not.toContain("@example.test");
    expect((await callTool(key.token, "get_team_member", { userId: crypto.randomUUID() })).value.code).toBe("NOT_FOUND");
    await call(admin, "POST", `/${target.userId}/unblock`, {});

    setRoleSql(admin, "member");
    const names = await toolNames(key.token);
    expect(names).not.toContain("list_team_members");
    expect(names).toContain("list_notes");
    const direct = await invokeMcpToolForTests("list_team_members", {}, key.id);
    expect(JSON.parse(direct.content[0]!.text).code).toBe("SCOPE_REQUIRED");
    setRoleSql(admin, "admin");
    expect(await toolNames(key.token)).toContain("list_team_members");
  });
});
