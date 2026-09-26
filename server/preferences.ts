import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./auth";
import { audit, db, now } from "./db";
import { parseJson } from "./validation";

/**
 * Per-user preferences (docs/plan/WAVE_13_TASK_CARD_UX.md §3, D92, D114): today only the modules a
 * user turned off in Settings → Modules. They hide UI and nothing else. Routes, ACLs, MCP, feeds,
 * reminders, and push never read them, so a hidden module is not a security boundary (T97).
 */

/**
 * Every module id a client may turn off. `team` is reserved for Wave 14 so its UI can plug in
 * without a server change. Keep in step with `MODULE_IDS` in src/modules.ts (tests/modules.test.ts).
 */
export const MODULE_IDS = ["notes", "files", "tasks", "collections", "calendar", "search", "bin", "notifications", "team"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export type Preferences = { disabledModules: ModuleId[]; revision: number; updatedAt: string | null };

const knownModule = (value: unknown): value is ModuleId => typeof value === "string" && (MODULE_IDS as readonly string[]).includes(value);

/** Unique known ids in registry order, so the stored JSON is canonical (and far below the 512-byte CHECK). */
function canonical(ids: readonly string[]): ModuleId[] {
  return MODULE_IDS.filter((id) => ids.includes(id));
}

export const preferencesPutSchema = z.object({
  disabledModules: z.array(z.enum(MODULE_IDS)).max(MODULE_IDS.length)
    .refine((values) => new Set(values).size === values.length, "Module ids must be unique"),
  /** The revision the client last saw; 0 when it has never been saved. */
  revision: z.number().int().nonnegative()
}).strict();

type PreferencesRow = { disabled_modules: string; revision: number; updated_at: string };

/** A missing row means every module is on (revision 0). Ids that are no longer known are dropped on read. */
export function readPreferences(userId: string): Preferences {
  const row = db.query("SELECT disabled_modules, revision, updated_at FROM user_preferences WHERE user_id = ?").get(userId) as PreferencesRow | null;
  if (!row) return { disabledModules: [], revision: 0, updatedAt: null };
  let stored: unknown = [];
  try { stored = JSON.parse(row.disabled_modules); } catch { /* the CHECK keeps it valid JSON */ }
  const ids = Array.isArray(stored) ? stored.filter(knownModule) : [];
  return { disabledModules: canonical(ids), revision: row.revision, updatedAt: row.updated_at };
}

export type PreferencesWrite = { ok: true; preferences: Preferences } | { ok: false; current: Preferences };

/** Compare-and-swap on `revision`: exactly one of two writers with the same base revision wins. */
export function writePreferences(userId: string, disabledModules: readonly ModuleId[], baseRevision: number): PreferencesWrite {
  const value = JSON.stringify(canonical(disabledModules));
  const timestamp = now();
  return db.transaction((): PreferencesWrite => {
    const changes = baseRevision === 0
      ? db.query("INSERT OR IGNORE INTO user_preferences (user_id, disabled_modules, revision, updated_at) VALUES (?, ?, 1, ?)").run(userId, value, timestamp).changes
      : db.query("UPDATE user_preferences SET disabled_modules = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?").run(value, timestamp, userId, baseRevision).changes;
    const preferences = readPreferences(userId);
    if (changes === 0) return { ok: false, current: preferences };
    audit(userId, null, "preferences.update", { disabledModules: preferences.disabledModules, revision: preferences.revision });
    return { ok: true, preferences };
  })();
}

export function registerPreferenceRoutes(app: Hono<AppEnv>) {
  app.get("/api/preferences", (c) => c.json({ preferences: readPreferences(c.get("user").id) }));

  app.put("/api/preferences", async (c) => {
    const body = await parseJson(c.req.raw, preferencesPutSchema);
    const result = writePreferences(c.get("user").id, body.disabledModules, body.revision);
    if (!result.ok) return c.json({ error: "Your preferences changed in another window. Reload and try again.", code: "PREFERENCES_CHANGED", preferences: result.current }, 409);
    return c.json({ preferences: result.preferences });
  });
}
