import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { config } from "./config";
import { audit, db, now, type NoteRow, type UserRow } from "./db";
import { createSession, logoutCurrentSession, requireAuth, requireMutationSafety, type AppEnv } from "./auth";
import { ownedNote, readableNote } from "./access";
import { checksum, storage } from "./storage";
import {
  draftSchema,
  folderSchema,
  loginSchema,
  noteCreateSchema,
  noteMetaSchema,
  parseJson,
  registerSchema,
  sharingSchema,
  uuid
} from "./validation";

const app = new Hono<AppEnv>();

app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'none'"],
    frameAncestors: ["'none'"]
  },
  referrerPolicy: "no-referrer",
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY"
}));

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

const authAttempts = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string) {
  const time = Date.now();
  const item = authAttempts.get(key);
  if (!item || item.resetAt <= time) {
    authAttempts.set(key, { count: 1, resetAt: time + 60_000 });
    return false;
  }
  item.count += 1;
  return item.count > 10;
}

app.post("/api/auth/register", async (c) => {
  if (!config.allowRegistration) return c.json({ error: "Registration is disabled" }, 403);
  const key = `register:${c.req.header("x-real-ip") ?? "local"}`;
  if (rateLimited(key)) return c.json({ error: "Too many attempts. Try again soon." }, 429);
  const body = await parseJson(c.req.raw, registerSchema);
  const exists = db.query("SELECT id FROM users WHERE email = ?").get(body.email);
  if (exists) return c.json({ error: "An account with that email already exists" }, 409);
  const id = crypto.randomUUID();
  const passwordHash = await Bun.password.hash(body.password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
  db.query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, body.email, body.displayName, passwordHash, now());
  const csrfToken = await createSession(c, id);
  audit(id, null, "auth.register");
  return c.json({ user: { id, email: body.email, displayName: body.displayName }, csrfToken }, 201);
});

