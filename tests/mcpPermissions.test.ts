import { expect, test } from "bun:test";
import { IMPLIED_READ_SCOPE, MCP_SCOPES } from "../server/mcpScopes";
import { ADMIN_ONLY_MCP_SCOPES, lockedScopes, MCP_PERMISSIONS, OFFERED_MCP_PERMISSIONS, offeredMcpPermissions, scopeLabel, toggleScope } from "../src/mcpPermissions";
import { ADMIN_ONLY_SCOPES, mcpScopesForRole } from "../server/team/roles";

test("the Settings permissions mirror the server scopes and their implied reads", () => {
  expect(MCP_PERMISSIONS.map((permission) => permission.scope)).toEqual([...MCP_SCOPES]);
  for (const permission of MCP_PERMISSIONS) expect(permission.implies).toBe(IMPLIED_READ_SCOPE[permission.scope]);
  expect(MCP_PERMISSIONS.find((permission) => permission.scope === "notes:write-draft")!.help).toContain("never publishes");
  expect(OFFERED_MCP_PERMISSIONS.map((permission) => permission.scope)).toEqual([...MCP_SCOPES]);
  expect(MCP_PERMISSIONS.find((permission) => permission.scope === "tasks:write")!.help).toBe("Create, move, and comment on cards: never deletes");
});

test("checking a write scope checks and locks its read scope", () => {
  const withWrite = toggleScope(["files:read"], "notes:write-draft", true);
  expect(withWrite).toEqual(["notes:read", "notes:write-draft", "files:read"]);
  expect(lockedScopes(withWrite)).toEqual(["notes:read"]);
  // The locked read scope cannot be unchecked while the write scope is.
  expect(toggleScope(withWrite, "notes:read", false)).toEqual(withWrite);
  // Unchecking the write scope unlocks, but keeps, the read scope.
  const withoutWrite = toggleScope(withWrite, "notes:write-draft", false);
  expect(withoutWrite).toEqual(["notes:read", "files:read"]);
  expect(lockedScopes(withoutWrite)).toEqual([]);
  expect(toggleScope(withoutWrite, "notes:read", false)).toEqual(["files:read"]);
});

test("scope chips use the permission labels", () => {
  expect(scopeLabel("notes:write-draft")).toBe("Write drafts");
  expect(scopeLabel("future:read")).toBe("future:read");
});

test("team:read is offered only to admins, matching the server's role scopes", () => {
  expect([...ADMIN_ONLY_MCP_SCOPES]).toEqual([...ADMIN_ONLY_SCOPES]);
  expect(offeredMcpPermissions("admin").map((permission) => permission.scope)).toEqual(mcpScopesForRole("admin"));
  for (const role of ["member", "viewer", "guest"] as const) {
    expect(offeredMcpPermissions(role).map((permission) => permission.scope)).toEqual(mcpScopesForRole(role));
  }
  expect(offeredMcpPermissions(undefined).some((permission) => permission.scope === "team:read")).toBe(false);
});
