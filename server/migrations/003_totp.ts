import type { Migration } from "./types";
import { addColumn } from "./types";

export const totpMigration: Migration = {
  id: 3,
  name: "totp",
  up(db) {
    addColumn(db, "users", "totp_secret", "TEXT");
    addColumn(db, "users", "totp_enabled_at", "TEXT");
    addColumn(db, "users", "totp_last_counter", "INTEGER");
  }
};
