import { createHash, randomBytes } from "node:crypto";
import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { config, isEmailAllowed, isOriginAllowed } from "./config";
import { audit, db, now } from "./db";
import { registerMcpTools, type McpKeyContext } from "./mcpTools";
import { parseStoredScopes } from "./mcpScopes";
import { HTTPException } from "hono/http-exception";
import { boundedRequest } from "./validation";

type McpKeyRow = {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  scopes: string;
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

const mcpHandler = createMcpHandler(({ authInfo }) => {
  const server = new McpServer({ name: "nook", version: config.appVersion });
  const key = authInfo?.extra?.key as McpKeyContext | undefined;
  if (key) registerMcpTools(server, key);
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
  const allowedHosts = new Set<string>();
  for (const allowedOrigin of config.appOrigins) {
    const appUrl = new URL(allowedOrigin);
    allowedHosts.add(appUrl.host);
    if (["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname)) {
      const port = appUrl.port ? `:${appUrl.port}` : "";
      allowedHosts.add(`localhost${port}`);
      allowedHosts.add(`127.0.0.1${port}`);
      allowedHosts.add(`[::1]${port}`);
    }
  }
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !allowedHosts.has(host)) return mcpJsonError("Invalid host", 403);
  if (origin && !isOriginAllowed(origin)) return mcpJsonError("Invalid origin", 403);

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(authorization);
  if (!match) {
    const limited = recordInvalidAuth();
    return mcpJsonError(limited ? "Too many authentication failures" : "A valid Bearer API key is required", limited ? 429 : 401, true);
  }
  const token = match[1]!;
  const key = db.query(`
    SELECT k.id, k.user_id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.scopes, u.email
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
    let bounded: Request;
    try {
      bounded = await boundedRequest(request);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 413) return mcpJsonError("Request is too large", 413);
      throw error;
    }
    const scopes = parseStoredScopes(key.scopes);
    const context: McpKeyContext = { keyId: key.id, userId: key.user_id, name: key.name, scopes };
    const authInfo: AuthInfo = { token, clientId: key.user_id, scopes, extra: { key: context } };
    const response = await mcpHandler.fetch(bounded, { authInfo });
    return mcpResponse(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    activeRequests -= 1;
  }
}