app.post("/api/auth/login", async (c) => {
  const key = `login:${c.req.header("x-real-ip") ?? "local"}`;
  if (rateLimited(key)) return c.json({ error: "Too many attempts. Try again soon." }, 429);
  const body = await parseJson(c.req.raw, loginSchema);
  const user = db.query("SELECT * FROM users WHERE email = ? AND disabled_at IS NULL").get(body.email) as UserRow | null;
  const valid = user ? await Bun.password.verify(body.password, user.password_hash) : false;
  if (!user || !valid) {
    audit(user?.id ?? null, null, "auth.login_failed");
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const csrfToken = await createSession(c, user.id);
  audit(user.id, null, "auth.login");
  return c.json({ user: { id: user.id, email: user.email, displayName: user.display_name }, csrfToken });
});

app.use("/api/auth/me", requireAuth);
app.get("/api/auth/me", (c) => {
  const user = c.get("user");
  return c.json({ user: { id: user.id, email: user.email, displayName: user.display_name }, csrfToken: c.get("csrfToken") });
});

app.use("/api/*", async (c, next) => {
  if (["/api/health", "/api/auth/login", "/api/auth/register"].includes(c.req.path)) return next();
  return requireAuth(c, next);
});
app.use("/api/*", requireMutationSafety);

app.post("/api/auth/logout", (c) => {
  logoutCurrentSession(c);
  return c.json({ ok: true });
});

app.get("/api/users", (c) => {
  const currentUser = c.get("user");
  const users = db.query("SELECT id, email, display_name FROM users WHERE id != ? AND disabled_at IS NULL ORDER BY display_name LIMIT 100")
    .all(currentUser.id) as Array<{ id: string; email: string; display_name: string }>;
  return c.json({ users: users.map((user) => ({ id: user.id, email: user.email, displayName: user.display_name })) });
});

app.get("/api/folders", (c) => {
  const rows = db.query("SELECT id, parent_id, name, created_at, updated_at FROM folders WHERE owner_id = ? ORDER BY name COLLATE NOCASE")
    .all(c.get("user").id);
  return c.json({ folders: rows });
});

app.post("/api/folders", async (c) => {
  const body = await parseJson(c.req.raw, folderSchema);
  const userId = c.get("user").id;
  if (body.parentId && !db.query("SELECT id FROM folders WHERE id = ? AND owner_id = ?").get(body.parentId, userId)) {
    return c.json({ error: "Parent folder not found" }, 404);
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  db.query("INSERT INTO folders (id, owner_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, userId, body.parentId ?? null, body.name, timestamp, timestamp);
  return c.json({ folder: { id, parent_id: body.parentId ?? null, name: body.name, created_at: timestamp, updated_at: timestamp } }, 201);
});

app.patch("/api/folders/:id", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const body = await parseJson(c.req.raw, folderSchema.partial().strict());
  const userId = c.get("user").id;
  const folder = db.query("SELECT id FROM folders WHERE id = ? AND owner_id = ?").get(id, userId);
  if (!folder) return c.json({ error: "Folder not found" }, 404);
  if (body.parentId === id) return c.json({ error: "A folder cannot contain itself" }, 400);
  if (body.parentId && !db.query("SELECT id FROM folders WHERE id = ? AND owner_id = ?").get(body.parentId, userId)) {
    return c.json({ error: "Parent folder not found" }, 404);
  }
  db.query("UPDATE folders SET name = COALESCE(?, name), parent_id = CASE WHEN ? THEN ? ELSE parent_id END, updated_at = ? WHERE id = ?")
    .run(body.name ?? null, Object.hasOwn(body, "parentId") ? 1 : 0, body.parentId ?? null, now(), id);
  return c.json({ ok: true });
});

app.delete("/api/folders/:id", (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  const result = db.query("DELETE FROM folders WHERE id = ? AND owner_id = ?").run(id, userId);
  return result.changes ? c.json({ ok: true }) : c.json({ error: "Folder not found" }, 404);
});

app.get("/api/notes", (c) => {
  const userId = c.get("user").id;
  const folderId = c.req.query("folderId");
  if (folderId) uuid.parse(folderId);
  const params: Array<string> = [userId, userId];
  let folderClause = "";
  if (folderId) {
    folderClause = " AND n.folder_id = ?";
    params.push(folderId);
  }
  const rows = db.query(`
    SELECT n.id, n.owner_id, n.folder_id, n.title, n.visibility, n.current_version,
           n.draft_revision, n.created_at, n.updated_at, u.display_name AS owner_name,
           CASE WHEN n.owner_id = ? THEN 1 ELSE 0 END AS is_owner
    FROM notes n JOIN users u ON u.id = n.owner_id
    WHERE n.deleted_at IS NULL AND (
      n.owner_id = ? OR n.visibility = 'all_users' OR EXISTS (
        SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = ?
      )
    )${folderClause}
    ORDER BY n.updated_at DESC LIMIT 500
  `).all(...(folderId ? [userId, userId, userId, folderId] : [userId, userId, userId]));
  return c.json({ notes: rows });
});

app.post("/api/notes", async (c) => {
  const body = await parseJson(c.req.raw, noteCreateSchema);
  const userId = c.get("user").id;
  if (body.folderId && !db.query("SELECT id FROM folders WHERE id = ? AND owner_id = ?").get(body.folderId, userId)) {
    return c.json({ error: "Folder not found" }, 404);
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  await storage.writeDraft(id, "");
  db.query("INSERT INTO notes (id, owner_id, folder_id, title, draft_revision, draft_checksum, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)")
    .run(id, userId, body.folderId ?? null, body.title, checksum(""), timestamp, timestamp);
  audit(userId, id, "note.create");
  return c.json({ note: { id, title: body.title, folder_id: body.folderId ?? null, current_version: 0, draft_revision: 1 } }, 201);
});

app.get("/api/notes/:id", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  const note = readableNote(id, userId);
  if (!note) return c.json({ error: "Note not found" }, 404);
  const isOwner = note.owner_id === userId;
  const markdown = isOwner && note.draft_revision !== null ? await storage.readDraft(id) : await storage.readCurrent(id);
  return c.json({
    note: {
      ...note,
      isOwner,
      hasDraft: note.draft_revision !== null,
      markdown
    }
  });
});

app.patch("/api/notes/:id", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  if (!ownedNote(id, userId)) return c.json({ error: "Note not found" }, 404);
  const body = await parseJson(c.req.raw, noteMetaSchema);
  if (body.folderId && !db.query("SELECT id FROM folders WHERE id = ? AND owner_id = ?").get(body.folderId, userId)) {
    return c.json({ error: "Folder not found" }, 404);
  }
  db.query("UPDATE notes SET title = COALESCE(?, title), folder_id = CASE WHEN ? THEN ? ELSE folder_id END, updated_at = ? WHERE id = ?")
    .run(body.title ?? null, Object.hasOwn(body, "folderId") ? 1 : 0, body.folderId ?? null, now(), id);
  return c.json({ ok: true });
});

app.put("/api/notes/:id/draft", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  const note = ownedNote(id, userId);
  if (!note) return c.json({ error: "Note not found" }, 404);
  const body = await parseJson(c.req.raw, draftSchema);
  if (Buffer.byteLength(body.markdown, "utf8") > config.maxMarkdownBytes) return c.json({ error: "Note is too large" }, 413);
  if (body.revision !== note.draft_revision) {
    return c.json({ error: "Draft changed in another session", currentRevision: note.draft_revision }, 409);
  }
  const nextRevision = (note.draft_revision ?? 0) + 1;
  await storage.writeDraft(id, body.markdown);
  db.query("UPDATE notes SET title = ?, draft_revision = ?, draft_checksum = ?, updated_at = ? WHERE id = ?")
    .run(body.title, nextRevision, checksum(body.markdown), now(), id);
  return c.json({ revision: nextRevision, savedAt: now() });
});

