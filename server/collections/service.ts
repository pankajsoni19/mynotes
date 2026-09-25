import { readableNotePredicate } from "../access";
import { purgeAfterFrom } from "../bin";
import { audit, db, now } from "../db";
import { withResourceLock } from "../storage";
import { planInsert, POSITION_STEP, type Positioned } from "../tasks/boardOrder";
import {
  collectionRole,
  readableCollection,
  readableCollectionPredicate,
  readableRow,
  type CollectionRecord,
  type CollectionRole,
  type CollectionVisibility,
  type RowRecord,
  type ShareRole
} from "./access";
import { compileQuery, decodeCursor, encodeCursor, QUERY_LIMITS, QueryError, specKey, type QuerySpec } from "./query";
import {
  buildSchema,
  parseStoredSchema,
  readValues,
  rowTitle,
  SchemaError,
  validateValues,
  type CollectionSchema,
  type FieldDefinition,
  type FieldInput,
  type RowValues,
  type ValueContext
} from "./schema";
import { COLLECTION_TEMPLATES, DEFAULT_FIELDS, templateById } from "./templates";

/**
 * Collections services (WAVES_10-12.md §3). Routes are thin adapters over
 * these functions so the Stage E MCP tools can reuse them. Every failure is a
 * CollectionError.
 *
 * Authorization (D54): readers (owner, members of a `selected` collection,
 * everyone on an `all_users` one) read; editors (the owner, or every reader
 * when share_role = 'editor') write rows; only the owner edits the schema,
 * views, name, and sharing, and deletes. Non-readers get 404; readers get 403
 * READ_ONLY (row writes) or OWNER_ONLY.
 */
export class CollectionError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 429, message: string, readonly code?: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
  body() {
    return { error: this.message, ...(this.code ? { code: this.code } : {}), ...this.extra };
  }
}

export const LIMITS = { collectionsPerOwner: 100, liveRowsPerCollection: 10_000, viewsPerCollection: 20, attachmentsPerRow: 20 } as const;

const collectionNotFound = () => new CollectionError(404, "Collection not found");
const rowNotFound = () => new CollectionError(404, "Row not found");
const ownerOnly = () => new CollectionError(403, "Only the collection owner can do this", "OWNER_ONLY");
const readOnly = () => new CollectionError(403, "You can view this collection but not change it", "READ_ONLY");
const limitReached = (message: string) => new CollectionError(409, message, "LIMIT_REACHED");

/** Serializes every change to one collection: rows, positions, schema, sharing, and deletion. */
export const withCollectionLock = <T>(collectionId: string, operation: () => T | Promise<T>) =>
  withResourceLock(`collection:${collectionId}`, async () => operation());

export function requireReadableCollection(collectionId: string, userId: string) {
  const collection = readableCollection(collectionId, userId);
  if (!collection) throw collectionNotFound();
  return collection;
}

export function requireOwnedCollection(collectionId: string, userId: string) {
  const collection = requireReadableCollection(collectionId, userId);
  if (collection.owner_id !== userId) throw ownerOnly();
  return collection;
}

export function requireEditableCollection(collectionId: string, userId: string) {
  const collection = requireReadableCollection(collectionId, userId);
  if (collectionRole(collection, userId) === "viewer") throw readOnly();
  return collection;
}

function requireReadableRow(rowId: string, userId: string) {
  const found = readableRow(rowId, userId);
  if (!found) throw rowNotFound();
  return found;
}

function requireEditableRow(rowId: string, userId: string) {
  const found = requireReadableRow(rowId, userId);
  if (collectionRole(found.collection, userId) === "viewer") throw readOnly();
  return found;
}

export const schemaOf = (collection: Pick<CollectionRecord, "schema_json">) => parseStoredSchema(collection.schema_json);

// ---------------------------------------------------------------------------
// Collections

export type CollectionSummary = {
  id: string;
  name: string;
  icon: string;
  owner_id: string;
  owner_name: string;
  is_owner: 0 | 1;
  role: CollectionRole;
  visibility: CollectionVisibility;
  share_role: ShareRole;
  row_count: number;
  field_count: number;
  template_id: string | null;
  created_at: string;
  updated_at: string;
};
export type CollectionDetail = CollectionSummary & { fields: FieldDefinition[]; schema_version: number };

