import type { Database } from "bun:sqlite";
import { initialMigration } from "./001_initial";
import { folderSharingMigration } from "./002_folder_sharing";
import { totpMigration } from "./003_totp";
import { totpRecoveryCodesMigration } from "./004_totp_recovery_codes";
import { mcpApiKeysMigration } from "./005_mcp_api_keys";

const migrations = [initialMigration, folderSharingMigration, totpMigration, totpRecoveryCodesMigration, mcpApiKeysMigration];

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
