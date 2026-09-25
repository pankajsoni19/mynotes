import { addColumn, type Migration } from "./types";

/**
 * A cheap "has anything in this range?" test for the range API (T66).
 *
 * `next_occurrence_utc` is a lower bound on the start of every occurrence that ends after
 * `next_occurrence_from` (NULL with a non-NULL `next_occurrence_from` means there is none),
 * computed for the event at `next_occurrence_revision`. A range query whose lower edge is at or
 * after `next_occurrence_from` skips rows whose `next_occurrence_utc` is at or after its upper
 * edge, without expanding them. The values are written with each event and backfilled in batches
 * at boot. A NULL `next_occurrence_from`, or a revision that no longer matches the event's, means
 * "unknown", so the row is always expanded; a write path that does not refresh them stays correct.
 */
export const eventNextOccurrenceMigration: Migration = {
  id: 14,
  name: "event_next_occurrence",
  up(db) {
    addColumn(db, "events", "next_occurrence_utc", "TEXT");
    addColumn(db, "events", "next_occurrence_from", "TEXT");
    addColumn(db, "events", "next_occurrence_revision", "INTEGER");
  }
};
