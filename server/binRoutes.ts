import type { Context, Hono } from "hono";
import type { AppEnv } from "./auth";
import { emptyBin, listBin, purgeOwnedItem, restoreItem, type BinListType } from "./bin";
import { isTaskBinType, purgeTaskItem, restoreTaskItem } from "./tasks/bin";
import { uuid } from "./validation";

const isBinType = (value: string | undefined): value is BinListType => value === "note" || value === "document" || value === "card" || value === "board";
const invalidType = (c: Context<AppEnv>) => c.json({ error: "Invalid request", details: ["type must be note, document, card, or board"] }, 400);
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
    if (isTaskBinType(type)) {
      const task = await restoreTaskItem(type, id, c.get("user").id);
      switch (task.status) {
        case "restored":
        case "already_restored":
          return c.json({ ok: true, ...(task.status === "already_restored" ? { alreadyRestored: true } : {}), boardId: task.boardId, boardName: task.boardName, columnId: task.columnId, columnName: task.columnName });
        case "board_in_bin":
          return c.json({ error: "Restore the board first", code: "BOARD_IN_BIN" }, 409);
        case "limit":
          return c.json({ error: "The board or your board list is full", code: "LIMIT_REACHED" }, 409);
        case "purging":
          return c.json({ error: "This item is being permanently deleted", code: "PURGING" }, 409);
        default:
          return notFound(c);
      }
    }
    const outcome = await restoreItem(type, id, c.get("user").id);
    switch (outcome.status) {
      case "restored":
        return c.json({ ok: true, folderId: outcome.folderId, folderName: outcome.folderName, visibility: outcome.visibility });
      case "already_restored":
        return c.json({ ok: true, alreadyRestored: true, folderId: outcome.folderId, folderName: outcome.folderName });
      case "purging":
        return c.json({ error: "This item is being permanently deleted", code: "PURGING" }, 409);
      default:
        return notFound(c);
    }
  });

  app.delete("/api/bin/:type/:id", async (c) => {
    const type = c.req.param("type");
    if (!isBinType(type)) return invalidType(c);
    const id = uuid.parse(c.req.param("id"));
    const outcome = isTaskBinType(type) ? await purgeTaskItem(type, id, c.get("user").id) : await purgeOwnedItem(type, id, c.get("user").id);
    if (outcome === "owner_only") return c.json({ error: "Only the board owner can delete this forever", code: "OWNER_ONLY" }, 403);
    if (outcome === "purged") return c.json({ ok: true });
    if (outcome === "pending") return c.json({ ok: true, pending: true }, 202);
    if (outcome === "live") return c.json({ error: "This item is not in the Bin", code: "NOT_IN_BIN" }, 409);
    return notFound(c);
  });

  app.delete("/api/bin", async (c) => c.json({ ok: true, ...await emptyBin(c.get("user").id) }));
}
