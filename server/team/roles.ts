/**
 * Platform roles (docs/plan/research/2026-09-26-team-module.md §2, D71–D75). Pure: no database
 * access, so tests and the client mirror (src/team/teamRoles.ts) can share the vocabulary.
 *
 * A role is a ceiling on what per-item sharing already grants; it never grants content access by
 * itself. Only admins manage the team, and admins never bypass item ACLs (D73).
 */
import { MCP_SCOPES, type McpScope } from "../mcpScopes";

export const ROLES = ["admin", "member", "viewer", "guest"] as const;
export type Role = typeof ROLES[number];

export const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

/**
 * Roles an admin can assign in this release. Viewer and guest exist in the schema but are only
 * enforced from Wave 15 (Team B), so the API refuses them with 400 ROLE_NOT_ENABLED until then.
 */
export const SELECTABLE_ROLES: readonly Role[] = ["admin", "member"];
export const isSelectableRole = (role: Role) => SELECTABLE_ROLES.includes(role);

export type Capability =
  /** Anything that creates or changes owned or shared content. */
  | "content.write"
  | "sharing.write"
  | "files.upload"
  | "feeds.create"
  | "mcp.key.create"
  /** See the Team list (names and roles). */
  | "team.read"
  /** Change roles, block and unblock, sign others out, read the activity log and account metadata. */
  | "team.manage";

const CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: ["content.write", "sharing.write", "files.upload", "feeds.create", "mcp.key.create", "team.read", "team.manage"],
  member: ["content.write", "sharing.write", "files.upload", "feeds.create", "mcp.key.create", "team.read"],
  // Wave 15 enforces the read-only roles; the matrix is recorded here so there is one source.
  viewer: ["mcp.key.create", "team.read"],
  guest: []
};

/** Coarse, role-only capability check. Item-level checks stay in each module's access.ts. */
export const can = (role: Role, capability: Capability) => CAPABILITIES[role].includes(capability);

/** MCP scopes only admins may hold (D79: read only, no emails). */
export const ADMIN_ONLY_SCOPES: readonly McpScope[] = ["team:read"];

/**
 * The MCP scopes a key of a user with `role` may use (§5.2.4). Effective scopes are the stored
 * scopes intersected with these, computed on every request and tool call, so a demoted admin's key
 * loses `team:read` on its next call. This wave applies only the admin-only restriction; the viewer
 * (read only) and guest (none) filters arrive with Wave 15.
 */
export function mcpScopesForRole(role: Role): McpScope[] {
  if (role === "admin") return [...MCP_SCOPES];
  return MCP_SCOPES.filter((scope) => !ADMIN_ONLY_SCOPES.includes(scope));
}

/** Stored scopes narrowed to what the holder's current role allows. */
export function effectiveMcpScopes(stored: readonly McpScope[], role: Role): McpScope[] {
  const allowed = mcpScopesForRole(role);
  return stored.filter((scope) => allowed.includes(scope));
}

/** Whether a change from `from` to `to` grants or removes admin, which needs re-authentication (§5.5). */
export const roleChangeNeedsReauth = (from: Role, to: Role) => from !== to && (from === "admin" || to === "admin");