const summarySelect = `
  SELECT c.id, c.name, c.icon, c.owner_id, u.display_name AS owner_name,
         CASE WHEN c.owner_id = $userId THEN 1 ELSE 0 END AS is_owner,
         c.visibility, c.share_role, c.schema_json, c.schema_version, c.template_id,
         (SELECT COUNT(*) FROM collection_rows r WHERE r.collection_id = c.id AND r.deleted_at IS NULL) AS row_count,
         c.created_at, c.updated_at
  FROM collections c JOIN users u ON u.id = c.owner_id
`;
type SummaryRow = Omit<CollectionSummary, "role" | "field_count"> & { schema_json: string; schema_version: number };

function toDetail(row: SummaryRow, userId: string): CollectionDetail {
  const { schema_json, ...rest } = row;
  const fields = parseStoredSchema(schema_json).fields;
  return { ...rest, role: collectionRole(row, userId), field_count: fields.length, fields };
}

export function collectionDetail(collectionId: string, userId: string) {
  const row = db.query(`${summarySelect} WHERE c.id = $collectionId AND ${readableCollectionPredicate}`).get({ collectionId, userId }) as SummaryRow | null;
  return row ? toDetail(row, userId) : null;
}

export function listCollections(userId: string): CollectionSummary[] {
  const rows = db.query(`${summarySelect} WHERE ${readableCollectionPredicate} ORDER BY is_owner DESC, c.name COLLATE NOCASE, c.id LIMIT 500`).all({ userId }) as SummaryRow[];
  return rows.map((row) => {
    const { fields: _fields, schema_version: _version, ...summary } = toDetail(row, userId);
    return summary;
  });
}

export function listTemplates() {
  return COLLECTION_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    icon: template.icon,
    description: template.description,
    fields: template.fields.map((field) => ({ name: field.name, type: field.type }))
  }));
}

function schemaFrom(fields: FieldInput[], previous: CollectionSchema | null) {
  try {
    return buildSchema(fields, previous);
  } catch (error) {
    if (error instanceof SchemaError) throw new CollectionError(400, error.message, error.code);
    throw error;
  }
}

export type CollectionCreateInput = { name: string; icon?: string; templateId?: string; fields?: FieldInput[] };