app.delete("/api/notes/:id/draft", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  const note = ownedNote(id, userId);
  if (!note) return c.json({ error: "Note not found" }, 404);
  await storage.discardDraft(id);
  if (note.current_version === 0) {
    db.query("UPDATE notes SET deleted_at = ?, draft_revision = NULL, draft_checksum = NULL WHERE id = ?").run(now(), id);
  } else {
    const versionTitle = db.query("SELECT title FROM note_versions WHERE note_id = ? AND version_number = ?").get(id, note.current_version) as { title: string } | null;
    db.query("UPDATE notes SET title = ?, draft_revision = NULL, draft_checksum = NULL, updated_at = ? WHERE id = ?")
      .run(versionTitle?.title ?? note.title, now(), id);
  }
  audit(userId, id, "draft.discard");
  return c.json({ ok: true });
});

app.post("/api/notes/:id/publish", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  const note = ownedNote(id, userId);
  if (!note) return c.json({ error: "Note not found" }, 404);
  if (note.draft_revision === null) return c.json({ error: "There is no draft to publish" }, 409);
  const markdown = await storage.readDraft(id);
  const nextVersion = note.current_version + 1;
  await storage.publish(id, nextVersion, markdown);
  const timestamp = now();
  const versionId = crypto.randomUUID();
  db.transaction(() => {
    db.query("INSERT INTO note_versions (id, note_id, version_number, title, checksum, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(versionId, id, nextVersion, note.title, checksum(markdown), userId, timestamp);
    db.query("UPDATE notes SET current_version = ?, draft_revision = NULL, draft_checksum = NULL, updated_at = ? WHERE id = ?")
      .run(nextVersion, timestamp, id);
  })();
  audit(userId, id, "note.publish", { version: nextVersion });
  return c.json({ version: nextVersion, publishedAt: timestamp });
});

app.get("/api/notes/:id/versions", (c) => {
  const id = uuid.parse(c.req.param("id"));
  const note = readableNote(id, c.get("user").id);
  if (!note) return c.json({ error: "Note not found" }, 404);
  const versions = db.query(`
    SELECT v.id, v.version_number, v.title, v.checksum, v.created_at, u.display_name AS author_name
    FROM note_versions v JOIN users u ON u.id = v.author_id
    WHERE v.note_id = ? ORDER BY v.version_number DESC
  `).all(id);
  return c.json({ versions });
});

