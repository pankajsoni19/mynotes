import * as z from "zod/v4";
import { defineTool, McpToolError, type McpKeyContext, type McpToolSpec } from "../mcpToolKit";
import { can, ROLES } from "./roles";
import { listTeam, teamEvents, teamMember, userRole, type AdminTeamMember } from "./service";

/**
 * `team:read` tools (docs/plan/research/2026-09-26-team-module.md §7, D79). Admin-only: the scope is
 * refused at key creation for other roles, and removed from a key's effective scopes as soon as its
 * holder is demoted (T81); the handler checks the role again. Output never carries emails, block
 * reasons, or other account metadata beyond status and dates (O12, T21, T35). There are no write
 * tools: role and block changes stay in the web app, behind re-authentication.
 */

const MCP_EVENT_LIMIT = 20;

function requireAdmin(key: McpKeyContext) {
  const role = userRole(key.userId);
  if (!role || !can(role, "team.manage")) throw new McpToolError("SCOPE_REQUIRED", "Only admins can read the team");
  return { id: key.userId, role };
}

const summary = (member: AdminTeamMember) => ({
  id: member.id,
  displayName: member.displayName,
  role: member.role,
  status: member.status,
  createdAt: member.createdAt,
  lastSeenAt: member.lastSeenAt
});

export const teamTools: McpToolSpec[] = [
  defineTool({
    name: "list_team_members",
    title: "List team members",
    description: "List the accounts on this Nook instance with their display name, team role, and status (active or blocked). Emails are never returned.",
    scopes: ["team:read"],
    write: false,
    inputSchema: z.object({
      role: z.enum(ROLES).optional().describe("Only members with this team role"),
      status: z.enum(["active", "blocked"]).optional().describe("Only active or only blocked accounts")
    }),
    handler: ({ role, status }, key) => {
      const viewer = requireAdmin(key);
      const members = (listTeam(viewer).users as AdminTeamMember[])
        .filter((member) => (!role || member.role === role) && (!status || member.status === status));
      return { members: members.map(summary) };
    }
  }),
  defineTool({
    name: "get_team_member",
    title: "Get a team member",
    description: "One account's display name, team role, status, and its latest team activity (role changes, blocks, sign-outs). Emails and block reasons are never returned.",
    scopes: ["team:read"],
    write: false,
    inputSchema: z.object({ userId: z.string().uuid() }),
    handler: ({ userId }, key) => {
      const viewer = requireAdmin(key);
      const member = teamMember(viewer, userId.toLowerCase()) as AdminTeamMember | null;
      if (!member) throw new McpToolError("NOT_FOUND", "Team member not found");
      return {
        ...summary(member),
        blockedAt: member.blockedAt,
        events: teamEvents(member.id, MCP_EVENT_LIMIT).map((event) => ({
          action: event.action,
          fromRole: event.fromRole,
          toRole: event.toRole,
          createdAt: event.createdAt,
          actor: event.actor?.displayName ?? null
        }))
      };
    }
  })
];
