import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import { parseJson, uuid } from "../validation";
import { QUERY_LIMITS, querySpecShape } from "./query";
import { labelSchema, safeJson, type FieldInput } from "./schema";
import {
  CollectionError,
  createCollection,
  createRow,
  deleteCollection,
  deleteRow,
  getCollection,
  getRow,
  getSharing,
  listCollections,
  listTemplates,
  patchCollection,
  patchRow,
  putSchema,
  putSharing,
  queryRows,
  undoRow
} from "./service";

const icon = z.string().regex(/^[a-z0-9-]{1,32}$/, "Icons are short lowercase names");
const revision = z.number().int().positive();
const valuesObject = z.record(z.string().max(64), z.unknown());

export const collectionCreateSchema = safeJson(z.object({
  name: labelSchema(120),
  icon: icon.optional(),
  templateId: z.string().max(32).optional(),
  // Fields are validated by buildSchema so that every schema error is 400 INVALID_SCHEMA.
  fields: z.array(z.unknown()).max(60).optional()
}).strict());
export const collectionPatchSchema = safeJson(z.object({ name: labelSchema(120).optional(), icon: icon.optional() }).strict()
  .refine((value) => value.name !== undefined || value.icon !== undefined, "Provide a name or an icon"));
export const schemaPutSchema = safeJson(z.object({ fields: z.array(z.unknown()).max(60), schemaVersion: revision }).strict());
export const querySchema = safeJson(z.object({
  viewId: uuid.optional(),
  ...querySpecShape,
  cursor: z.string().max(256).optional(),
  limit: z.number().int().min(1).max(QUERY_LIMITS.pageSize).optional()
}).strict());
export const sharingSchema = safeJson(z.object({
  visibility: z.enum(["private", "selected", "all_users"]),
  userIds: z.array(uuid).max(100).default([]),
  role: z.enum(["viewer", "editor"]).default("viewer")
}).strict());
export const rowCreateSchema =safeJson(z.object({ values: valuesObject, afterRowId: uuid.nullable().optional() }).strict());
export const rowPatchSchema = safeJson(z.object({ values: valuesObject, revision }).strict());
export const rowUndoSchema = safeJson(z.object({ revision }).strict());

export const pathId = (c: Context<AppEnv>, name: string) => uuid.parse(c.req.param(name));

/** Runs a service call and maps CollectionError to its JSON response; other errors reach app.onError. */
export async function respond(c: Context<AppEnv>, operation: () => unknown, status: 200 | 201 = 200) {
  try {
    return c.json(await operation() as Record<string, unknown>, status);
  } catch (error) {
    if (error instanceof CollectionError) return c.json(error.body(), error.status);
    throw error;
  }
}

/**
 * docs/plan/API_CONTRACTS.md § Collections. JSON only; the global session,
 * Origin, CSRF, and TOTP middleware apply.
 *
 * MCP extension point (Stage E, after Wave 8): `list_collections`,
 * `query_rows`, `get_row`, `create_row`, and `update_row` call the same
 * service functions (listCollections, queryRows, getRow, createRow, patchRow)
 * with `updated_via_key_id` set. Nothing here is MCP-specific.
 */
export function registerCollectionRoutes(app: Hono<AppEnv>) {
  const user = (c: Context<AppEnv>) => c.get("user").id;

  app.get("/api/collections", (c) => c.json({ collections: listCollections(user(c)) }));
  app.get("/api/collections/templates", (c) => c.json({ templates: listTemplates() }));

  app.post("/api/collections", async (c) => {
    const body = await parseJson(c.req.raw, collectionCreateSchema);
    return respond(c, () => createCollection(user(c), { ...body, fields: body.fields as FieldInput[] | undefined }), 201);
  });

  app.get("/api/collections/:collectionId", (c) => {
    const collectionId = pathId(c, "collectionId");
    return respond(c, () => getCollection(user(c), collectionId));
  });

  app.patch("/api/collections/:collectionId", async (c) => {
    const collectionId = pathId(c, "collectionId");
    const body = await parseJson(c.req.raw, collectionPatchSchema);
    return respond(c, () => patchCollection(user(c), collectionId, body));
  });

  app.delete("/api/collections/:collectionId", (c) => {
    const collectionId = pathId(c, "collectionId");
    return respond(c, () => deleteCollection(user(c), collectionId));
  });

  app.put("/api/collections/:collectionId/schema", async (c) => {
    const collectionId = pathId(c, "collectionId");
    const body = await parseJson(c.req.raw, schemaPutSchema);
    return respond(c, () => putSchema(user(c), collectionId, { fields: body.fields as FieldInput[], schemaVersion: body.schemaVersion }));
  });

  app.get("/api/collections/:collectionId/sharing", (c) => {
    const collectionId = pathId(c, "collectionId");
    return respond(c, () => getSharing(user(c), collectionId));
  });

  app.put("/api/collections/:collectionId/sharing", async (c) => {
    const collectionId = pathId(c, "collectionId");
    const body = await parseJson(c.req.raw, sharingSchema);
    return respond(c, () => putSharing(user(c), collectionId, body));
  });

  app.post("/api/collections/:collectionId/query", async (c) => {
    const collectionId = pathId(c, "collectionId");
    const body = await parseJson(c.req.raw, querySchema);
    return respond(c, () => queryRows(user(c), collectionId, body));
  });

  app.post("/api/collections/:collectionId/rows", async (c) => {
    const collectionId = pathId(c, "collectionId");
    const body = await parseJson(c.req.raw, rowCreateSchema);
    return respond(c, () => createRow(user(c), collectionId, body), 201);
  });

  app.get("/api/collections/rows/:rowId", (c) => {
    const rowId = pathId(c, "rowId");
    return respond(c, () => getRow(user(c), rowId));
  });

  app.patch("/api/collections/rows/:rowId", async (c) => {
    const rowId = pathId(c, "rowId");
    const body = await parseJson(c.req.raw, rowPatchSchema);
    return respond(c, () => patchRow(user(c), rowId, body));
  });

  app.post("/api/collections/rows/:rowId/undo", async (c) => {
    const rowId = pathId(c, "rowId");
    const body = await parseJson(c.req.raw, rowUndoSchema);
    return respond(c, () => undoRow(user(c), rowId, body));
  });

  app.delete("/api/collections/rows/:rowId", (c) => {
    const rowId = pathId(c, "rowId");
    return respond(c, () => deleteRow(user(c), rowId));
  });
}
