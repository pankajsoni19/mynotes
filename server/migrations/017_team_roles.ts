import { addColumn, type Migration } from "./types";

/**
 * Team roles, blocking, and the Team activity log (docs/plan/research/2026-09-26-team-module.md
 * §3 and §5.6, D71–D77). Id 017 was assigned by the director (§11): 015 and 016 belong to Wave 13
 * and may land before or after this one, so the registry tolerates the gap during development.
 *
 * - `users.role`: the platform role, a ceiling on what sharing grants (D71). Existing accounts become
 *   `member`; the oldest enabled account becomes `admin` (§3.3, O8).
 * - `users.disabled_at` (from 001) is the block timestamp (D74); `blocked_by` and `block_reason`
 *   record who blocked the account and why. Accounts disabled before this migration keep a NULL
 *   `blocked_by` ("Blocked (before Team)").
 * - `team_events` is append-only (T83). The only change a row accepts is `actor_id` becoming NULL
 *   through the `ON DELETE SET NULL` of a deleted actor, and rows go away only through the cascade
 *   from a deleted target.
 * - `users_keep_one_admin` and `users_keep_one_admin_delete` refuse any change that would leave no
 *   active admin (`role = 'admin' AND disabled_at IS NULL`), whatever the code path (T78).
 */
export const teamRolesMigration: Migration = {
  id: 17,
  name: "team_roles",
  up(db) {
    addColumn(db, "users", "role", "TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer','guest'))");
    addColumn(db, "users", "blocked_by", "TEXT REFERENCES users(id) ON DELETE SET NULL");
    addColumn(db, "users", "block_reason", "TEXT CHECK (block_reason IS NULL OR length(block_reason) <= 200)");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role) WHERE disabled_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS team_events (
        id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        via TEXT NOT NULL CHECK (via IN ('web','cli','migration','bootstrap','mcp')),
        action TEXT NOT NULL CHECK (action IN ('role_change','block','unblock','sessions_revoked','bootstrap_admin')),
        from_role TEXT CHECK (from_role IS NULL OR from_role IN ('admin','member','viewer','guest')),
        to_role TEXT CHECK (to_role IS NULL OR to_role IN ('admin','member','viewer','guest')),
        reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_events_target ON team_events(target_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_team_events_created ON team_events(created_at DESC);

      CREATE TRIGGER IF NOT EXISTS team_events_no_update BEFORE UPDATE ON team_events
      WHEN NOT (
        OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.actor_id)
        AND NEW.id = OLD.id AND NEW.target_user_id = OLD.target_user_id AND NEW.via = OLD.via
        AND NEW.action = OLD.action AND NEW.from_role IS OLD.from_role AND NEW.to_role IS OLD.to_role
        AND NEW.reason IS OLD.reason AND NEW.created_at = OLD.created_at
      )
      BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

      CREATE TRIGGER IF NOT EXISTS team_events_no_delete BEFORE DELETE ON team_events
      WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.target_user_id)
      BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

      CREATE TRIGGER IF NOT EXISTS users_keep_one_admin BEFORE UPDATE OF role, disabled_at ON users
      WHEN OLD.role = 'admin' AND OLD.disabled_at IS NULL
        AND (NEW.role <> 'admin' OR NEW.disabled_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM users WHERE id <> OLD.id AND role = 'admin' AND disabled_at IS NULL)
      BEGIN SELECT RAISE(ABORT, 'LAST_ADMIN'); END;

      CREATE TRIGGER IF NOT EXISTS users_keep_one_admin_delete BEFORE DELETE ON users
      WHEN OLD.role = 'admin' AND OLD.disabled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM users WHERE id <> OLD.id AND role = 'admin' AND disabled_at IS NULL)
      BEGIN SELECT RAISE(ABORT, 'LAST_ADMIN'); END;
    `);

    // Backfill (§3.3): only when no admin exists yet, so a re-run never picks a second one.
    if (db.query("SELECT 1 FROM users WHERE role = 'admin'").get()) return;
    const oldest = db.query("SELECT id FROM users WHERE disabled_at IS NULL ORDER BY created_at, id LIMIT 1").get() as { id: string } | null;
    if (!oldest) return;
    db.query("UPDATE users SET role = 'admin' WHERE id = ?").run(oldest.id);
    db.query(`INSERT INTO team_events (id, target_user_id, actor_id, via, action, from_role, to_role, reason, created_at)
      VALUES (?, ?, NULL, 'migration', 'bootstrap_admin', 'member', 'admin', NULL, ?)`)
      .run(crypto.randomUUID(), oldest.id, new Date().toISOString());
  }
};
