import { createContext, useContext } from "react";
import { Eye } from "lucide-react";
import { canWriteContent, ROLE_LABELS, shareRoleHint, type Role } from "./teamRoles";
import "./roleAccess.css";

/**
 * The signed-in user's Team role, provided once by App (Team plan §6.3, Wave 15). Apps read it
 * through `useRole()` to hide create, edit, share, and upload controls for viewers and guests and
 * to show the read-only banner. This is chrome only: the server's write gate is the enforcement.
 */
export const RoleContext = createContext<Role | undefined>(undefined);

export type RoleAccess = {
  role: Role | undefined;
  /** Creates, edits, shares, uploads, restores (members and admins; unknown counts as yes). */
  canWrite: boolean;
  readOnly: boolean;
  isGuest: boolean;
};

export function useRole(): RoleAccess {
  const role = useContext(RoleContext);
  const canWrite = canWriteContent(role);
  return { role, canWrite, readOnly: !canWrite, isGuest: role === "guest" };
}

/** "View only · Team role: Viewer" under an app's header, for viewers and guests only. */
export function ReadOnlyBanner() {
  const { role, readOnly } = useRole();
  if (!readOnly || !role) return null;
  return <p className="read-only-banner" role="note"><Eye aria-hidden="true" /><span><strong>View only</strong> · Team role: {ROLE_LABELS[role]}</span></p>;
}

/**
 * A share picker hint next to a recipient whose Team role only reads ("Guest", "Viewer"), so an
 * owner knows sharing with them grants reading only (Team plan §2.2 notes).
 */
export function ShareRoleHint({ role }: { role: Role | undefined }) {
  const hint = shareRoleHint(role);
  return hint ? <em className="share-role-hint" title={`Team role: ${hint}. They can only read.`}><span className="sr-only">Team role: </span>{hint}</em> : null;
}