export function createCollection(userId: string, input: CollectionCreateInput) {
  if (input.templateId !== undefined && input.fields !== undefined) throw new CollectionError(400, "Use a template or fields, not both");
  const template = input.templateId === undefined ? null : templateById(input.templateId);
  if (input.templateId !== undefined && !template) throw new CollectionError(400, "Unknown template");
  const schema = schemaFrom(template?.fields ?? input.fields ?? DEFAULT_FIELDS, null);
  const icon = input.icon ?? template?.icon ?? "table";
  return db.transaction(() => {
    const owned = (db.query("SELECT COUNT(*) AS count FROM collections WHERE owner_id = ? AND deleted_at IS NULL").get(userId) as { count: number }).count;
    if (owned >= LIMITS.collectionsPerOwner) throw limitReached(`You can have up to ${LIMITS.collectionsPerOwner} collections`);
    const id = crypto.randomUUID();
    const timestamp = now();
    db.query(`INSERT INTO collections (id, owner_id, name, icon, schema_json, template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, userId, input.name, icon, JSON.stringify(schema), template?.id ?? null, timestamp, timestamp);
    audit(userId, null, "collection.create", { collectionId: id, fieldCount: schema.fields.length, ...(template ? { templateId: template.id } : {}) });
    return { collection: collectionDetail(id, userId)! };
  })();
}

export function getCollection(userId: string, collectionId: string) {
  const collection = requireReadableCollection(collectionId, userId);
  return { collection: collectionDetail(collectionId, userId)!, role: collectionRole(collection, userId), views: listViews(collectionId) };
}

export function patchCollection(userId: string, collectionId: string, input: { name?: string; icon?: string }) {
  return withCollectionLock(collectionId, () => {
    requireOwnedCollection(collectionId, userId);
    db.transaction(() => {
      db.query("UPDATE collections SET name = COALESCE(?, name), icon = COALESCE(?, icon), updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .run(input.name ?? null, input.icon ?? null, now(), collectionId);
      audit(userId, null, "collection.update", { collectionId });
    })();
    return { collection: collectionDetail(collectionId, userId)! };
  });
}

/** Moves a collection to the Bin (owner only). Rows, views, and sharing are kept for a restore. */
export function deleteCollection(userId: string, collectionId: string) {
  return withCollectionLock(collectionId, () => {
    requireOwnedCollection(collectionId, userId);
    const deletedAt = new Date();
    const purgeAfter = purgeAfterFrom(deletedAt);
    db.transaction(() => {
      db.query("UPDATE collections SET deleted_at = ?, deleted_by = ?, purge_after = ? WHERE id = ? AND deleted_at IS NULL")
        .run(deletedAt.toISOString(), userId, purgeAfter, collectionId);
      audit(userId, null, "collection.delete", { collectionId });
    })();
    return { ok: true as const, purgeAfter };
  });
}

/**
 * Replaces the schema with a compare-and-swap on schema_version (409
 * SCHEMA_CHANGED carries the current collection). Rows are not rewritten:
 * removed values drop on each row's next write (lenient reads).
 */
export function putSchema(userId: string, collectionId: string, input: { fields: FieldInput[]; schemaVersion: number }) {
  return withCollectionLock(collectionId, () => {
    const collection = requireOwnedCollection(collectionId, userId);
    if (collection.schema_version !== input.schemaVersion) {
      throw new CollectionError(409, "Someone else changed the fields", "SCHEMA_CHANGED", { collection: collectionDetail(collectionId, userId) });
    }
    const schema = schemaFrom(input.fields, schemaOf(collection));
    db.transaction(() => {
      const updated = db.query("UPDATE collections SET schema_json = ?, schema_version = schema_version + 1, updated_at = ? WHERE id = ? AND schema_version = ? AND deleted_at IS NULL")
        .run(JSON.stringify(schema), now(), collectionId, input.schemaVersion);
      if (updated.changes !== 1) throw new Error("Concurrent schema update detected");
      afterSchemaChange(collectionId);
      audit(userId, null, "collection.schema_update", { collectionId, fieldCount: schema.fields.length });
    })();
    return { collection: collectionDetail(collectionId, userId)! };
  });
}

/** Hooks run in the schema transaction (search reindex arrives with stage D). */
function afterSchemaChange(_collectionId: string) {}

// ---------------------------------------------------------------------------
// Views (the list is filled in by saved views, stage B)

export type ViewSummary = { id: string; collection_id: string; name: string; kind: "table" | "board"; config: unknown; position: number; created_at: string; updated_at: string };

export function listViews(collectionId: string): ViewSummary[] {
  const rows = db.query("SELECT id, collection_id, name, kind, config_json, position, created_at, updated_at FROM collection_views WHERE collection_id = ? ORDER BY position, id")
    .all(collectionId) as Array<Omit<ViewSummary, "config"> & { config_json: string }>;
  return rows.map(({ config_json, ...view }) => ({ ...view, config: JSON.parse(config_json) as unknown }));
}

// ---------------------------------------------------------------------------
// Rows

export type NoteLink = { id: string; title: string } | { id: string; restricted: true };
export type RowSummary = {
  id: string;
  collection_id: string;
  position: number;
  title: string;
  values: RowValues;
  /** Note fields resolved for this viewer: an unreadable note is `{ id, restricted: true }` (D58, T59). */
  links: Record<string, NoteLink>;
  revision: number;
  can_undo: boolean;
  created_by: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_via_key_id: string | null;
  created_at: string;
  updated_at: string;
};

type RowWithNames = RowRecord & { created_by_name: string | null; updated_by_name: string | null };
const rowSelect = `SELECT r.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name
  FROM collection_rows r LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users uu ON uu.id = r.updated_by`;

/** Resolves note ids for `viewerId`: readable live notes give their title, everything else is restricted. */
function resolveNotes(noteIds: string[], viewerId: string) {
  const titles = new Map<string, string>();
  const unique = [...new Set(noteIds)];
  for (let start = 0; start < unique.length; start += 200) {
    const batch = unique.slice(start, start + 200);
    const params: Record<string, string> = { userId: viewerId };
    batch.forEach((id, index) => { params[`n${index}`] = id; });
    const rows = db.query(`SELECT n.id, n.title FROM notes n WHERE n.id IN (${batch.map((_, index) => `$n${index}`).join(", ")})
      AND n.deleted_at IS NULL AND ${readableNotePredicate}`).all(params) as Array<{ id: string; title: string }>;
    for (const row of rows) titles.set(row.id, row.title);
  }
  return titles;
}

export function presentRows(schema: CollectionSchema, rows: RowWithNames[], viewerId: string): RowSummary[] {
  const noteFields = schema.fields.filter((field) => field.type === "note");
  const projected = rows.map((row) => ({ row, values: readValues(schema, JSON.parse(row.values_json)) }));
  const noteIds = noteFields.length ? projected.flatMap(({ values }) => noteFields.map((field) => values[field.id]).filter((id): id is string => typeof id === "string")) : [];
  const titles = noteIds.length ? resolveNotes(noteIds, viewerId) : new Map<string, string>();
  return projected.map(({ row, values }) => {
    const links: Record<string, NoteLink> = {};
    for (const field of noteFields) {
      const id = values[field.id];
      if (typeof id !== "string") continue;
      const title = titles.get(id);
      links[field.id] = title === undefined ? { id, restricted: true } : { id, title };
    }
    return {
      id: row.id,
      collection_id: row.collection_id,
      position: row.position,
      title: rowTitle(schema, values),
      values,
      links,
      revision: row.revision,
      can_undo: row.prev_values_json !== null,
      created_by: row.created_by,
      created_by_name: row.created_by_name,
      updated_by_name: row.updated_by_name,
      updated_via_key_id: row.updated_via_key_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });
}

function rowDetail(rowId: string, schema: CollectionSchema, viewerId: string) {
  const row = db.query(`${rowSelect} WHERE r.id = ? AND r.deleted_at IS NULL`).get(rowId) as RowWithNames | null;
  return row ? presentRows(schema, [row], viewerId)[0]! : null;
}

/** Note values may only link notes the writer can read now (D58). */
export const valueContext = (userId: string): ValueContext => ({
  canLinkNote: (id) => Boolean(db.query(`SELECT 1 FROM notes n WHERE n.id = $noteId AND n.deleted_at IS NULL AND ${readableNotePredicate}`).get({ noteId: id, userId }))
});

function invalidValues(fieldErrors: Record<string, string>) {
  return new CollectionError(400, "Some values are not valid", "INVALID_VALUES", { fieldErrors });
}

const liveRowCount = (collectionId: string) =>
  (db.query("SELECT COUNT(*) AS count FROM collection_rows WHERE collection_id = ? AND deleted_at IS NULL").get(collectionId) as { count: number }).count;

const livePositions = (collectionId: string) =>
  db.query("SELECT id, position FROM collection_rows WHERE collection_id = ? AND deleted_at IS NULL ORDER BY position, id").all(collectionId) as Positioned[];

/** Where a new row goes: bottom (undefined), top (null), or after a live row of this collection. */
function planRowPosition(collectionId: string, afterRowId: string | null | undefined) {
  if (afterRowId === undefined) {
    const last = db.query("SELECT MAX(position) AS position FROM collection_rows WHERE collection_id = ? AND deleted_at IS NULL").get(collectionId) as { position: number | null };
    const position = (last.position ?? 0) + POSITION_STEP;
    if (Number.isFinite(position) && position < Number.MAX_SAFE_INTEGER / 2) return { position, renumbered: null };
  }
  const plan = planInsert(livePositions(collectionId), afterRowId);
  if (!plan) throw new CollectionError(404, "Row not found");
  return plan;
}

function applyRenumber(renumbered: Positioned[] | null) {
  if (!renumbered) return;
  const statement = db.query("UPDATE collection_rows SET position = ? WHERE id = ?");
  for (const item of renumbered) statement.run(item.position, item.id);
}

/** Row writes run these in their transaction (search indexing arrives with stage D). */
export const rowHooks = {
  afterWrite: (_rowId: string, _collection: CollectionRecord) => undefined as void
};

export type RowCreateInput = { values: unknown; afterRowId?: string | null };

export function createRow(userId: string, collectionId: string, input: RowCreateInput) {
  return withCollectionLock(collectionId, () => {
    const collection = requireEditableCollection(collectionId, userId);
    const schema = schemaOf(collection);
    const result = validateValues(schema, input.values, {}, valueContext(userId), "create");
    if (!result.ok) throw invalidValues(result.fieldErrors);
    if (liveRowCount(collectionId) >= LIMITS.liveRowsPerCollection) throw limitReached(`A collection can have up to ${LIMITS.liveRowsPerCollection} rows`);
    const plan = planRowPosition(collectionId, input.afterRowId);
    const id = crypto.randomUUID();
    db.transaction(() => {
      applyRenumber(plan.renumbered);
      const timestamp = now();
      db.query(`INSERT INTO collection_rows (id, collection_id, position, values_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, collectionId, plan.position, JSON.stringify(result.values), userId, userId, timestamp, timestamp);
      db.query("UPDATE collections SET updated_at = ? WHERE id = ?").run(timestamp, collectionId);
      rowHooks.afterWrite(id, collection);
      audit(userId, null, "collection.row_create", { collectionId, rowId: id });
    })();
    return { row: rowDetail(id, schema, userId)! };
  });
}

