import { db } from "../db";
import { can, type Role } from "./roles";

/** The current role of an account, or null when it does not exist. Read fresh, never cached (T79). */
export function userRole(userId: string): Role | null {
  return (db.query("SELECT role FROM users WHERE id = ?").get(userId) as { role: Role } | null)?.role ?? null;
}

/**
 * Whether `userId` may write content right now (§5.4). Services that MCP also calls check this as
 * defence in depth behind the HTTP write gate and the MCP scope filter; unknown users cannot.
 */
export function canWriteContent(userId: string) {
  const role = userRole(userId);
  return role !== null && can(role, "content.write");
}
