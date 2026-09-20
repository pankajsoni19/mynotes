import type { Migration } from "./types";
import { addColumn } from "./types";

export const folderSharingMigration: Migration = {
  id: 2,
  name: "folder-sharing-and-defaults",
  up(db) {
    addColumn(db, "folders", "is_default", "INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "folders", "visibility", "TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'selected', 'all_users'))");
    addColumn(db, "notes", "sharing_override", "INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_owner_default ON folders(owner_id) WHERE is_default = 1");
    db.exec("CREATE INDEX IF NOT EXISTS idx_folder_shares_user_folder ON folder_shares(user_id, folder_id)");
  }
};