export function getRow(userId: string, rowId: string) {
  const { collection } = requireReadableRow(rowId, userId);
  const schema = schemaOf(collection);
  return { row: rowDetail(rowId, schema, userId)!, role: collectionRole(collection, userId), schemaVersion: collection.schema_version };
}

function rowChanged(rowId: string, schema: CollectionSchema, userId: string) {
  return new CollectionError(409, "Someone else changed this row", "ROW_CHANGED", { row: rowDetail(rowId, schema, userId) });
}

/**
 * Merges `values` into the row with a compare-and-swap on `revision` (409
 * ROW_CHANGED carries the current row). The previous values are kept for a
 * one-step undo (D61). Values of removed fields are dropped here.
 */
export async function patchRow(userId: string, rowId: string, input: { values: unknown; revision: number }) {
  const { collection: initial } = requireEditableRow(rowId, userId);
  return withCollectionLock(initial.id, () => {
    const { row, collection } = requireEditableRow(rowId, userId);
    const schema = schemaOf(collection);
    if (row.revision !== input.revision) throw rowChanged(rowId, schema, userId);
    const base = readValues(schema, JSON.parse(row.values_json));
    const result = validateValues(schema, input.values, base, valueContext(userId), "update");
    if (!result.ok) throw invalidValues(result.fieldErrors);
    db.transaction(() => {
      const timestamp = now();
      const updated = db.query(`UPDATE collection_rows SET values_json = ?, prev_values_json = values_json, prev_revision = revision, revision = revision + 1,
          updated_by = ?, updated_via_key_id = NULL, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL`)
        .run(JSON.stringify(result.values), userId, timestamp, rowId, input.revision);
      if (updated.changes !== 1) throw new Error("Concurrent row update detected");
      db.query("UPDATE collections SET updated_at = ? WHERE id = ?").run(timestamp, collection.id);
      rowHooks.afterWrite(rowId, collection);
      audit(userId, null, "collection.row_update", { collectionId: collection.id, rowId, fieldCount: Object.keys(input.values as object).length });
    })();
    return { row: rowDetail(rowId, schema, userId)! };
  });
}

