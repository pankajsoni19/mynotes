# API contracts: Files, content, Bin, and Search

Companion to [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md). Every endpoint lives under `/api` and inherits the existing middleware:

- a session cookie is required (401 otherwise)
- the `TOTP_POLICY=required` setup gate applies
- `Cache-Control: no-store`
- global security headers apply

Mutations (anything other than GET, HEAD, or OPTIONS) require:

- an allowed `Origin` (403)
- `X-CSRF-Token` (403)
- `Content-Type: application/json` (415). The single exception is `POST /api/files`, which requires `multipart/form-data`.

**Conventions**

- Errors are `{ "error": string, "code"?: string, "details"?: string[] }`. Zod failures return 400 `{ error: "Invalid request", details }`, as they do today.
- Ids are UUIDs, validated with `uuid.parse`. A malformed id returns 400.
- Missing, forbidden, and (for non-owners) binned items all return **404** with the same message.
- Timestamps are ISO-8601 UTC strings (`new Date().toISOString()`).
- Field casing follows existing responses: snake_case for DB-shaped rows, camelCase for computed flags.

## Types

```ts
type Visibility = "private" | "selected" | "all_users";
type PreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "none";

type DocumentSummary = {
  id: string;
  owner_id: string;
  owner_name: string;
  is_owner: 0 | 1;
  folder_id: string | null;      // masked to null for recipients unless the folder itself is visible to them
  name: string;
  mime_type: string;
  preview_kind: PreviewKind;
  size_bytes: number;
  visibility: Visibility;        // effective: folder visibility when inheriting, else document visibility
  sharing_override: 0 | 1;       // only meaningful to owners; recipients receive 0
  created_at: string;
  updated_at: string;
};

type BinItem = {
  type: "note" | "document";
  id: string;
  title: string;                 // note title or document name
  folder_id: string | null;      // original folder, null if it no longer exists
  folder_name: string | null;    // null → restore target is Default
  size_bytes: number | null;     // documents only
  deleted_at: string;
  purge_after: string;
  purging: boolean;              // purge_started_at IS NOT NULL
};
```

`sha256`, `upload_key`, the storage path, and the deletion columns are **never** returned by list or metadata endpoints.

## Files

### Upload

`POST /api/files?folderId=<uuid>`. If `folderId` is omitted, the file goes to the caller's Default folder.

`purpose` (Wave 9, migration 009): every document has `documents.purpose` = `file` (default), `task_attachment`, or `collection_attachment` (reserved for Wave 11). Until Task Boards stage C, the only accepted value of the optional `?purpose=` parameter is `file`; any other value returns 400 `{ error: "Invalid request", details }`.

The request body is `multipart/form-data` with **exactly one** part, named `file`. The part's `filename` parameter becomes the display name after sanitization (DEVELOPMENT_PLAN §6.4). The part's `Content-Type` is ignored for classification.

Optional headers:

- `Idempotency-Key: <uuid>`: the Files UI always sends one per queued file
- `Content-Length` is **required** (411 without it). Browsers send it for `FormData` and it enables the early 413

| Status | When | Body |
| --- | --- | --- |
| 201 | Stored | `{ document: DocumentSummary }` |
| 200 | `Idempotency-Key` already used by this user | `{ document: DocumentSummary, idempotentReplay: true }` |
| 400 | Not multipart, missing or extra parts, a field other than `file`, a malformed boundary, or an invalid `folderId`/`Idempotency-Key` | `{ error }` |
| 404 | Folder not found or not owned by the caller | `{ error: "Folder not found" }` |
| 409 | `Idempotency-Key` was already used by this user for a document that is now in the Bin. Clients treat this as final and do not retry. | `{ error, code: "IDEMPOTENCY_KEY_USED" }` |
| 408 | No body bytes arrived for 30 seconds (the upload stalled) | `{ error, code: "UPLOAD_TIMEOUT" }` |
| 411 | `Content-Length` is missing or not a valid integer. Browsers always send it for `FormData` and `File` bodies. | `{ error, code: "LENGTH_REQUIRED" }` |
| 413 | `Content-Length` or streamed bytes exceed `MAX_UPLOAD_BYTES` | `{ error, code: "FILE_TOO_LARGE", limitBytes }` |
| 415 | `Content-Type` is not `multipart/form-data` | `{ error }` |
| 429 | The user already has 3 uploads in flight | `{ error, code: "TOO_MANY_UPLOADS" }` |
| 507 | The quota would be exceeded, or free disk would fall below `MIN_FREE_DISK_BYTES` | `{ error, code: "QUOTA_EXCEEDED" \| "DISK_FULL" }` |

