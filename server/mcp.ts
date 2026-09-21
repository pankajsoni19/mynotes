import { createHash, randomBytes } from "node:crypto";
import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { config, isEmailAllowed } from "./config";
import { audit, db, now } from "./db";
import { readableNote } from "./access";
import { checksum, storage } from "./storage";
import { uuid } from "./validation";

type McpKeyRow = {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  email: string;
};

export const hashMcpToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createMcpApiKey(userId: string, name: string) {
  const token = `mynotes_${randomBytes(32).toString("base64url")}`;
  const row = {
    id: crypto.randomUUID(),
    userId,
    name,
    prefix: token.slice(0, 16),
    createdAt: now()
  };
  db.query("INSERT INTO mcp_api_keys (id, user_id, name, key_prefix, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.userId, row.name, row.prefix, hashMcpToken(token), row.createdAt);
  audit(userId, null, "mcp.key_created", { keyId: row.id, name });
  return { ...row, token };
}

export function listMcpApiKeys(userId: string) {
  return db.query(`
    SELECT id, name, key_prefix, created_at, last_used_at
    FROM mcp_api_keys WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(userId);
}

export function revokeMcpApiKey(userId: string, keyId: string) {
  const result = db.query("UPDATE mcp_api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(now(), keyId, userId);
  if (result.changes) audit(userId, null, "mcp.key_revoked", { keyId });
  return result.changes === 1;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function notesForUser(userId: string, query?: string) {
  const search = query?.trim().toLowerCase() ?? "";
  const notes = db.query(`
    SELECT n.id, v.title, n.current_version, n.updated_at, u.display_name AS owner_name,
           CASE WHEN n.owner_id = $userId THEN 1 ELSE 0 END AS is_owner
    FROM notes n JOIN users u ON u.id = n.owner_id LEFT JOIN folders f ON f.id = n.folder_id
    JOIN note_versions v ON v.note_id = n.id AND v.version_number = n.current_version
    WHERE n.deleted_at IS NULL AND n.current_version > 0 AND (
      n.owner_id = $userId OR (n.sharing_override = 1 AND (
        n.visibility = 'all_users' OR (n.visibility = 'selected' AND EXISTS (
          SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = $userId
        ))
      )) OR (n.sharing_override = 0 AND (
        f.visibility = 'all_users' OR (f.visibility = 'selected' AND EXISTS (
          SELECT 1 FROM folder_shares fs WHERE fs.folder_id = f.id AND fs.user_id = $userId
        ))
      ))
    )
    ORDER BY n.updated_at DESC LIMIT 200
  `).all({ userId }) as Array<Record<string, unknown> & { title: string }>;
  return search ? notes.filter((note) => note.title.toLowerCase().includes(search)) : notes;
}

const mcpHandler = createMcpHandler(({ authInfo }) => {
  const userId = authInfo?.clientId;
  const server = new McpServer({ name: "mynotes", version: config.appVersion });

  server.registerTool("list_notes", {
    title: "List notes",
    description: "List the published notes the authenticated MyNotes user can read. Draft content is never returned.",
    inputSchema: z.object({ query: z.string().max(120).optional().describe("Optional case-insensitive title filter") }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ query }) => textResult({ notes: notesForUser(userId!, query) }));

  server.registerTool("read_note", {
    title: "Read a note",
    description: "Read the latest published Markdown for a note visible to the authenticated MyNotes user.",
    inputSchema: z.object({ noteId: z.string().uuid() }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ noteId }) => {
    const id = uuid.parse(noteId);
    const note = readableNote(id, userId!);
    if (!note || note.current_version < 1) return { ...textResult({ error: "Note not found or not published" }), isError: true };
    const version = db.query("SELECT title, checksum FROM note_versions WHERE note_id = ? AND version_number = ?")
      .get(id, note.current_version) as { title: string; checksum: string } | null;
    if (!version) return { ...textResult({ error: "Published version metadata is missing" }), isError: true };
    const markdown = await storage.readVersion(id, note.current_version);
    if (checksum(markdown) !== version.checksum) return { ...textResult({ error: "Note content failed integrity verification" }), isError: true };
    return textResult({ id: note.id, title: version.title, version: note.current_version, markdown });
  });
  return server;
}, { maxSubscriptions: 0 });

let invalidAuthCount = 0;
let invalidAuthResetAt = Date.now() + 60_000;
let activeRequests = 0;

function mcpResponse(body: BodyInit | null, init: ResponseInit) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, private");
  headers.set("Vary", "Authorization");
  return new Response(body, { ...init, headers });
}

function mcpJsonError(error: string, status: number, authenticate = false) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authenticate) headers["WWW-Authenticate"] = "Bearer";
  return mcpResponse(JSON.stringify({ error }), { status, headers });
}

function recordInvalidAuth() {
  const time = Date.now();
  if (time >= invalidAuthResetAt) {
    invalidAuthCount = 0;
    invalidAuthResetAt = time + 60_000;
  }
  invalidAuthCount += 1;
  return invalidAuthCount > 60;
}

export async function handleMcpRequest(request: Request) {
  const appUrl = new URL(config.appOrigin);
  const expectedHost = appUrl.host;
  const localHosts = new Set([expectedHost]);
  if (["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname)) {
    const port = appUrl.port ? `:${appUrl.port}` : "";
    localHosts.add(`localhost${port}`);
    localHosts.add(`127.0.0.1${port}`);
    localHosts.add(`[::1]${port}`);
  }
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !localHosts.has(host)) return mcpJsonError("Invalid host", 403);
  if (origin && origin !== config.appOrigin) return mcpJsonError("Invalid origin", 403);

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(authorization);
  if (!match) {
    const limited = recordInvalidAuth();
    return mcpJsonError(limited ? "Too many authentication failures" : "A valid Bearer API key is required", limited ? 429 : 401, true);
  }
  const token = match[1]!;
  const key = db.query(`
    SELECT k.id, k.user_id, k.name, k.key_prefix, k.created_at, k.last_used_at, u.email
    FROM mcp_api_keys k JOIN users u ON u.id = k.user_id
    WHERE k.token_hash = ? AND k.revoked_at IS NULL AND u.disabled_at IS NULL
  `).get(hashMcpToken(token)) as McpKeyRow | null;
  if (!key || !isEmailAllowed(key.email)) {
    const limited = recordInvalidAuth();
    return mcpJsonError(limited ? "Too many authentication failures" : "Invalid or revoked API key", limited ? 429 : 401, true);
  }

  if (!key.last_used_at || Date.now() - new Date(key.last_used_at).getTime() > 300_000) {
    db.query("UPDATE mcp_api_keys SET last_used_at = ? WHERE id = ?").run(now(), key.id);
  }
  if (activeRequests >= 24) return mcpJsonError("MCP server is busy", 503);
  activeRequests += 1;
  try {
    const authInfo: AuthInfo = { token, clientId: key.user_id, scopes: ["notes:read"] };
    const response = await mcpHandler.fetch(request, { authInfo });
    return mcpResponse(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    activeRequests -= 1;
  }
}