app.get("/api/notes/:id/versions/:version", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const version = Number(c.req.param("version"));
  if (!Number.isSafeInteger(version) || version < 1) return c.json({ error: "Invalid version" }, 400);
  const note = readableNote(id, c.get("user").id);
  if (!note) return c.json({ error: "Note not found" }, 404);
  const metadata = db.query("SELECT id, version_number, title, checksum, created_at FROM note_versions WHERE note_id = ? AND version_number = ?").get(id, version);
  if (!metadata) return c.json({ error: "Version not found" }, 404);
  return c.json({ version: metadata, markdown: await storage.readVersion(id, version) });
});

app.post("/api/notes/:id/versions/:version/restore", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const version = Number(c.req.param("version"));
  if (!Number.isSafeInteger(version) || version < 1) return c.json({ error: "Invalid version" }, 400);
  const userId = c.get("user").id;
  const note = ownedNote(id, userId);
  if (!note) return c.json({ error: "Note not found" }, 404);
  const metadata = db.query("SELECT title FROM note_versions WHERE note_id = ? AND version_number = ?").get(id, version) as { title: string } | null;
  if (!metadata) return c.json({ error: "Version not found" }, 404);
  const markdown = await storage.readVersion(id, version);
  await storage.writeDraft(id, markdown);
  const revision = (note.draft_revision ?? 0) + 1;
  db.query("UPDATE notes SET title = ?, draft_revision = ?, draft_checksum = ?, updated_at = ? WHERE id = ?")
    .run(metadata.title, revision, checksum(markdown), now(), id);
  audit(userId, id, "version.restore_to_draft", { version });
  return c.json({ revision });
});

app.get("/api/notes/:id/sharing", (c) => {
  const id = uuid.parse(c.req.param("id"));
  const note = ownedNote(id, c.get("user").id);
  if (!note) return c.json({ error: "Note not found" }, 404);
  const users = db.query("SELECT u.id, u.email, u.display_name FROM note_shares s JOIN users u ON u.id = s.user_id WHERE s.note_id = ? ORDER BY u.display_name")
    .all(id);
  return c.json({ visibility: note.visibility, users });
});

app.put("/api/notes/:id/sharing", async (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  const note = ownedNote(id, userId);
  if (!note) return c.json({ error: "Note not found" }, 404);
  const body = await parseJson(c.req.raw, sharingSchema);
  if (body.userIds.includes(userId)) return c.json({ error: "The owner cannot be added as a recipient" }, 400);
  const uniqueIds = [...new Set(body.userIds)];
  if (body.visibility === "selected" && uniqueIds.length === 0) return c.json({ error: "Select at least one user" }, 400);
  if (uniqueIds.length) {
    const placeholders = uniqueIds.map(() => "?").join(",");
    const validUsers = db.query(`SELECT id FROM users WHERE disabled_at IS NULL AND id IN (${placeholders})`).all(...uniqueIds);
    if (validUsers.length !== uniqueIds.length) return c.json({ error: "One or more users were not found" }, 400);
  }
  db.transaction(() => {
    db.query("DELETE FROM note_shares WHERE note_id = ?").run(id);
    if (body.visibility === "selected") {
      const statement = db.query("INSERT INTO note_shares (note_id, user_id, created_at) VALUES (?, ?, ?)");
      for (const recipientId of uniqueIds) statement.run(id, recipientId, now());
    }
    db.query("UPDATE notes SET visibility = ?, updated_at = ? WHERE id = ?").run(body.visibility, now(), id);
  })();
  audit(userId, id, "note.sharing_changed", { visibility: body.visibility, recipientCount: uniqueIds.length });
  return c.json({ ok: true });
});

app.delete("/api/notes/:id", (c) => {
  const id = uuid.parse(c.req.param("id"));
  const userId = c.get("user").id;
  const result = db.query("UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
    .run(now(), now(), id, userId);
  if (!result.changes) return c.json({ error: "Note not found" }, 404);
  audit(userId, id, "note.delete");
  return c.json({ ok: true });
});

app.onError((error, c) => {
  if (error instanceof ZodError) return c.json({ error: "Invalid request", details: error.issues.map((issue) => issue.message) }, 400);
  if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
  console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
  return c.json({ error: "Something went wrong" }, 500);
});

if (config.isProduction) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" }));
}

export default {
  port: config.port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  maxRequestBodySize: 2_100_000
};