/**
 * Restores the previous values (one step, D61). `revision` must be the current
 * one. The restored values are projected onto the current schema, so fields
 * removed since are not brought back.
 */
export async function undoRow(userId: string, rowId: string, input: { revision: number }) {
  const { collection: initial } = requireEditableRow(rowId, userId);
  return withCollectionLock(initial.id, () => {
    const { row, collection } = requireEditableRow(rowId, userId);
    const schema = schemaOf(collection);
    if (row.revision !== input.revision) throw rowChanged(rowId, schema, userId);
    if (row.prev_values_json === null) throw new CollectionError(409, "There is nothing to undo", "NOTHING_TO_UNDO");
    const restored = readValues(schema, JSON.parse(row.prev_values_json));
    db.transaction(() => {
      const timestamp = now();
      const updated = db.query(`UPDATE collection_rows SET values_json = ?, prev_values_json = NULL, prev_revision = NULL, revision = revision + 1,
          updated_by = ?, updated_via_key_id = NULL, updated_at = ? WHERE id = ? AND revision = ? AND deleted_at IS NULL`)
        .run(JSON.stringify(restored), userId, timestamp, rowId, input.revision);
      if (updated.changes !== 1) throw new Error("Concurrent row update detected");
      db.query("UPDATE collections SET updated_at = ? WHERE id = ?").run(timestamp, collection.id);
      rowHooks.afterWrite(rowId, collection);
      audit(userId, null, "collection.row_undo", { collectionId: collection.id, rowId });
    })();
    return { row: rowDetail(rowId, schema, userId)! };
  });
}

