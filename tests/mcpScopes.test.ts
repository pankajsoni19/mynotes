import { expect, test } from "bun:test";
import { hasAnyScope, hasScope, MCP_SCOPES, normalizeScopes, parseStoredScopes } from "../server/mcpScopes";

test("normalizeScopes adds implied read scopes, dedupes, and orders canonically", () => {
  expect(normalizeScopes(["tasks:write"])).toEqual(["tasks:read", "tasks:write"]);
  expect(normalizeScopes(["notes:write-draft", "files:read", "notes:write-draft"])).toEqual(["notes:read", "notes:write-draft", "files:read"]);
  expect(normalizeScopes([...MCP_SCOPES].reverse())).toEqual([...MCP_SCOPES]);
});

test("write implies read, never the other way", () => {
  expect(hasScope(["notes:write-draft"], "notes:read")).toBe(true);
  expect(hasScope(["notes:read"], "notes:write-draft")).toBe(false);
  expect(hasScope(["tasks:write"], "tasks:read")).toBe(true);
  expect(hasScope(["tasks:read"], "tasks:write")).toBe(false);
  expect(hasScope(["files:read"], "notes:read")).toBe(false);
  expect(hasAnyScope(["files:read"], ["notes:read", "files:read"])).toBe(true);
  expect(hasAnyScope([], ["notes:read"])).toBe(false);
});

test("stored scopes read leniently and never grant more than stored", () => {
  expect(parseStoredScopes('["notes:read"]')).toEqual(["notes:read"]);
  expect(parseStoredScopes(null)).toEqual(["notes:read"]);
  expect(parseStoredScopes("not json")).toEqual(["notes:read"]);
  expect(parseStoredScopes('{"notes:read":true}')).toEqual(["notes:read"]);
  expect(parseStoredScopes('["files:read","admin","calendar:write"]')).toEqual(["files:read"]);
  expect(parseStoredScopes('["tasks:write"]')).toEqual(["tasks:read", "tasks:write"]);
  expect(parseStoredScopes("[]")).toEqual([]);
});
