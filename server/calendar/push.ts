import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { config } from "../config";
import { audit, db } from "../db";
import { readPrivateFile, writePrivateFileAtomic } from "../storage";
import { onNotification, type NotificationCreated } from "./reminders";

/**
 * Payload-less Web Push (WAVES_10-12.md D65, §4.3, T62, T63).
 *
 * A push carries no body, so push services never see content and no RFC 8291 encryption is
 * needed: the service worker wakes up and fetches /api/notifications?unread=1 with the session
 * cookie. Requests are authorised with a VAPID (RFC 8292) ES256 JWT built here on WebCrypto.
 * Endpoints must be https on 443 at an allowlisted push-service host, never an IP literal, and
 * must not resolve to a private address; delivery follows no redirects and times out after 5 s.
 */

export const MAX_SUBSCRIPTIONS_PER_USER = 10;
export const MAX_FAILURES = 5;
export const PUSH_TTL_SECONDS = 3600;
export const PUSH_TIMEOUT_MS = 5000;
export const TEST_PUSHES_PER_HOUR = 5;
const JWT_LIFETIME_S = 12 * 3600;
export const BUILT_IN_PUSH_HOSTS = ["*.googleapis.com", "*.push.services.mozilla.com", "*.push.apple.com", "*.notify.windows.com"];

export class PushError extends Error {
  constructor(public status: 400 | 404 | 409 | 429, message: string, public code?: string, public retryAfter?: number) {
    super(message);
  }

  body() {
    return { error: this.message, ...(this.code ? { code: this.code } : {}) };
  }
}

// ---------------------------------------------------------------------------
// base64url and VAPID keys

export const base64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
const fromBase64url = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));
const textBytes = (value: string) => new TextEncoder().encode(value);

export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

export async function createVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return { publicKey: base64url(raw), privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}

function validKeys(value: unknown): value is VapidKeys {
  if (!value || typeof value !== "object") return false;
  const keys = value as Partial<VapidKeys>;
  return typeof keys.publicKey === "string" && fromBase64url(keys.publicKey).length === 65 && !!keys.privateJwk && keys.privateJwk.kty === "EC" && keys.privateJwk.crv === "P-256" && typeof keys.privateJwk.d === "string";
}

/**
 * Loads DATA_DIR/push/vapid.json, creating it (0600, atomic) on first boot. If the file is lost,
 * a new pair is made and clients re-subscribe when they see a different publicKey.
 */
export async function loadOrCreateVapidKeys(directory = join(config.dataDir, "push")): Promise<VapidKeys> {
  const path = join(directory, "vapid.json");
  try {
    const parsed = JSON.parse(await readPrivateFile(path)) as unknown;
    if (validKeys(parsed)) return parsed;
    throw new Error("Stored VAPID keys are malformed");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const keys = await createVapidKeys();
  await writePrivateFileAtomic(path, `${JSON.stringify(keys)}\n`);
  return keys;
}

/** `vapid t=<JWT>, k=<public key>` for one push-service origin (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowMs = Date.now()) {
  const header = base64url(textBytes(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64url(textBytes(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + JWT_LIFETIME_S, sub: subject })));
  const privateKey = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto returns the raw r||s signature JWS expects for ES256.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, textBytes(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------------------
// Endpoint allowlist (T62)

function hostMatches(host: string, pattern: string) {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host.endsWith(`.${suffix}`) && host.length > suffix.length + 1;
  }
  return host === pattern;
}

export const allowedPushHosts = () => [...BUILT_IN_PUSH_HOSTS, ...config.pushEndpointHosts];

/** Private, loopback, link-local, CGNAT/Tailscale, multicast, and unspecified ranges. */
export function isPrivateAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff") || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8");
  }
  return true;
}

/** Network access, on an object so tests can replace DNS and fetch. */
export const pushNet = {
  resolve: async (host: string) => (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address),
  fetch: (url: string, init: RequestInit) => fetch(url, init)
};