Audit: `document.upload { documentId, size, mimeType }`. The filename is never logged or audited.

> **Implementation notes (shipped in v0.3.0):**
> - The early 413 uses `Content-Length > MAX_UPLOAD_BYTES + 64 KiB` (multipart overhead). Streamed bytes are still checked against `MAX_UPLOAD_BYTES` exactly.
> - Requests without `Content-Length` (chunked) are accepted and bounded while streaming; the quota and free-disk checks then reserve `MAX_UPLOAD_BYTES` for the request.
> - busboy is configured with `parts: 2` and `fileSize: MAX_UPLOAD_BYTES + 1`, because it reports a limit when a count or size *reaches* it. Reaching two parts is treated as an extra part (400); a file part over the limit fails at once (413) instead of draining the body.
> - 409 `IDEMPOTENCY_KEY_USED` is also returned when a concurrent upload with the same key commits first and that document is binned before the replay is read.
> - A huge chunked body sent to a non-upload route is stopped by Bun's global `maxRequestBodySize` with a bare 413, not the JSON error shape.

### List

`GET /api/files?folderId=<uuid>` lists live documents the caller can read, ordered by `updated_at DESC`, with a limit of 500. The `folderId` filter matches `documents.folder_id`. Only `purpose = 'file'` documents are listed: attachments never appear in Files, not even for their uploader, and they are left out of `GET /api/bin?type=document` (they still count toward the storage quota).

200 → `{ documents: DocumentSummary[] }`

### Metadata

`GET /api/files/:id` → 200 `{ document: DocumentSummary }`, or 404.

### Rename and move

`PATCH /api/files/:id` with body `{ name?: string, folderId?: uuid | null }`. The schema is strict, and at least one key must be present. Owner only.

- `name` is sanitized with the upload rules. If it is empty or longer than 255 UTF-8 bytes after sanitizing, the response is 400. Preview kind and MIME type **do not** change on rename.
- `folderId` must be a folder owned by the caller (404 `Folder not found` otherwise). `null` moves the document to no folder: private unless it has an override, and shown under All.
- 200 → `{ document: DocumentSummary }` with the new effective `visibility`, so the UI can report it.
- Audit: `document.rename { documentId }`, `document.move { documentId, folderId }`.

### Sharing

This mirrors the notes endpoints exactly.

- `GET /api/files/:id/sharing` (owner only) → `{ visibility: "inherit" | Visibility, users: [{ id, display_name }] }`
- `PUT /api/files/:id/sharing` with body `{ visibility: "inherit" | "private" | "selected" | "all_users", userIds: uuid[] (max 100) }`
  - The same validation as `sharingSchema`: the owner cannot be a recipient, `selected` requires at least one user, and every user must exist and be enabled.
  - It replaces the rows in `document_shares`. `inherit` sets `sharing_override = 0`.
  - 200 `{ ok: true }`
  - Audit: `document.sharing_changed { documentId, visibility, recipientCount }`

### Delete (to Bin)

`DELETE /api/files/:id` (owner only, body `{}`):

- **Live document:** sets `deleted_at = now`, `deleted_by = caller`, and `purge_after = now + 30 days` → 200 `{ ok: true, purgeAfter }`.
- **Already binned (owner):** 200 `{ ok: true, alreadyDeleted: true, purgeAfter }`.
- **Missing or not owned:** 404.
- Audit: `document.delete { documentId }`.

<a id="content"></a>
### Content

`GET /api/files/:id/content?disposition=inline|attachment`, and `HEAD` on the same URL. Any reader may call it. The default disposition is `attachment`.

