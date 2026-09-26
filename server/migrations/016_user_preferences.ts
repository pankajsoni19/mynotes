import type { Migration } from "./types";

/**
 * Per-user preferences (docs/plan/WAVE_13_TASK_CARD_UX.md §2.2, D92, D114).
 *
 * `disabled_modules` is a JSON array of module ids the user turned off in
 * Settings → Modules. There is no backfill: a missing row means every module is
 * on, so modules added later start on. The value only hides UI; it is never an
 * access rule (T97). `revision` is the compare-and-swap counter for PUT
 * /api/preferences and starts at 1 when the row is first written.
 *
 * Independent of migration 015 (the task card schema), so this sub-wave can
 * merge before or after it.
 */
export const userPreferencesMigration: Migration = {
  id: 16,
  name: "user_preferences",
  up(db) {
    db.exec(`
      CREATE TABLE user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        disabled_modules TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(disabled_modules) AND json_type(disabled_modules) = 'array' AND length(disabled_modules) <= 512),
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);
  }
};