/** The shape check alone: https, port 443, no credentials, not an IP literal, an allowlisted host. */
export function endpointShapeAllowed(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || (url.port !== "" && url.port !== "443") || url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.startsWith("[") || isIP(host) || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return false;
  return allowedPushHosts().some((pattern) => hostMatches(host, pattern));
}

/** Shape plus DNS: every address the host resolves to must be public. */
export async function endpointAllowed(endpoint: string) {
  if (!endpointShapeAllowed(endpoint)) return false;
  try {
    const addresses = await pushNet.resolve(new URL(endpoint).hostname);
    return addresses.length > 0 && addresses.every((address) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// State

export type PushReason = "insecure_origin" | "disabled";
export const pushState: { enabled: boolean; reason: PushReason | null; keys: VapidKeys | null } = { enabled: false, reason: "disabled", keys: null };

export function pushSetting(setting: "auto" | "true" | "false", appOrigin: string): { enabled: boolean; reason: PushReason | null } {
  if (setting === "false") return { enabled: false, reason: "disabled" };
  if (setting === "auto" && !appOrigin.startsWith("https://")) return { enabled: false, reason: "insecure_origin" };
  return { enabled: true, reason: null };
}

let unsubscribe: (() => void) | null = null;

/** Boot: decides whether push is on, loads or creates the VAPID keys, and hooks delivery to the dispatcher. */
export async function initPush(options: { setting?: "auto" | "true" | "false"; keys?: VapidKeys } = {}) {
  const setting = pushSetting(options.setting ?? config.pushEnabled, config.appOrigin);
  pushState.enabled = setting.enabled;
  pushState.reason = setting.reason;
  pushState.keys = setting.enabled ? options.keys ?? await loadOrCreateVapidKeys() : null;
  unsubscribe?.();
  unsubscribe = setting.enabled ? onNotification((created) => { void deliverNotifications(created); }) : null;
}

export function pushConfig() {
  return pushState.enabled && pushState.keys ? { enabled: true, publicKey: pushState.keys.publicKey } : { enabled: false, reason: pushState.reason ?? "disabled" };
}

// ---------------------------------------------------------------------------
// Subscriptions

type SubscriptionRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; label: string; created_at: string; last_success_at: string | null; failure_count: number };
export type SubscriptionSummary = { id: string; label: string; createdAt: string; lastSuccessAt: string | null; disabled: boolean };

const summary = (row: SubscriptionRow): SubscriptionSummary => ({ id: row.id, label: row.label, createdAt: row.created_at, lastSuccessAt: row.last_success_at, disabled: row.failure_count >= MAX_FAILURES });

function requireEnabled() {
  if (!pushState.enabled) throw new PushError(409, "Push notifications are not available on this server", "PUSH_DISABLED");
}

export function listSubscriptions(userId: string) {
  const rows = db.query("SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at").all(userId) as SubscriptionRow[];
  return { subscriptions: rows.map(summary) };
}

export async function subscribe(userId: string, input: { endpoint: string; p256dh: string; auth: string; label: string }) {
  requireEnabled();
  if (!await endpointAllowed(input.endpoint)) throw new PushError(400, "This push service is not allowed", "ENDPOINT_NOT_ALLOWED");
  return db.transaction(() => {
    const existing = db.query("SELECT * FROM push_subscriptions WHERE endpoint = ?").get(input.endpoint) as SubscriptionRow | null;
    if (existing && existing.user_id === userId) {
      // Re-subscribing refreshes the keys and clears earlier failures.
      db.query("UPDATE push_subscriptions SET p256dh = ?, auth = ?, label = ?, failure_count = 0 WHERE id = ?").run(input.p256dh, input.auth, input.label, existing.id);
      return { status: 200 as const, subscription: summary(db.query("SELECT * FROM push_subscriptions WHERE id = ?").get(existing.id) as SubscriptionRow) };
    }
    const count = (db.query("SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?").get(userId) as { count: number }).count;
    if (count >= MAX_SUBSCRIPTIONS_PER_USER) throw new PushError(409, `You can enable push on at most ${MAX_SUBSCRIPTIONS_PER_USER} devices`, "LIMIT_REACHED");
    // An endpoint belongs to one browser; whoever signed in there last owns it.
    if (existing) db.query("DELETE FROM push_subscriptions WHERE id = ?").run(existing.id);
    const id = crypto.randomUUID();
    db.query("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, input.endpoint, input.p256dh, input.auth, input.label, new Date().toISOString());
    audit(userId, null, "push.subscribe", { subscriptionId: id });
    return { status: 201 as const, subscription: summary(db.query("SELECT * FROM push_subscriptions WHERE id = ?").get(id) as SubscriptionRow) };
  })();
}

export function unsubscribeDevice(userId: string, target: { id: string } | { endpoint: string }) {
  const result = "id" in target
    ? db.query("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?").run(target.id, userId)
    : db.query("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(target.endpoint, userId);
  if (result.changes !== 1) throw new PushError(404, "Device not found");
  audit(userId, null, "push.unsubscribe", {});
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Delivery

export type DeliveryOutcome = "sent" | "gone" | "failed" | "skipped";

/** One empty push. 404/410 deletes the subscription; other failures count toward disabling it. */
export async function sendPush(row: SubscriptionRow, nowMs = Date.now()): Promise<DeliveryOutcome> {
  if (!pushState.enabled || !pushState.keys || row.failure_count >= MAX_FAILURES) return "skipped";
  let status = 0;
  try {
    if (!await endpointAllowed(row.endpoint)) throw new Error("Endpoint not allowed");
    const response = await pushNet.fetch(row.endpoint, {
      method: "POST",
      headers: { TTL: String(PUSH_TTL_SECONDS), Urgency: "normal", Authorization: await vapidAuthorization(row.endpoint, pushState.keys, config.pushSubject, nowMs), "Content-Length": "0" },
      redirect: "manual",
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
    });
    status = response.status;
    await response.body?.cancel().catch(() => undefined);
  } catch {
    status = 0;
  }
  if (status >= 200 && status < 300) {
    db.query("UPDATE push_subscriptions SET last_success_at = ?, failure_count = 0 WHERE id = ?").run(new Date(nowMs).toISOString(), row.id);
    return "sent";
  }
  if (status === 404 || status === 410) {
    db.query("DELETE FROM push_subscriptions WHERE id = ?").run(row.id);
    return "gone";
  }
  // Redirects (3xx with redirect: "manual"), timeouts, refused endpoints, and 5xx all count.
  db.query("UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?").run(row.id);
  return "failed";
}

async function sendToUser(userId: string) {
  const rows = db.query("SELECT * FROM push_subscriptions WHERE user_id = ? AND failure_count < ?").all(userId, MAX_FAILURES) as SubscriptionRow[];
  const outcomes = await Promise.all(rows.map((row) => sendPush(row)));
  return { sent: outcomes.filter((outcome) => outcome === "sent").length, failed: outcomes.filter((outcome) => outcome === "failed" || outcome === "gone").length };
}

/** Called after a dispatcher tick commits: one wake-up per user, whatever the number of notifications. */
export async function deliverNotifications(created: NotificationCreated[]) {
  for (const userId of new Set(created.map((item) => item.userId))) {
    try {
      await sendToUser(userId);
    } catch (error) {
      console.error("Push delivery failed", error instanceof Error ? error.name : "Unknown error");
    }
  }
}

const testSends = new Map<string, number[]>();

/** POST /api/push/test: at most 5 per user per hour. */
export async function sendTest(userId: string, nowMs = Date.now()) {
  requireEnabled();
  const recent = (testSends.get(userId) ?? []).filter((stamp) => stamp > nowMs - 3_600_000);
  if (recent.length >= TEST_PUSHES_PER_HOUR) throw new PushError(429, "Too many test notifications. Try again later.", "RATE_LIMITED", Math.ceil((recent[0]! + 3_600_000 - nowMs) / 1000));
  recent.push(nowMs);
  testSends.set(userId, recent);
  return { ok: true as const, ...await sendToUser(userId) };
}

/** Test hook. */
export function resetPushTestLimit() {
  testSends.clear();
}
