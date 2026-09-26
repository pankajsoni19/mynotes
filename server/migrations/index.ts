import type { Database } from "bun:sqlite";
import { initialMigration } from "./001_initial";
import { folderSharingMigration } from "./002_folder_sharing";
import { totpMigration } from "./003_totp";
import { totpRecoveryCodesMigration } from "./004_totp_recovery_codes";
import { mcpApiKeysMigration } from "./005_mcp_api_keys";
import { documentsMigration } from "./006_documents";
import { binMigration } from "./007_bin";
import { noteSearchMigration } from "./008_note_search";
import { taskBoardsMigration } from "./009_task_boards";
import { mcpKeyScopesMigration } from "./010_mcp_key_scopes";
import { taskDatesMigration } from "./011_task_dates";
import { collectionsMigration } from "./012_collections";
import { calendarMigration } from "./013_calendar";
import { eventNextOccurrenceMigration } from "./014_event_next_occurrence";
import { taskCardUxMigration } from "./015_task_card_ux";
import { userPreferencesMigration } from "./016_user_preferences";

const migrations = [initialMigration, folderSharingMigration, totpMigration, totpRecoveryCodesMigration, mcpApiKeysMigration, documentsMigration, binMigration, noteSearchMigration, taskBoardsMigration, mcpKeyScopesMigration, taskDatesMigration, collectionsMigration, calendarMigration, eventNextOccurrenceMigration, taskCardUxMigration, userPreferencesMigration];

/**
 * Ids of every registered migration, in order. Tests assert against this list.
 *
 * The ids may have gaps during development. Wave 13 fixes 015 (task card UX, sub-wave 13B) and
 * 016 (user preferences, 13F), and 017 onwards belong to Team (Wave 14), but the sub-waves merge
 * in any order, so an id can be missing here for a while (017 until Team lands). `runMigrations`
 * only needs the ids to ascend and applies each missing id on its own, so a database that already
 * has 016 still gets 015 when it lands (tests/migrations.test.ts). Releases are contiguous.
 */
export const registeredMigrationIds: readonly number[] = migrations.map((migration) => migration.id);

export function runMigrations(db: Database) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]!;
    if (index > 0 && migrations[index - 1]!.id >= migration.id) throw new Error("Database migrations must have unique ascending ids");
    if (db.query("SELECT id FROM schema_migrations WHERE id = ?").get(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, new Date().toISOString());
    })();
  }
}
