import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canCreateMcpKeys, offeredMcpPermissions } from "../src/mcpPermissions";
import { ReadOnlyBanner, RoleContext, ShareRoleHint, useRole } from "../src/team/roleAccess";
import { canWriteContent, shareRoleHint, type Role } from "../src/team/teamRoles";
import * as serverRoles from "../server/team/roles";
import { FileActionSheet } from "../src/files/FileActionSheet";
import type { DocumentSummary } from "../src/types";

/** Wave 15 role-aware chrome: the read-only banner, hidden write controls, and share hints. */

const withRole = (role: Role | undefined, node: React.ReactNode) => renderToStaticMarkup(<RoleContext.Provider value={role}>{node}</RoleContext.Provider>);

function Probe() {
  const { canWrite, readOnly, isGuest } = useRole();
  return <span data-can-write={String(canWrite)} data-read-only={String(readOnly)} data-guest={String(isGuest)} />;
}

const ownDocument = { id: "d1", name: "plan.txt", is_owner: 1, preview_kind: "text" } as unknown as DocumentSummary;

describe("role-aware chrome", () => {
  test("canWriteContent mirrors the server capability", () => {
    for (const role of serverRoles.ROLES) expect(canWriteContent(role)).toBe(serverRoles.can(role, "content.write"));
    // Before /api/auth/me answers (older server), nothing is hidden: the server still enforces.
    expect(canWriteContent(undefined)).toBe(true);
  });

  test("useRole and the banner follow the provided role", () => {
    expect(withRole("member", <Probe />)).toBe(`<span data-can-write="true" data-read-only="false" data-guest="false"></span>`);
    expect(withRole("guest", <Probe />)).toBe(`<span data-can-write="false" data-read-only="true" data-guest="true"></span>`);
    expect(withRole("admin", <ReadOnlyBanner />)).toBe("");
    expect(withRole("member", <ReadOnlyBanner />)).toBe("");
    expect(withRole("viewer", <ReadOnlyBanner />)).toContain("Team role: Viewer");
    expect(withRole("guest", <ReadOnlyBanner />)).toContain("Team role: Guest");
    expect(withRole("guest", <ReadOnlyBanner />)).toContain("View only");
  });

  test("owners who are read-only get no rename, move, share, or delete on their files", () => {
    const actions = (role: Role) => withRole(role, <FileActionSheet document={ownDocument} onAction={() => undefined} onClose={() => undefined} />);
    for (const role of ["admin", "member"] as const) expect(actions(role)).toContain("Rename");
    for (const role of ["viewer", "guest"] as const) {
      const markup = actions(role);
      expect(markup).toContain("Download");
      for (const label of ["Rename", "Move", "Share", "Delete"]) expect(markup).not.toContain(`</svg>${label}<`);
    }
  });

  test("share pickers hint recipients who will only read", () => {
    expect(shareRoleHint("guest")).toBe("Guest");
    expect(shareRoleHint("viewer")).toBe("Viewer");
    expect(shareRoleHint("member")).toBeNull();
    expect(renderToStaticMarkup(<ShareRoleHint role="guest" />)).toContain("Guest");
    expect(renderToStaticMarkup(<ShareRoleHint role="admin" />)).toBe("");
  });

  test("Settings offers MCP permissions by role, matching the server, and no key form to guests", () => {
    for (const role of serverRoles.ROLES) expect(offeredMcpPermissions(role).map((permission) => permission.scope)).toEqual(serverRoles.mcpScopesForRole(role));
    expect(offeredMcpPermissions("viewer").every((permission) => !permission.implies)).toBe(true);
    expect(canCreateMcpKeys("guest")).toBe(false);
    expect(canCreateMcpKeys("viewer")).toBe(true);
  });
});
