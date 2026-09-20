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

export const config = {
  port,
  dataDir,
  databasePath: resolve(dataDir, "mynotes.sqlite"),
  appOrigin,
  isProduction: process.env.NODE_ENV === "production",
  allowRegistration: process.env.ALLOW_REGISTRATION === "true",
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS ?? 14)),
  maxMarkdownBytes: Math.max(1024, Number(process.env.MAX_MARKDOWN_BYTES ?? 2_000_000))
};

export function isEmailAllowed(email: string) {
  return allowedEmails.size === 0 || allowedEmails.has(email.trim().toLowerCase());
}
