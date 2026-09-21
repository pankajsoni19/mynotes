import { resolve } from "node:path";

const port = Number(process.env.PORT ?? 2026);
const dataDir = resolve(process.env.DATA_DIR ?? "/data");
const appOrigin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const appOrigins = new Set(
  (process.env.APP_ORIGINS ?? appOrigin)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("APP_ORIGINS entries must be exact http(s) origins without paths, credentials, queries, or fragments");
      }
      return url.origin;
    })
);
if (!appOrigins.size) throw new Error("APP_ORIGINS must contain at least one origin");
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
const cookieSecureValue = process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === "production" ? "true" : "false");
if (!(cookieSecureValue === "true" || cookieSecureValue === "false")) throw new Error("COOKIE_SECURE must be true or false");
const totpEncryptionKeyValue = process.env.TOTP_ENCRYPTION_KEY ?? "";
const totpEncryptionKey = totpEncryptionKeyValue ? Buffer.from(totpEncryptionKeyValue, "base64") : null;
if (totpEncryptionKey && totpEncryptionKey.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
if (totpPolicy === "required" && !totpEncryptionKey) throw new Error("TOTP_ENCRYPTION_KEY is required when TOTP_POLICY=required");

export const config = {
  port,
  dataDir,
  databasePath: resolve(dataDir, "mynotes.sqlite"),
  appOrigin,
  appOrigins,
  isProduction: process.env.NODE_ENV === "production",
  cookieSecure: cookieSecureValue === "true",
  allowRegistration: process.env.ALLOW_REGISTRATION === "true",
  totpPolicy,
  totpEncryptionKey,
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS ?? 14)),
  maxMarkdownBytes: Math.max(1024, Number(process.env.MAX_MARKDOWN_BYTES ?? 2_000_000)),
  appVersion: process.env.APP_VERSION ?? "0.2.2",
  gitSha: (process.env.GIT_SHA ?? "development").slice(0, 40)
};

export function isEmailAllowed(email: string) {
  return allowedEmails.size === 0 || allowedEmails.has(email.trim().toLowerCase());
}

export function isOriginAllowed(origin: string | undefined | null) {
  return Boolean(origin && appOrigins.has(origin));
}
