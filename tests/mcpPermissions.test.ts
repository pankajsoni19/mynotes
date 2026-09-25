import { expect, test } from "bun:test";
import { IMPLIED_READ_SCOPE, MCP_SCOPES } from "../server/mcpScopes";
import { lockedScopes, MCP_PERMISSIONS, OFFERED_MCP_PERMISSIONS, scopeLabel, toggleScope } from "../src/mcpPermissions";

test("the Settings permissions mirror the server scopes and their implied reads", () => {
  expect(MCP_PERMISSIONS.map((permission) => permission.scope)).toEqual([...MCP_SCOPES]);
  for (const permission of MCP_PERMISSIONS) expect(permission.implies).toBe(IMPLIED_READ_SCOPE[permission.scope]);
  expect(MCP_PERMISSIONS.find((permission) => permission.scope === "notes:write-draft")!.help).toContain("never publishes");
  expect(OFFERED_MCP_PERMISSIONS.map((permission) => permission.scope)).toEqual(["notes:read", "notes:write-draft", "files:read"]);
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
