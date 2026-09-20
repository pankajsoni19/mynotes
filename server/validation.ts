import { z } from "zod";
import { HTTPException } from "hono/http-exception";

export const uuid = z.string().uuid();
export const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
export const password = z.string().min(12).max(256);
export const title = z.string().trim().min(1).max(240);

export const registerSchema = z.object({
  email,
  displayName: z.string().trim().min(1).max(80),
  password
}).strict();

export const loginSchema = z.object({ email, password: z.string().min(1).max(256) }).strict();
export const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parentId: uuid.nullish() }).strict();
export const noteCreateSchema = z.object({ title: title.default("Untitled note"), folderId: uuid.nullish() }).strict();
export const noteMetaSchema = z.object({ title: title.optional(), folderId: uuid.nullish().optional() }).strict();
export const draftSchema = z.object({
  title,
  markdown: z.string(),
  revision: z.number().int().nonnegative().nullable()
}).strict();
export const sharingSchema = z.object({
  visibility: z.enum(["private", "selected", "all_users"]),
  userIds: z.array(uuid).max(100).default([])
}).strict();

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2_100_000) throw new HTTPException(413, { message: "Request is too large" });
  return schema.parse(await request.json());
}
