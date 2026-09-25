import type { Migration } from "./types";

/** The Bin columns and their paired CHECK, as used for documents (migration 006). */
const BIN = `deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  purge_after TEXT,
  purge_started_at TEXT,
  CHECK ((deleted_at IS NULL AND purge_after IS NULL) OR (deleted_at IS NOT NULL AND purge_after IS NOT NULL))`;

/**
 * Calendar and reminders (docs/plan/WAVES_10-12.md §4.1, D62–D68).
 *
 * Calendars with a viewer/editor audience role, events that store local time
 * plus an IANA zone (timed) or dates (all-day) with a JSON recurrence subset,
 * links to other modules, private reminders, durable in-app notifications,
 * Web Push subscriptions, and revocable iCalendar feed tokens.
 *
 * Independent of migrations 009–012: `event_links.target_id` is plain TEXT
 * with no foreign key, and `target_type` is validated in code as well as by
 * the CHECK, so links to modules that are not installed resolve as restricted.
 */
export const calendarMigration: Migration = {
  id: 13,
  name: "calendar",
  up(db) {
    db.exec(`
      CREATE TABLE calendars (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        color TEXT NOT NULL CHECK (color IN ('blue','green','amber','red','violet','slate')),
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
        share_role TEXT NOT NULL DEFAULT 'viewer' CHECK (share_role IN ('viewer','editor')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${BIN});
      CREATE TABLE calendar_members (calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (calendar_id, user_id));
      CREATE TABLE events (id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        description TEXT NOT NULL DEFAULT '' CHECK (length(CAST(description AS BLOB)) <= 8192),
        location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 200),
        all_day INTEGER NOT NULL CHECK (all_day IN (0,1)), start_date TEXT, end_date TEXT,
        start_local TEXT, tz TEXT, duration_minutes INTEGER CHECK (duration_minutes BETWEEN 1 AND 10080),
        start_utc TEXT NOT NULL, series_end_utc TEXT,
        rrule_json TEXT CHECK (rrule_json IS NULL OR (json_valid(rrule_json) AND length(rrule_json) <= 512)),
        exdates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exdates_json) AND length(exdates_json) <= 4096),
        prev_json TEXT, revision INTEGER NOT NULL DEFAULT 1, prev_revision INTEGER,
        updated_via_key_id TEXT REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL, updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${BIN},
        CHECK ((all_day = 1 AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_local IS NULL)
            OR (all_day = 0 AND start_local IS NOT NULL AND tz IS NOT NULL AND duration_minutes IS NOT NULL)));
      CREATE TABLE event_links (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('note','card','collection_row')), target_id TEXT NOT NULL,
        linked_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, PRIMARY KEY (event_id, target_type, target_id));
      CREATE TABLE reminders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
        offset_minutes INTEGER CHECK (offset_minutes BETWEEN -1440 AND 40320),
        title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200), tz TEXT NOT NULL,
        next_fire_at TEXT, claimed_at TEXT, last_fired_at TEXT, created_via_key_id TEXT REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        CHECK ((event_id IS NOT NULL AND offset_minutes IS NOT NULL AND title IS NULL) OR (event_id IS NULL AND title IS NOT NULL)));
      CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL, event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        occurrence_start TEXT, late INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, read_at TEXT);
      CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE CHECK (length(endpoint) <= 1024), p256dh TEXT NOT NULL CHECK (length(p256dh) <= 128),
        auth TEXT NOT NULL CHECK (length(auth) <= 64), label TEXT NOT NULL CHECK (length(label) <= 60),
        created_at TEXT NOT NULL, last_success_at TEXT, failure_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE calendar_feeds (id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        token_prefix TEXT NOT NULL, detail TEXT NOT NULL CHECK (detail IN ('busy','full')),
        created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
      CREATE INDEX idx_calendar_members_user ON calendar_members(user_id, calendar_id);
      CREATE INDEX idx_events_range ON events(calendar_id, start_utc, series_end_utc) WHERE deleted_at IS NULL;
      CREATE INDEX idx_event_links_target ON event_links(target_type, target_id);
      CREATE INDEX idx_reminders_due ON reminders(next_fire_at) WHERE next_fire_at IS NOT NULL AND claimed_at IS NULL;
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX idx_feeds_calendar ON calendar_feeds(calendar_id, user_id) WHERE revoked_at IS NULL;
    `);
  }
};