Response headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `inline` and `preview_kind ≠ none` → the stored `mime_type` (text → `text/plain; charset=utf-8`). Otherwise `application/octet-stream`. |
| `Content-Disposition` | `inline` only if requested **and** `preview_kind ≠ none`; otherwise `attachment`. The filename format is `filename="<ascii-fallback>"; filename*=UTF-8''<percent-encoded NFC name>`. For the ASCII fallback, replace non-ASCII characters with `_`, strip `"`, `\`, CR, LF, and control characters, and fall back to `download` if the result is empty. |
| `Content-Length` | Byte length of the body |
| `Accept-Ranges` | `bytes` |
| `ETag` | `"<sha256>"` (strong) |
| `Last-Modified` | `updated_at` in HTTP-date format |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'none'; sandbox` for every response except inline PDF, which gets `default-src 'none'; frame-ancestors 'none'` (see DEVELOPMENT_PLAN §7.2 verification). The global `secureHeaders` middleware overwrites headers after `next()`, so this route must be excluded from it and set these headers itself. |
| `X-Frame-Options`, `Referrer-Policy` | `DENY`, `no-referrer` (set by the route, since the global middleware is skipped here) |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` | `private, no-store` |

Range handling (RFC 9110):

- `Range: bytes=a-b`, `bytes=a-`, and `bytes=-n` are supported. If the range is satisfiable → **206** with `Content-Range: bytes start-end/size`. `end` is clamped to `size-1`.
- Multiple ranges (a comma in the header) → the range is ignored and the response is **200** with the full body.
- A malformed `Range` or a non-`bytes` unit → ignored, **200**.
- Unsatisfiable (`start ≥ size`, a suffix of 0, or any range on a 0-byte file) → **416** with `Content-Range: bytes */size` and an empty body.
- If `If-Range` is present and does not exactly equal the current ETag → the range is ignored, **200**. HTTP-date `If-Range` values are also treated as a mismatch.
- `HEAD` returns the same status and headers with no body.

Errors:

- 404 when the document is not readable
- 500 `{ error: "Something went wrong" }` on an integrity failure: missing object, size mismatch, or a symlink. The server logs the error class and document id and never the filename.

Downloads and previews are **not** audited individually, by design, to avoid noise.

Streaming: open the object with `O_NOFOLLOW` and verify it with `fstat`, then stream `start..end` from the fd, using a Node read stream converted with `Readable.toWeb`. The fd must close when the client aborts.

> **Implementation notes (shipped in v0.3.0):** Bun sends streamed 200/206 bodies with `Transfer-Encoding: chunked` rather than the `Content-Length` the route sets; HEAD, 416, and empty responses carry `Content-Length`. Content responses do not carry the global HSTS or Permissions-Policy headers, since the route replaces `secureHeaders`. Both were accepted in the Wave 3 review.

<a id="bin"></a>
## Bin

Every Bin endpoint is scoped to the caller's own items. `:type` is `note` or `document`; any other value returns 400.

### List

`GET /api/bin?type=note|document` (the `type` filter is optional) → 200 `{ items: BinItem[] }`, ordered by `deleted_at DESC`, with a limit of 500. Notes in the list: `deleted_at IS NOT NULL` (blank unpublished notes never enter the Bin; they are purged immediately).

### Restore

`POST /api/bin/:type/:id/restore` with body `{}`:

| Status | When | Body |
| --- | --- | --- |
| 200 | Restored | `{ ok: true, folderId, folderName, visibility }`: original folder, or Default when the original is gone or not owned. `visibility` is the new effective visibility, because a Default fallback can change it. |
| 200 | Already live (owner) | `{ ok: true, alreadyRestored: true, folderId, folderName }` |
| 404 | Missing or not owned | `{ error }` |
| 409 | Purge in progress | `{ error, code: "PURGING" }` |

Restore is a compare-and-swap update under the resource lock. Share rows remain as they were, so the item's previous audience regains access. Audit: `note.restore` / `document.restore`.

### Delete forever

`DELETE /api/bin/:type/:id` with body `{}`:

| Status | When | Body |
| --- | --- | --- |
| 200 | Purged, or a purge was already in progress and has now finished | `{ ok: true }` |
| 202 | Purge started but byte removal failed; the sweeper will retry | `{ ok: true, pending: true }` |
| 404 | No such binned item for this owner (including items already purged) | `{ error }` |
| 409 | The item is live (not in the Bin) | `{ error, code: "NOT_IN_BIN" }` |

Clients treat a 404 on a **retry** as success.

### Empty Bin

`DELETE /api/bin` with body `{}` → 200 `{ ok: true, purged: number, pending: number }`. Items are processed in batches. Failures stay marked for the sweeper.

> **Implementation notes (shipped in v0.3.1):**
> - Purge audit events (`note.purge`, `document.purge`) record `reason`: `user`, `blank`, `retention`, or `resumed`. `resumed` marks a purge the sweeper finished after an interruption; the original reason is not stored.
> - The sweeper's Bin step has two separate budgets per table and run: up to 50 interrupted purges resumed, then up to 100 items past `purge_after`. Retention is re-checked under the lock, so an item restored and deleted again mid-run is not purged. Remaining items wait for the next hourly run.

## Search (Wave 7)

`GET /api/search?q=&scope=notes&folder=all|shared|<uuid>&limit=20` searches note titles and bodies ([WAVES_7-9.md](WAVES_7-9.md) §2).

| Parameter | Default | Rule |
| --- | --- | --- |
| `q` | `""` | At most 200 characters. It is never passed to FTS5 as syntax: it is NFKC-normalized and lowercased, up to 4 `"quoted phrases"` are kept, the rest is split into up to 8 words of 2–64 letters, numbers, or combining marks, and every word must match (implicit AND). The last word matches as a prefix unless `q` ends in a space or punctuation. A `q` with nothing searchable returns no results. |
| `scope` | `notes` | Only `notes` |
| `folder` | `all` | `all`, `shared` (notes owned by others), or a folder id. A folder id matches the masked `folder_id` below. |
| `limit` | `20` | Integer 1–50 |

```ts
type Segment = { text: string; hit: boolean };  // plain text, never HTML
type NoteSearchHit = {
  id: string;
  source: "published" | "draft";  // draft only for the owner, when a draft exists
  title: Segment[];                // highlighted title
  snippet: Segment[];              // body excerpt around the hits, "…" where cut
  folder_id: string | null;        // masked as in GET /api/notes
  owner_name: string;
  is_owner: 0 | 1;
  visibility: Visibility;          // effective, as in GET /api/notes
  updated_at: string;
};
```

| Status | When | Body |
| --- | --- | --- |
| 200 | Always, including no matches | `{ results: NoteSearchHit[], truncated: boolean }`, ordered by relevance (title matches weigh 8×) then `updated_at DESC`. `truncated` means more than `limit` notes matched. Scores are never returned. |
| 400 | Bad `scope`, `folder`, or `limit`, or `q` over 200 characters | `{ error: "Invalid request", details }` |
| 429 | More than 20 searches in 10 seconds by this user | `{ error, code: "RATE_LIMITED" }` with `Retry-After` in seconds |

Access is the live `GET /api/notes/:id` rule, applied in the query before `LIMIT`: a note's owner searches their draft when one exists and the published version otherwise; everyone else searches the published version of notes they can read. Binned notes never match; restoring one makes it searchable again, and purging removes its index rows. The index holds the published version and the owner's draft, built from checksum-verified files in the same transaction as each change.

## Calendar (Wave 12)

Calendars, events, and links ([WAVES_10-12.md](WAVES_10-12.md) §4, D54, D61–D63). JSON only. Stage A covers the endpoints below; reminders, notifications, push, and feeds arrive in stages B–D.

**Roles (D54).** The owner does everything. Everyone the calendar is shared with (`visibility` `selected` with a member row, or `all_users`) gets the calendar's single audience role `share_role`: `viewer` reads, `editor` also creates, edits, undoes, skips dates on, links, and bins events. Only the owner renames, recolours, shares, or bins the calendar.

| Caller | Response |
| --- | --- |
| Cannot read the calendar (stranger, removed member, binned calendar) | **404** |
| Viewer calling an event write | 403 `{ code: "READ_ONLY" }` |
| Viewer or editor calling an owner-only action | 403 `{ code: "OWNER_ONLY" }` |

```ts
type CalendarColor = "blue" | "green" | "amber" | "red" | "violet" | "slate";
type CalendarSummary = {
  id: string; owner_id: string; owner_name: string; is_owner: 0 | 1;
  role: "owner" | "editor" | "viewer";
  name: string; color: CalendarColor; visibility: Visibility; share_role: "viewer" | "editor";
  created_at: string; updated_at: string;
};
type RepeatRule = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;                 // 1–99, default 1
  byDay?: ("MO"|"TU"|"WE"|"TH"|"FR"|"SA"|"SU")[];  // weekly only; must include the start's weekday
  until?: string;                   // yyyy-mm-dd, inclusive, local to the event
  count?: number;                   // 1–730; not with until
};
type EventDetail = {
  id: string; calendar_id: string; title: string; description: string; location: string;
  all_day: boolean;
  start_date: string | null; end_date: string | null;          // all-day: yyyy-mm-dd, end exclusive
  start_local: string | null; tz: string | null; duration_minutes: number | null;  // timed: yyyy-mm-ddTHH:MM, IANA zone, 1–10080
  repeat: RepeatRule | null; exdates: string[];                // skipped local start dates, ≤ 200
  revision: number; canUndo: boolean; changedByKey: boolean;
  created_by_name: string | null; updated_by_name: string | null; created_at: string; updated_at: string;
};
type EventLink = { targetType: "note" | "card" | "collection_row"; targetId: string; title: string | null; restricted: boolean };
type EventResponse = { event: EventDetail; calendar: CalendarSummary; role: CalendarSummary["role"]; links: EventLink[] };
type Occurrence = {
  eventId: string; calendarId: string; title: string; location: string; color: CalendarColor;
  allDay: boolean;
  date: string;                     // local start date of the occurrence (what an exdate names)
  start: string; end: string;       // timed: UTC ISO instants; all-day: yyyy-mm-dd, end exclusive
  recurring: boolean;
};
```

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/calendars` | any | 200 `{ calendars: CalendarSummary[] }`, owned first. A user who has never had a calendar gets "Personal" (blue) on this call. | — |
| `POST /api/calendars {name, color?}` | any | 201 `{ calendar }` | 400; 409 `LIMIT_REACHED` (20 live calendars per owner) |
| `PATCH /api/calendars/:k {name?, color?}` | owner | 200 `{ calendar }` | 400, 403, 404 |
| `DELETE /api/calendars/:k` (to the Bin) | owner | 200 `{ ok, purgeAfter }` | 403, 404 |
| `GET /api/calendars/:k/sharing` | owner | 200 `{ visibility, shareRole, users: [{ id, display_name }] }` | 403, 404 |
| `PUT /api/calendars/:k/sharing {visibility, shareRole?, userIds≤100}` | owner | 200 `{ ok }`. Same rules as folder sharing: the owner is never a recipient, `selected` needs at least one enabled user. | 400, 403, 404 |
| `POST /api/calendars/:k/events` | editor | 201 `EventResponse` | 400, 403, 404; 409 `LIMIT_REACHED` (20k live events per calendar) |
| `GET /api/events?from&to&tz&calendars&include=tasks` | reader | 200 `{ occurrences: Occurrence[], truncated, tasks? }` | 400 |
| `GET /api/events/:e` | reader | 200 `EventResponse` | 404 |
| `PATCH /api/events/:e {…fields, revision}` | editor | 200 `EventResponse` | 400, 403, 404, 409 `EVENT_CHANGED` |
| `POST /api/events/:e/undo {revision}` | editor | 200 `EventResponse` | 403, 404, 409 `EVENT_CHANGED` or `NOTHING_TO_UNDO` |
| `POST /api/events/:e/exdates {date, revision?}` | editor | 200 `EventResponse` (idempotent) | 400 (not a repeating event, or not an occurrence date), 403, 404, 409 |
| `DELETE /api/events/:e` (to the Bin) | editor | 200 `{ ok, purgeAfter }` | 403, 404 |
| `POST /api/events/:e/links {targetType, targetId}` | editor | 201 `{ link }`, or 200 if already linked | 400, 403, 404 (target not readable by the linker); 409 `LIMIT_REACHED` (50 links) |
| `DELETE /api/events/:e/links {targetType, targetId}` | editor | 200 `{ ok }` | 403, 404 |

