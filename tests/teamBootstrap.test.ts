import { expect, test } from "bun:test";
import { join } from "node:path";

test("the first registration becomes the only admin, and the host CLI manages roles within the last-admin rule", () => {
  const probe = Bun.spawnSync(["bun", join(import.meta.dir, "support", "teamBootstrapProbe.ts")], { stdout: "pipe", stderr: "pipe" });
  const output = probe.stdout.toString().trim().split("\n").at(-1) ?? "";
  const result = JSON.parse(output) as Record<string, any>;
  // With ALLOW_REGISTRATION=false two racing "first" registrations let exactly one through.
  expect(result.statuses).toEqual([201, 403]);
  expect(result.winnerRole).toBe("admin");
  expect(result.roles).toEqual([{ role: "admin", count: 1 }]);
  expect(result.bootstrap).toEqual([{ via: "bootstrap", action: "bootstrap_admin", to_role: "admin", actor_id: null }]);
  expect(result.list).toEqual([
    [expect.stringMatching(/^(first|second)@example\.test$/), "admin", "active"],
    ["member@example.test", "member", "active"]
  ]);
  // The only admin cannot be demoted, even from the host.
  expect(result.lastAdmin.code).toBe(1);
  expect(result.lastAdmin.err).toContain("LAST_ADMIN");
  expect(result.promote.code).toBe(0);
  // Viewer and guest are not selectable yet; unknown accounts and commands fail.
  expect(result.viewer).toBe(2);
  expect(result.unknown).toBe(1);
  expect(result.notBlocked.code).toBe(1);
  expect(result.notBlocked.err).toContain("NOT_BLOCKED");
  expect(result.usage).toBe(2);
  expect(result.cliEvents).toEqual([{ via: "cli", action: "role_change", from_role: "member", to_role: "admin", actor_id: null }]);
  expect(result.cliAudit).toEqual({ count: 1 });
}, 30_000);
