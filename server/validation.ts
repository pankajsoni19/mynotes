import { z } from "zod";
import { HTTPException } from "hono/http-exception";

export const uuid = z.string().uuid();
export const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
export const password = z.string().min(12).max(256);

export const registerSchema = z.object({
  email,
  displayName: z.string().trim().min(1).max(80),
  password
}).strict();

export const totpCode = z.string().trim().regex(/^\d{6}$/, "Enter the six-digit authentication code");
export const loginSchema = z.object({ email, password: z.string().min(1).max(256), totpCode: totpCode.optional() }).strict();
export const totpCodeSchema = z.object({ code: totpCode }).strict();
export const totpSetupSchema = z.object({ password: z.string().min(1).max(256) }).strict();
export const totpDisableSchema = z.object({ code: totpCode, password: z.string().min(1).max(256) }).strict();
export const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: uuid.nullish() }).strict();
export const noteCreateSchema = z.object({ folderId: uuid.nullish() }).strict();
export const noteMetaSchema = z.object({ folderId: uuid.nullish() }).strict();
export const draftSchema = z.object({
  markdown: z.string(),
  revision: z.number().int().nonnegative().nullable()
}).strict();
export const sharingSchema = z.object({
  visibility: z.enum(["inherit", "private", "selected", "all_users"]),
  userIds: z.array(uuid).max(100).default([])
}).strict();
export const folderSharingSchema = z.object({
  visibility: z.enum(["private", "selected", "all_users"]),
  userIds: z.array(uuid).max(100).default([])
}).strict();

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2_100_000) throw new HTTPException(413, { message: "Request is too large" });
  return schema.parse(await request.json());
}

export function deriveNoteTitle(markdown: string) {
  for (const sourceLine of markdown.split(/\r?\n/)) {
    const line = sourceLine
      .trim()
      .replace(/^```.*$/, "")
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!line || /^[-=]{3,}$/.test(line)) continue;
    const short = line.split(" ").slice(0, 8).join(" ");
    return short.length > 80 ? `${short.slice(0, 77).trimEnd()}…` : short;
  }
  return "New note";
}