**Event bodies.** Create takes `{ title (1–200), description? (≤ 8 KiB, line breaks kept), location? (≤ 200), allDay, startDate+endDate | startLocal+tz+durationMinutes, repeat? }`. Titles, names, and locations reject control and bidi-override characters. Dates must be real (no 2026-02-30) and zones must be accepted by `Intl` (T71). PATCH takes any subset plus `revision`; timing fields are merged with the stored ones and validated together, and switching `allDay` needs the other mode's fields. Every successful change (PATCH, exdate) keeps the previous values for **one-step undo** (D61); undo itself cannot be undone. A stale `revision` returns 409 `{ code: "EVENT_CHANGED", revision, event }` with the current event.

**Range listing.** `from` and `to` are whole local days (`yyyy-mm-dd`, `to` exclusive) in the viewer's zone `tz` (default `UTC`), at most **100 days** apart (400 otherwise). Occurrences are expanded server-side: timed occurrences keep their wall time in the event's zone across DST (a gap shifts forward, an overlap takes the earlier instant); monthly repeats use the start's day of the month and skip months without it. An occurrence that started before `from` but overlaps the range is included. At most **1000** occurrences are returned per request; `truncated` is true when more existed (T66). `calendars` is an optional comma-separated list of up to 50 calendar ids; ids the caller cannot read are ignored.

