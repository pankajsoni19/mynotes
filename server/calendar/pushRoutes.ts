import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import { parseJson, uuid } from "../validation";
import { listSubscriptions, PushError, pushConfig, sendTest, subscribe, unsubscribeDevice } from "./push";

const base64urlText = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/, "Keys are base64url");
const controlCharacters = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

/** The browser's PushSubscription.toJSON() plus a device label. */
export const subscriptionSchema = z.object({
  endpoint: z.string().min(1).max(1024),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: base64urlText(128), auth: base64urlText(64) }).strict(),
  label: z.string().trim().max(60).refine((value) => !controlCharacters.test(value), "Labels cannot contain control characters").optional()
}).strict();
export const unsubscribeSchema = z.union([z.object({ id: uuid }).strict(), z.object({ endpoint: z.string().min(1).max(1024) }).strict()]);

async function respond(c: Context<AppEnv>, operation: () => unknown, status: 200 | 201 = 200) {
  try {
    const result = await operation() as Record<string, unknown> & { status?: 200 | 201 };
    if (result.status === 200 || result.status === 201) {
      const { status: code, ...body } = result;
      return c.json(body, code);
    }
    return c.json(result, status);
  } catch (error) {
    if (error instanceof PushError) {
      if (error.retryAfter) c.header("Retry-After", String(error.retryAfter));
      return c.json(error.body(), error.status);
    }
    throw error;
  }
}

/** docs/plan/API_CONTRACTS.md § Web Push. Session-authenticated and scoped to the caller. */
export function registerPushRoutes(app: Hono<AppEnv>) {
  app.get("/api/push/config", (c) => c.json(pushConfig()));

  app.get("/api/push/subscriptions", (c) => c.json(listSubscriptions(c.get("user").id)));

  app.post("/api/push/subscriptions", async (c) => {
    const body = await parseJson(c.req.raw, subscriptionSchema);
    return respond(c, () => subscribe(c.get("user").id, { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, label: body.label || "This device" }));
  });

  app.delete("/api/push/subscriptions", async (c) => {
    const body = await parseJson(c.req.raw, unsubscribeSchema);
    return respond(c, () => unsubscribeDevice(c.get("user").id, "id" in body ? { id: body.id.toLowerCase() } : { endpoint: body.endpoint }));
  });

  app.post("/api/push/test", (c) => respond(c, () => sendTest(c.get("user").id)));
}