/** Moves a row to the Bin (any editor). It keeps its position for a restore. */
export async function deleteRow(userId: string, rowId: string) {
  const { collection: initial } = requireEditableRow(rowId, userId);
  return withCollectionLock(initial.id, () => {
    const { collection } = requireEditableRow(rowId, userId);
    const deletedAt = new Date();
    const purgeAfter = purgeAfterFrom(deletedAt);
    db.transaction(() => {
      db.query("UPDATE collection_rows SET deleted_at = ?, deleted_by = ?, purge_after = ? WHERE id = ? AND deleted_at IS NULL")
        .run(deletedAt.toISOString(), userId, purgeAfter, rowId);
      db.query("UPDATE collections SET updated_at = ? WHERE id = ?").run(deletedAt.toISOString(), collection.id);
      audit(userId, null, "collection.row_delete", { collectionId: collection.id, rowId });
    })();
    return { ok: true as const, purgeAfter };
  });
}

// ---------------------------------------------------------------------------
// Query

export type QueryInput = QuerySpec & { viewId?: string; cursor?: string; limit?: number };

/** The spec a query runs with: the request's sort/filters/q, falling back to the saved view's. */
function effectiveSpec(collectionId: string, input: QueryInput) {
  if (!input.viewId) return { spec: { sort: input.sort, filters: input.filters, q: input.q } as QuerySpec, viewSpec: null as QuerySpec | null };
  const view = db.query("SELECT config_json FROM collection_views WHERE id = ? AND collection_id = ?").get(input.viewId, collectionId) as { config_json: string } | null;
  if (!view) throw new CollectionError(404, "View not found");
  const config = JSON.parse(view.config_json) as QuerySpec;
  return { spec: { sort: input.sort ?? config.sort, filters: input.filters ?? config.filters, q: input.q } as QuerySpec, viewSpec: config };
}

function compile(schema: CollectionSchema, spec: QuerySpec, viewSpec: QuerySpec | null) {
  try {
    // Clauses from a saved view may name fields removed since; those are dropped.
    const fromView = viewSpec !== null && spec.sort === viewSpec.sort && spec.filters === viewSpec.filters;
    return compileQuery(schema, spec, fromView ? "lenient" : "strict");
  } catch (error) {
    if (error instanceof QueryError) throw new CollectionError(400, error.message, "INVALID_QUERY");
    throw error;
  }
}

/** Row ids matching a spec, in order, for exports (bounded by the row cap). */
export function matchingRows(collection: CollectionRecord, input: QueryInput) {
  const schema = schemaOf(collection);
  const { spec, viewSpec } = effectiveSpec(collection.id, input);
  const compiled = compile(schema, spec, viewSpec);
  const rows = db.query(`${rowSelect} WHERE r.collection_id = ? AND r.deleted_at IS NULL AND ${compiled.where} ORDER BY ${compiled.orderBy} LIMIT ?`)
    .all(collection.id, ...compiled.whereParams, ...compiled.orderParams, LIMITS.liveRowsPerCollection) as RowWithNames[];
  return { schema, rows };
}

export function queryRows(userId: string, collectionId: string, input: QueryInput) {
  const collection = requireReadableCollection(collectionId, userId);
  const schema = schemaOf(collection);
  const { spec, viewSpec } = effectiveSpec(collectionId, input);
  const key = specKey({ ...spec, viewId: input.viewId ?? null });
  let offset = 0;
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    if (!cursor || cursor.key !== key) throw new CollectionError(400, "Invalid cursor", "INVALID_CURSOR");
    if (cursor.schemaVersion !== collection.schema_version) {
      throw new CollectionError(409, "The fields changed. Reload to continue.", "SCHEMA_CHANGED", { schemaVersion: collection.schema_version });
    }
    offset = cursor.offset;
  }
  const limit = input.limit ?? QUERY_LIMITS.defaultPageSize;
  const compiled = compile(schema, spec, viewSpec);
  const base = `FROM collection_rows r WHERE r.collection_id = ? AND r.deleted_at IS NULL AND ${compiled.where}`;
  const rows = db.query(`${rowSelect} WHERE r.collection_id = ? AND r.deleted_at IS NULL AND ${compiled.where}
    ORDER BY ${compiled.orderBy} LIMIT ? OFFSET ?`).all(collectionId, ...compiled.whereParams, ...compiled.orderParams, limit + 1, offset) as RowWithNames[];
  const total = (db.query(`SELECT COUNT(*) AS count ${base}`).get(collectionId, ...compiled.whereParams) as { count: number }).count;
  const page = rows.slice(0, limit);
  const nextOffset = offset + page.length;
  return {
    rows: presentRows(schema, page, userId),
    nextCursor: rows.length > limit && nextOffset <= 10_000 ? encodeCursor({ schemaVersion: collection.schema_version, offset: nextOffset, key }) : null,
    schemaVersion: collection.schema_version,
    total
  };
}
