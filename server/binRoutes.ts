import type { Context, Hono } from "hono";
import type { AppEnv } from "./auth";
import { emptyBin, isBinType, listBin, purgeOwnedItem, restoreItem } from "./bin";
import { uuid } from "./validation";

const invalidType = (c: Context<AppEnv>) => c.json({ error: "Invalid request", details: ["type must be note, document, calendar, or event"] }, 400);
const notFound = (c: Context<AppEnv>) => c.json({ error: "Item not found" }, 404);

/** Bin API (docs/plan/API_CONTRACTS.md § Bin). Every endpoint is scoped to the caller's own items. */
export function registerBinRoutes(app: Hono<AppEnv>) {
  app.get("/api/bin", (c) => {
    const type = c.req.query("type");
    if (type !== undefined && !isBinType(type)) return invalidType(c);
    return c.json({ items: listBin(c.get("user").id, type ?? null) });
  });

  app.post("/api/bin/:type/:id/restore", async (c) => {
    const type = c.req.param("type");
    if (!isBinType(type)) return invalidType(c);
    const id = uuid.parse(c.req.param("id"));
    const outcome = await restoreItem(type, id, c.get("user").id);
    switch (outcome.status) {
      case "restored":
        return c.json({ ok: true, folderId: outcome.folderId, folderName: outcome.folderName, visibility: outcome.visibility });
      case "already_restored":
        return c.json({ ok: true, alreadyRestored: true, folderId: outcome.folderId, folderName: outcome.folderName });
      case "calendar_restored":
        return c.json({ ok: true, ...(outcome.alreadyRestored ? { alreadyRestored: true } : {}), calendarId: outcome.calendarId, calendarName: outcome.calendarName });
      case "purging":
        return c.json({ error: "This item is being permanently deleted", code: "PURGING" }, 409);
      case "parent_in_bin":
        return c.json({ error: "Its calendar is in the Bin. Restore the calendar first.", code: "PARENT_IN_BIN" }, 409);
      case "limit":
        return c.json({ error: "You already have the most calendars allowed", code: "LIMIT_REACHED" }, 409);
      default:
        return notFound(c);
    }
  });

  app.delete("/api/bin/:type/:id", async (c) => {
    const type = c.req.param("type");
    if (!isBinType(type)) return invalidType(c);
    const id = uuid.parse(c.req.param("id"));
    const outcome = await purgeOwnedItem(type, id, c.get("user").id);
    if (outcome === "purged") return c.json({ ok: true });
    if (outcome === "pending") return c.json({ ok: true, pending: true }, 202);
    if (outcome === "live") return c.json({ error: "This item is not in the Bin", code: "NOT_IN_BIN" }, 409);
    return notFound(c);
  });

  app.delete("/api/bin", async (c) => c.json({ ok: true, ...await emptyBin(c.get("user").id) }));
}
