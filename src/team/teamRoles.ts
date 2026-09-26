/**
 * Team roles as the client shows them. Mirrors server/team/roles.ts (tests/teamClient.test.ts keeps
 * them in step). The platform role is always labelled "Team role" in copy, so it never reads like
 * the per-item "View only" share role of Collections and Calendar (plan §2.4).
 */
export type Role = "admin" | "member" | "viewer" | "guest";

export const ROLES: readonly Role[] = ["admin", "member", "viewer", "guest"];
/** Roles an admin can assign in this release; viewer and guest arrive with Wave 15. */
export const SELECTABLE_ROLES: readonly Role[] = ["admin", "member"];

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", member: "Member", viewer: "Viewer", guest: "Guest" };

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything a member can do, plus managing the team",
  member: "Creates, edits, and shares notes, files, tasks, collections, and events",
  viewer: "Reads what is shared with them and everyone; changes nothing",
  guest: "Reads only what is shared with them by name"
};

export const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

/** Who can open Team at all (guests cannot, O7). */
export const canSeeTeam = (role: Role | undefined) => role !== undefined && role !== "guest";
export const canManageTeam = (role: Role | undefined) => role === "admin";

/** Granting or removing admin needs the password (and a fresh code when two-factor is on). */
export const roleChangeNeedsReauth = (from: Role, to: Role) => from !== to && (from === "admin" || to === "admin");

/** The Team role picker's options (the shared Select, D91): every role with its one-line description. */
export const roleOptions = () => ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: SELECTABLE_ROLES.includes(role) ? ROLE_DESCRIPTIONS[role] : `${ROLE_DESCRIPTIONS[role]}. Available in a later release.`,
  disabled: !SELECTABLE_ROLES.includes(role)
}));