**Tasks due (D67).** `include=tasks` (the only accepted value; anything else is 400) adds `tasks: [{ cardId, boardId, boardName, title, dueOn }]`: live cards whose `due_on` falls in `[from, to)`, on boards the caller can read (the Task Boards predicate), in columns not marked done, at most 200, ordered by date. The overlay is read-only. `cards.due_on` and `board_columns.is_done` arrive with migration 011; the server checks for them once at boot and answers `tasks: []` until they exist. Without `include`, the key is absent.

**Links.** The linker must be able to read the target, and an unreadable target returns the same 404 as a missing one. Links are resolved per viewer on every read: the title when the viewer can read the target, otherwise `{ title: null, restricted: true }` (T59). Links never grant access. `note` targets use the live note ACL. `card` and `collection_row` targets are validated as UUIDs only and resolve as restricted until the Tasks and Collections modules register a resolver (`server/calendar/links.ts`).

**Audit.** `calendar.create`, `calendar.update`, `calendar.delete`, `calendar.sharing_changed { calendarId, visibility, shareRole, recipientCount }`, `event.create { eventId, calendarId }`, `event.update`, `event.undo`, `event.exdate`, `event.delete { eventId }`, `event.link` / `event.unlink { eventId, targetType, targetId }`. Ids only: titles, descriptions, and locations are never audited.

## Changes to existing note endpoints (Wave 4)

- `DELETE /api/notes/:id`:
  - Blank never-published note → purged immediately → `{ ok: true, purged: true }`.
  - Any other note → moved to the Bin → `{ ok: true, purgeAfter }`.
  - The response is 404 for missing notes, as it is today.
- `DELETE /api/notes/:id/draft` on a never-published note:
  - Blank → purged immediately.
  - Content → moved to the Bin with the draft file and `draft_revision`/`draft_checksum` **kept** (today this route deletes them). The response still returns `{ ok: true }`, plus `binned: true`, so the client can pick the right toast.
- "Blank" means `current_version = 0` and the draft is absent or empty after `trim()` (DEVELOPMENT_PLAN §9.1).
- Unchanged: every read endpoint continues to exclude `deleted_at IS NOT NULL`. So do MCP `list_notes` and `read_note`.
