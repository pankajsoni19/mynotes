import type { Migration } from "./types";
import { addColumn } from "./types";

export const totpRecoveryCodesMigration: Migration = {
  id: 4,
  name: "totp-recovery-codes",
  up(db) {
    addColumn(db, "users", "totp_recovery_codes", "TEXT");
  }
};
