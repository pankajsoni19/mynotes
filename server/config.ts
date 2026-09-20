import { resolve } from "node:path";

const port = Number(process.env.PORT ?? 2026);
const dataDir = resolve(process.env.DATA_DIR ?? "/data");
const appOrigin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const allowedEmails = new Set(
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);
const totpPolicyValue = process.env.TOTP_POLICY ?? "optional";
if (!(["optional", "required"] as const).includes(totpPolicyValue as "optional" | "required")) {
  throw new Error("TOTP_POLICY must be either optional or required");
}
const totpPolicy = totpPolicyValue as "optional" | "required";
const totpEncryptionKeyValue = process.env.TOTP_ENCRYPTION_KEY ?? "";
const totpEncryptionKey = totpEncryptionKeyValue ? Buffer.from(totpEncryptionKeyValue, "base64") : null;
if (totpEncryptionKey && totpEncryptionKey.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
if (totpPolicy === "required" && !totpEncryptionKey) throw new Error("TOTP_ENCRYPTION_KEY is required when TOTP_POLICY=required");

export const config = {
  port,
  dataDir,
  databasePath: resolve(dataDir, "mynotes.sqlite"),
  appOrigin,
  isProduction: process.env.NODE_ENV === "production",
  allowRegistration: process.env.ALLOW_REGISTRATION === "true",
  totpPolicy,
  totpEncryptionKey,
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS ?? 14)),
  maxMarkdownBytes: Math.max(1024, Number(process.env.MAX_MARKDOWN_BYTES ?? 2_000_000))
};

export function isEmailAllowed(email: string) {
  return allowedEmails.size === 0 || allowedEmails.has(email.trim().toLowerCase());
}
