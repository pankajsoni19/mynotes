import { config } from "./config";
import { audit, db, type UserRow } from "./db";
import { decryptRecoveryCodes, decryptTotpSecret, encryptRecoveryCodes, recoveryCodeMatches, verifyTotp } from "./totp";

/**
 * Second-factor checks shared by sign-in, MCP key creation, and Team re-authentication. Each code
 * is consumed with a compare-and-swap, so a TOTP counter or recovery code works once.
 */

export function consumeTotp(user: Pick<UserRow, "id" | "totp_secret" | "totp_last_counter">, code: string) {
  if (!user.totp_secret || !config.totpEncryptionKey) return null;
  let secret: string;
  try {
    secret = decryptTotpSecret(user.totp_secret, config.totpEncryptionKey, user.id);
  } catch {
    audit(user.id, null, "auth.totp_secret_unreadable");
    return null;
  }
  const counter = verifyTotp(secret, code, user.totp_last_counter);
  if (counter === null) return null;
  const result = db.query(`
    UPDATE users SET totp_last_counter = ?
    WHERE id = ? AND totp_secret = ? AND (totp_last_counter IS NULL OR totp_last_counter < ?)
  `).run(counter, user.id, user.totp_secret, counter);
  return result.changes === 1 ? counter : null;
}

export function consumeRecoveryCode(user: Pick<UserRow, "id" | "totp_recovery_codes">, code: string) {
  if (!user.totp_recovery_codes || !config.totpEncryptionKey) return false;
  try {
    const codes = decryptRecoveryCodes(user.totp_recovery_codes, config.totpEncryptionKey, user.id);
    const index = codes.findIndex((candidate) => recoveryCodeMatches(candidate, code));
    if (index < 0) return false;
    const remaining = codes.filter((_, itemIndex) => itemIndex !== index);
    const encrypted = encryptRecoveryCodes(remaining, config.totpEncryptionKey, user.id);
    const result = db.query("UPDATE users SET totp_recovery_codes = ? WHERE id = ? AND totp_recovery_codes = ?")
      .run(encrypted, user.id, user.totp_recovery_codes);
    return result.changes === 1;
  } catch {
    audit(user.id, null, "auth.totp_recovery_unreadable");
    return false;
  }
}

export type ReauthInput = { password?: string; totpCode?: string; recoveryCode?: string };

/**
 * Re-authenticates an active user with their password plus, when TOTP is enabled, a fresh
 * authentication or recovery code (the MCP key creation rule, index.ts). Codes are consumed only
 * after the password verifies. `purpose` is recorded when a recovery code is used.
 */
export async function verifyReauth(userId: string, input: ReauthInput, purpose: string) {
  if (!input.password) return false;
  const user = db.query("SELECT * FROM users WHERE id = ? AND disabled_at IS NULL").get(userId) as UserRow | null;
  if (!user || !await Bun.password.verify(input.password, user.password_hash)) return false;
  if (!user.totp_enabled_at) return true;
  if (input.recoveryCode) {
    if (!consumeRecoveryCode(user, input.recoveryCode)) return false;
    audit(user.id, null, "auth.recovery_code_used", { purpose });
    return true;
  }
  return input.totpCode ? consumeTotp(user, input.totpCode) !== null : false;
}
