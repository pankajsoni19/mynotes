# Nook plan: Today (W10), Collections (W11), Calendar and reminders (W12)

Extends DEVELOPMENT_PLAN.md and WAVES_7-9.md, including the §7 Director conventions: no hidden system folders, `documents.purpose`, attachments go to the Bin, and contracts are updated in the same commits.

- **Baseline:** migrations 008–010 (W7, W9, W8) are released.
- **Naming:** copy says **Nook**, but internal ids keep `mynotes` (`mynotes_…` tokens, `mynotes.*` history keys, `mynotes:*` localStorage).
- **`BIN` columns** follow WAVES_7-9 §3.1.

## 0. Sequencing: 10 → 11 → 12

| Order | Wave | Migration | Release | Needs |
| --- | --- | --- | --- | --- |
| 1 | W10 Today | `011_task_dates` | v0.8.0 | W9 cards; W8 for agent drafts (section omitted without it) |
| 2 | W11 Collections | `012_collections` | v0.9.0 (stages as patches) | W7 `buildFtsQuery`, W8 scopes, 009 `purpose` |
| 3 | W12 Calendar | `013_calendar` | v0.10.0 (stages as patches) | 011 `due_on`; 012 for row links |

Today is small and fixes the section contract that W11 and W12 plug into. Collections comes before Calendar so that events can link rows.

**Fallback** if reminders are urgent: ship Calendar as `012` without the `collection_row` link type, and Collections as `013`. Rebuilding `event_links` later is safe because nothing references it.

**Blocking precondition.** Amend the unreleased migration `009` so that `documents.purpose` has `CHECK (purpose IN ('file','task_attachment','collection_attachment'))`.
- A SQLite CHECK cannot be widened without a table rebuild.
- `PRAGMA foreign_keys` cannot change inside the migration transaction.
- If 009 has already shipped, stage 11C needs an operator-approved rebuild of `documents`.

## 1. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D50 | Home **becomes** Today at `/`. The card grid shrinks to a launcher row (Notes, Files, Tasks, Collections, Calendar) above the sections. **The Bin is not a launcher item** (operator, 2026-09-25): it lives in the utility row next to Settings and Sign out and in each app's sidebar footer; Today shows only the `binSoon` line. | One landing, fewer taps; `/` is already the mobile landing |
| D51 | `GET /api/today` composes **providers**. Each provider calls its module's exported predicate or list function (`readableNotePredicate`, the readable-document predicate, `readableBoard`, `listBin`, `readableCollection`, `readableCalendar`). | No new visibility path (T50) |
| D52 | Sections are bounded to ≤10 items (fetch 11 → `more`) with an `href`. The client sends `tz`. A failing provider errors only its own section, and modules that are not installed are absent. No caching. | Bounded cost, graceful degradation |
| D53 | Migration `011` adds `cards.due_on` (a date), `cards.assignee_id` (must be a board reader), and `board_columns.is_done` (backfilled for "Done"). Hidden sections are stored in `localStorage`. | "Due", "mine", and "open" need them |
| D54 | Collections and Calendars use one **audience role**, `share_role ∈ {viewer, editor}`, for everyone shared with. Editors write rows and events. The owner alone edits schema, views, name, and sharing, and deletes or purges. Boards keep D38. | Read-only sharing is common (recipes, family calendar); no per-member role UI |
| D55 | Fixed field types. Server-generated ids `f_[a-z0-9]{8}`. `fields[0]` is the text **primary field** (the title everywhere). Values are keyed by id. Writes are strict; reads are lenient (unknown or removed values read as empty). | Renames are free, and schema edits never rewrite rows |
| D56 | Queries use enumerated operators, JSON paths bound as parameters (`json_extract(values_json, ?)`), field ids checked against the schema, and an opaque offset cursor bound to `schema_version`. No generated columns (10k-row cap). | No injection (T54) |
| D57 | Row search gets separate `collection_row_search` and `collection_row_fts` tables using the W7 tokenizer and builder. | `note_search_rows.note_id` is a NOT NULL FK |
| D58 | Attachments are documents with `purpose='collection_attachment'` and `folder_id=NULL`, or `purpose='file'` documents the caller **owns**, linked in `collection_row_attachments`. `file` values are derived from the links. A linked document is readable through a live row in a readable collection (in `readableDocument*` only). Note links never grant access: unreadable targets resolve as `{id, restricted:true}`. | Attachments are row content; notes keep their own ACL (T59) |
| D59 | CSV import is JSON-wrapped text (≤2 MB), parsed by an in-house RFC 4180 parser, all-or-nothing, with a dry run. Export is UTF-8 with a BOM, and formulas are neutralized. | No new multipart path, no dependency (T55) |
| D60 | Five built-in templates (inventory, subscriptions, expenses, recipes, contacts) are static JSON **copied** into the schema. | No template migration |
| D61 | Rows and events keep one-step undo (`prev_values_json`/`prev_json`, `prev_revision`). The UI offers "Undo last change", and it covers MCP edits. | MCP `update_*` must be reversible (T73) |
| D62 | Calendars are per user, and "Personal" is created on first use. Sharing follows D54. | Family calendar = shared plus the editor role |
| D63 | Timed events store **local time + IANA tz + duration**; all-day events store `start_date` and an exclusive `end_date`. Recurrence is a JSON subset: `freq daily\|weekly\|monthly\|yearly`, `interval 1–99`, `byDay` (weekly), and `until` or `count≤730`. Monthly uses DTSTART's day and skips short months. Only `exdates≤200`; there are no per-occurrence edits. | Correct across DST, and covers household use |
| D64 | Reminders are private to whoever set them. An in-process dispatcher runs every 30 s: it claims due rows, writes a durable `notifications` row, advances `next_fire_at` in one transaction, then pushes after commit. Reminders missed while down fire once if less than 24 h late. Access is re-checked at fire time. | Durable in-app delivery, no leak after unsharing (T67) |
| D65 | Web Push is **payload-less**: the service worker fetches `/api/notifications?unread=1` with the session cookie. VAPID ES256 keys are generated at first boot into `DATA_DIR/push/vapid.json` (0600, atomic). The JWT is built in-house on WebCrypto, so no RFC 8291 encryption is needed. Push is on only when `APP_ORIGIN` is `https:` (`PUSH_ENABLED=auto\|true\|false`). Endpoints must be on a push-host allowlist. | Push services never see content (T63); no dependency; no SSRF (T62) |
| D66 | Read-only iCalendar feed with one revocable token per (calendar, user, `detail busy\|full`), SHA-256 hashed and shown once. `GET /api/calendars/:k/feed.ics?token=` is exempted from `requireAuth` and the TOTP gate by a **pattern** match (those middlewares use exact-path lists today). Content follows the creator's **live** access. **Operator decision:** this revises §14 "no signed URLs" for this route, on the same footing as MCP keys. | Native phone calendars; immediate revocation (T64) |
| D67 | Cards with a `due_on` show as a read-only "Tasks due" overlay (readable boards, columns not marked done). Collection dates are not shown on the calendar. | Reuses 011 |
| D68 | `BinType` gains `collection`, `collection_row`, `calendar`, and `event`, with the tombstone and CAS restore. A child is listed for the owner and its deleter (D41). Restoring a child of a binned parent returns 409 `PARENT_IN_BIN`. Purging moves linked attachments to the Bin. | Bin parity |
| D69 | **History parity (operator rule).** Every view, panel, and item has a `src/router.ts` route and uses `navigate` with the `mynotes.depth` counter. Mobile panel hints ride in history state. Dialogs and sheets push nothing: they register `registerHistoryDialogGuard`, so Back closes them and `history.go` undoes the move. Back never leaves the app before Home at depth 0. Targets are ≥44 px at 390 px. | Swipe-back works everywhere |
| D70 | **MCP coverage (operator rule).** Each module adds a scope pair (`today:read`; `collections:read\|write`; `calendar:read\|write`) following W8: tools registered per scope and re-checked in the handler, write implies read, and writes are create and update only with revision CAS. There are no delete, share, or schema tools. Every write is audited `{via:"mcp", keyId}`. Limits are W8's 120 calls and 30 writes per minute, plus the daily caps below. `get_today` returns only the sections whose module scope the key also holds. | Agents get a uniform, reversible write surface (T72–T74) |

## 2. Wave 10: Today (S/M, 2 sessions)

### 2.1 Migration `011_task_dates` (assertion `[1..11]`)

```text
addColumn(cards, due_on, "TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]')")
addColumn(cards, assignee_id, "TEXT REFERENCES users(id) ON DELETE SET NULL")
addColumn(board_columns, is_done, "INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0,1))")
UPDATE board_columns SET is_done = 1 WHERE name = 'Done' COLLATE NOCASE;
CREATE INDEX idx_cards_due ON cards(due_on) WHERE deleted_at IS NULL AND due_on IS NOT NULL;
CREATE INDEX idx_cards_assignee ON cards(assignee_id, updated_at) WHERE deleted_at IS NULL AND assignee_id IS NOT NULL;
CREATE INDEX idx_cards_creator ON cards(created_by, updated_at) WHERE deleted_at IS NULL;
```

Task API changes:

- `PATCH /cards/:k` accepts `{dueOn|null, assigneeId|null}`. An assignee who is not a reader gets 400 `ASSIGNEE_NOT_MEMBER`.
- `PATCH /columns/:c {isDone}` is owner only.
- W8 `create_card` gains the optional `dueOn`.

### 2.2 `GET /api/today?tz=<IANA>`

Responses:

- **200** `{generatedAt, date, sections}`. Each section is `{items, more, href}`; there are no counts or bodies.
- **400** when `tz` is not in `Intl.supportedValuesOf('timeZone')`.
- **429** above 30 requests per minute per user.

| Section | Predicate reused | Item |
| --- | --- | --- |
| `tasksDue` | `readableBoard`, live card, not a done column, `due_on ≤ today+7` | `{cardId, boardId, boardName, title, dueOn, overdue}` |
| `tasksMine` | same, and `assignee_id=me OR created_by=me` | `+ reason` |
| `notesRecent` | `readableNotePredicate` | `{id, title, owner_name, is_owner, updated_at}` |
| `drafts` | owned, draft ≠ published, `draft_mcp_key_id IS NULL` | `{id, title, updated_at, neverPublished}` |
| `agentDrafts` | owned, `draft_mcp_key_id` set | `{id, title, keyName, updated_at}` |
| `files` | readable document, `purpose='file'`, newest first | summary subset |
| `binSoon` | `listBin` with `purge_after ≤ now+3d` | `{type, id, title, purge_after}` |
| `upcoming` (W12) | occurrence service over 7 days, plus today's reminders | `{eventId, title, start, allDay}` |
| `storage` | `storedBytes`, quota | `{usedBytes, binnedBytes, quotaBytes}` |

### 2.3 UI, history, and MCP

- **Layout.** `TodayHome` replaces `AppHome`. Each section is a `<section aria-labelledby>` with an `h2`, a `<ul>` of real `<a href>` links, a "View all" link, and a one-line empty state. Storage is a labelled `role="meter"` ("3.2 GB of 10 GB").
- **Desktop and phone.** Desktop uses an `auto-fill minmax(320px,1fr)` grid. At 390 px it is one column with 44 px rows.
- **States.** Skeleton with `aria-busy`, per-section Retry, and a Refresh button with a polite live region. The page refetches on `visibilitychange` when data is more than 60 s old.
- **History.**

  | URL | Back |
  | --- | --- |
  | `/` | at depth 0, leaves the site (the only exit) |

  "Customize sections" is a dialog: it registers the guard, so Back only closes it. Links push the target route with depth+1, so Back returns to Today.
- **MCP.** `get_today {tz}` (scope `today:read`) returns the aggregate as plain JSON, titles only, filtered per D70. It is not audited.

### 2.4 Tests and commits

| Area | Cases |
| --- | --- |
| Parity (T50) | Across the share matrix, every item ⊆ the owning app's list. Covers unshare, bin, member removal, drafts. |
| Bounds | 10 + `more`; `tz` UTC+14/−12 at midnight; provider failure isolated; module absent |
| Tasks | `ASSIGNEE_NOT_MEMBER`; done excluded; 011 backfill on a 010 fixture |
| MCP | `get_today` omits sections lacking scope (T74) |
| UI | Empty states; axe; 390 px; Back from a linked item returns to Today; dialog guard |

Commits:

1. `feat: add task due dates, assignees, and done columns migration 011`
2. `feat: set due dates and assignees on cards`
3. `feat: add Today aggregate API with per-module providers`
4. `feat: replace Home grid with Today dashboard`
5. `feat: add Today mobile layout, refresh, and section preferences`
6. `feat: add get_today MCP tool and today:read scope`
7. `docs: document Today`

## 3. Wave 11: Collections (L, 5–6 sessions, stages A–E)

### 3.1 Migration `012_collections`

```sql
CREATE TABLE collections (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120), icon TEXT NOT NULL DEFAULT 'table' CHECK (length(icon) <= 32),
  schema_json TEXT NOT NULL CHECK (json_valid(schema_json) AND length(schema_json) <= 65536),
  schema_version INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
  share_role TEXT NOT NULL DEFAULT 'viewer' CHECK (share_role IN ('viewer','editor')),
  template_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, BIN);
CREATE TABLE collection_members (collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (collection_id, user_id));
CREATE TABLE collection_rows (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  values_json TEXT NOT NULL CHECK (json_valid(values_json) AND length(CAST(values_json AS BLOB)) <= 16384),
  prev_values_json TEXT CHECK (prev_values_json IS NULL OR length(CAST(prev_values_json AS BLOB)) <= 16384),
  revision INTEGER NOT NULL DEFAULT 1, prev_revision INTEGER, updated_via_key_id TEXT REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, BIN);
CREATE TABLE collection_views (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  kind TEXT NOT NULL DEFAULT 'table' CHECK (kind IN ('table','board')),
  config_json TEXT NOT NULL CHECK (json_valid(config_json) AND length(config_json) <= 8192),
  position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE collection_row_attachments (row_id TEXT NOT NULL REFERENCES collection_rows(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, field_id TEXT NOT NULL,
  linked_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, PRIMARY KEY (row_id, document_id));
CREATE TABLE collection_row_search (id INTEGER PRIMARY KEY,
  row_id TEXT NOT NULL UNIQUE REFERENCES collection_rows(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, indexed_at TEXT NOT NULL);
CREATE VIRTUAL TABLE collection_row_fts USING fts5(title, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3');
CREATE TRIGGER collection_row_search_ad AFTER DELETE ON collection_row_search
  BEGIN DELETE FROM collection_row_fts WHERE rowid = old.id; END;
CREATE INDEX idx_collections_owner ON collections(owner_id, deleted_at);
CREATE INDEX idx_collection_members_user ON collection_members(user_id, collection_id);
CREATE INDEX idx_rows_collection ON collection_rows(collection_id, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_row_attachments_document ON collection_row_attachments(document_id);
```

**Schema** is validated with strict zod and no prototype keys. It has 1–50 fields of the form `{id, name 1–60 (unique case-insensitive), type, required?, number?:{decimals 0–6, unit≤8}, options?}`. `options` are ≤100 entries of `{id o_[a-z0-9]{6}, label≤60, color}`.

Field types and value rules:

| Type | Value |
| --- | --- |
| `text` | ≤4000 characters, NFC, controls stripped |
| `number` | finite double |
| `date` | `YYYY-MM-DD` |
| `checkbox` | boolean |
| `select` | one option id |
| `multi_select` | ≤20 option ids |
| `url` | `http(s)` only, ≤2048 characters |
| `note` | a uuid the writer can read at write time |
| `file` | derived from attachment links (D58), never stored |

`PUT /schema` uses a `schemaVersion` CAS. Allowed type changes are text↔url and select→multi_select; any other change returns 400 `INCOMPATIBLE_TYPE_CHANGE`. Removed values are dropped on the next write, and the collection is reindexed in the same transaction.

**Caps** return 409 `LIMIT_REACHED`:

| Item | Cap |
| --- | --- |
| Collections per owner | 100 |
| Live rows per collection | 10,000 |
| Views per collection | 20 |
| Attachments per row | 20 |
| Import | 5,000 rows or 2 MB |

### 3.2 Authorization (`server/collections/access.ts`)

```sql
-- readableCollection(c, :user)
c.deleted_at IS NULL AND (c.owner_id = :user OR c.visibility = 'all_users' OR (c.visibility = 'selected'
  AND EXISTS (SELECT 1 FROM collection_members m WHERE m.collection_id = c.id AND m.user_id = :user)))
-- editableCollection = readableCollection AND (c.owner_id = :user OR c.share_role = 'editor')
-- OR-ed into readableDocument* only:
EXISTS (SELECT 1 FROM collection_row_attachments a JOIN collection_rows r ON r.id = a.row_id AND r.deleted_at IS NULL
  JOIN collections c ON c.id = r.collection_id WHERE a.document_id = d.id AND <readableCollection(c, $userId)>)
```

- Every path id is joined to its collection. Strangers get 404, and viewers get 403 `READ_ONLY` or `OWNER_ONLY`.
- `purpose <> 'file'` stays out of every Files list, count, and filter.

### 3.3 API (`/api/collections`)

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /`, `POST / {name, icon?, templateId?, fields?}`, `GET /templates` | any | 200 / 201 | 400, 409 |
| `GET /:c` | reader | 200 `{collection, role, views}` | 404 |
| `PATCH /:c`, `DELETE /:c` (to the Bin), `PUT /:c/schema {fields, schemaVersion}`, `GET\|PUT /:c/sharing {visibility, userIds≤100, role}` | owner | 200 | 400 `INVALID_SCHEMA`, 403, 404, 409 `SCHEMA_CHANGED` |
| `POST /:c/query {viewId?, sort≤3, filters≤10, q?, cursor?, limit≤100}` | reader | 200 `{rows, nextCursor, schemaVersion}` | 400, 404, 409 |
| `POST /:c/rows {values, afterRowId?}` | editor | 201 | 400 `INVALID_VALUES {fieldErrors}`, 403, 404, 409 |
| `GET /rows/:r`, `PATCH /rows/:r {values (merge), revision}`, `POST /rows/:r/undo {revision}`, `DELETE /rows/:r` (to the Bin) | reader / editor | 200 | 403, 404, 409 `ROW_CHANGED` |
| `POST /:c/views`, `PATCH\|DELETE /views/:v` | owner | 201 / 200 | 400, 403, 404, 409 |
| `POST /rows/:r/attachments {documentId, fieldId}`; `DELETE …/:d` (linker or owner) | editor that owns the document | 201 / 200 | 403, 404, 409 |
| `GET /:c/export.csv?viewId=` | reader | 200 `text/csv`, attachment | 404 |
| `POST /:c/import {csv, mapping, dryRun}` | editor | 200 `{inserted}` or `{preview≤20, errors≤50}` | 400, 403, 409, 413 |

**Query operators:**

| Types | Operators |
| --- | --- |
| text, url | `contains` (`instr(lower())`), `equals`, `empty`, `not_empty` |
| number, date | `eq`, `lt`, `lte`, `gt`, `gte`, `empty` |
| checkbox | `is` |
| select | `is`, `is_not`, `in` |
| multi_select | `has_any`, `has_all` |
| note, file | `empty`, `not_empty` |

- **Links.** Rows return `links` resolved per viewer.
- **Search.** `GET /api/search?scope=collections&collection=all|<uuid>` returns `{rowId, collectionId, collectionName, title, snippet, updated_at}`.
  - The ACL is applied before `LIMIT`.
  - The index is written in the row transaction, and boot reconciles on `source_revision` and `schema_version`.
  - Indexed text: the title is the primary field; the body is text, url, number, date, and option labels, never note titles.
- **Uploads.** `POST /api/files?purpose=collection_attachment` stores with `folder_id=NULL`, and the upload counts against quota. When the last link is removed, the document moves to the Bin.
- **Audit.** `collection.*` and `collection.row_*` events record ids and counts, never values.

### 3.4 UI and history (390 px first)

| URL | View | Back goes to |
| --- | --- | --- |
| `/collections` | list of owned and shared collections | `/` |
| `/collections/:c` | table (desktop) or card list (mobile) | `/collections` |
| `/collections/:c/view/:v` | saved view (a view, so it gets an entry) | previous entry |
| `/collections/:c/row/:r` | row detail: side pane on desktop, full-screen panel on mobile | the collection or view |

These pieces are dialogs or sheets, which push nothing and use the guard: New collection (template or CSV), Field editor, Sharing, Sort/Filter sheet, Import wizard, row action sheet (Undo, Delete, Copy link), and a field's option picker.

- A row panel that shows an open picker closes the picker first on Back, then leaves the row on the next Back.
- The mobile card list shows the primary field plus 3 fields in 56 px rows. The detail panel has one ≥44 px editor per field.
- Viewers see "View only" and no editors. Desktop cells save on blur with CAS; `ROW_CHANGED` offers Reload.

### 3.5 MCP (`collections:read`, `collections:write`)

| Tool | Scope | Input → output |
| --- | --- | --- |
| `list_collections` | read | `{}` → `[{id, name, role, fields:[{id,name,type,options}]}]` |
| `query_rows` | read | `{collectionId, filters?, sort?, q?, limit≤50, cursor?}` → rows keyed by field **name**; links are titles or `restricted`; attachments are names only |
| `get_row` | read | `{rowId}` → `{row, revision}` |
| `create_row` | write | `{collectionId, values}` → `{rowId, revision, url}`. Editor role required. |
| `update_row` | write | `{rowId, values (merge), baseRevision}` → `{revision}` or `ROW_CHANGED`. Sets `updated_via_key_id`, and the UI shows "Changed by <key> · Undo". |

Writes are capped at 500 per key per day. There is no delete, schema, share, or import tool.

### 3.6 Tests and commits

| Area | Cases |
| --- | --- |
| Unit | zod `__proto__`, 51 fields, duplicate names; validators; CSV quotes/CRLF/BOM/newlines/unterminated/50k cells; `= + - @ \t \r` neutralized in text only; query builder rejects unknown fields and ops |
| API | role matrix (stranger 404); IDOR for rows, views, attachments; schema and row CAS; undo; lazy drops; caps; import all-or-nothing and dry run; export ⊆ query; search parity and unshare |
| Attachments | 404 after unshare, bin, unlink; never in `/api/files`; `restricted` note links |
| Bin | `PARENT_IN_BIN`, sweeper, attachments moved to the Bin |
| MCP | scope hiding; viewer `create_row` → error; CAS; audit `{via, keyId}`; daily limit |
| History | 390 px: list → collection → view → row, then Back × 4 reaches `/`; sheets close on Back; Forward restores the row |

Stage A:

1. `feat: add collections migration 012`
2. `feat: add schema validation and templates`
3. `feat: add collection and row APIs with server-side query`
4. `feat: add Collections routes, list, and desktop table`
5. `feat: add mobile card list and row panel with history`

Stage B:

6. `feat: share collections with viewer and editor roles`
7. `feat: add saved views`

Stage C:

8. `feat: add row attachments with collection-scoped access`
9. `feat: add collections and rows to the Bin`

Stage D:

10. `feat: index rows for search`
11. `feat: add CSV import and export`

Stage E:

12. `feat: add MCP collection tools and scopes`
13. `docs: document Collections`

Run `/security-review` after stages C and D.

## 4. Wave 12: Calendar and reminders (M/L, 4–5 sessions, stages A–D)

### 4.1 Migration `013_calendar`

```sql
CREATE TABLE calendars (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color TEXT NOT NULL CHECK (color IN ('blue','green','amber','red','violet','slate')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
  share_role TEXT NOT NULL DEFAULT 'viewer' CHECK (share_role IN ('viewer','editor')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, BIN);
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
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, BIN,
  CHECK ((all_day = 1 AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_local IS NULL)
      OR (all_day = 0 AND start_local IS NOT NULL AND tz IS NOT NULL AND duration_minutes IS NOT NULL)));
CREATE TABLE event_links (event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('note','card','collection_row')), target_id TEXT NOT NULL,
  linked_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, PRIMARY KEY (event_id, target_type, target_id));
CREATE TABLE reminders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  offset_minutes INTEGER CHECK (offset_minutes BETWEEN -1440 AND 40320),   -- negative = after start (all-day 09:00 = -540)
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200), tz TEXT NOT NULL,
  next_fire_at TEXT, claimed_at TEXT, last_fired_at TEXT, created_via_key_id TEXT REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK ((event_id IS NOT NULL AND offset_minutes IS NOT NULL AND title IS NULL) OR (event_id IS NULL AND title IS NOT NULL)));
CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_id TEXT REFERENCES reminders(id) ON DELETE SET NULL, event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  occurrence_start TEXT, late INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, read_at TEXT);  -- titles resolved live
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
```

**Recurrence** lives in the pure `server/calendar/recurrence.ts`. `zonedToUtc` works by probing `Intl` offsets. In a DST gap the time shifts forward; in an overlap the earlier instance wins. Expansion stops at 1000 instances per request, a range spans at most 100 days, and `series_end_utc` is computed on write.

**Caps:**

| Item | Cap |
| --- | --- |
| Calendars per owner | 20 |
| Events per calendar | 20k |
| Reminders per event per user | 10 |
| Standalone reminders per user | 500 |
| Push subscriptions per user | 10 |
| Feed tokens per user per calendar | 5 |

The sweeper deletes notifications after 30 days.

### 4.2 Authorization

- `readableCalendar` and `editableCalendar` are the §3.2 predicates on the calendar tables. Events are always joined to their calendar.
- **Links.** The linker must be able to read the target. Links resolve per viewer (`restricted` otherwise).
- **Reminders and subscriptions.** Self-scoped. The dispatcher re-checks `readableCalendar` and deletes the reminder when access is lost.
- **Feeds.** Every fetch re-checks that the creator can still read the calendar.

### 4.3 API

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET\|POST /api/calendars`; `PATCH\|DELETE /:k`; `GET\|PUT /:k/sharing` | any / owner | 200 / 201 | 400, 403, 404, 409 |
| `GET /api/events?from&to&calendars&include=tasks` | reader | 200 `{occurrences, tasks?}` | 400 (>100 d) |
| `POST /api/calendars/:k/events`; `GET\|PATCH /api/events/:e {…, revision}`; `POST /:e/undo`; `POST /:e/exdates {date}`; `DELETE /:e` (to the Bin) | reader / editor | 201 / 200 | 400, 403, 404, 409 `EVENT_CHANGED` |
| `POST\|DELETE /api/events/:e/links {targetType, targetId}` | editor | 201 / 200 | 403, 404 |
| `GET\|POST /api/reminders {eventId, offsetMinutes}\|{title, fireAt}`; `DELETE /:id` | self | 200 / 201 | 400, 404, 409 |
| `GET /api/notifications?unread&limit≤50`; `POST /read {ids≤100\|all}` | self | 200 `{items:[{id, title, href, late, read}]}` | 400 |
| `GET /api/push/config` | any | `{enabled, publicKey?, reason?: insecure_origin\|disabled}` | — |
| `POST\|DELETE /api/push/subscriptions`; `POST /api/push/test` (5/h) | self | 201 / 200 | 400 `ENDPOINT_NOT_ALLOWED`, 409, 429 |
| `GET\|POST /api/calendars/:k/feeds {detail}`; `DELETE /api/feeds/:f` | reader, own tokens | 201 `{token, url}` shown once | 403, 404, 409 |
| `GET /api/calendars/:k/feed.ics?token=` | token | 200 `text/calendar` | 404 for any failure; 429 at 60/h per token |

**Feed output** follows RFC 5545:

- `UID <id>@nook`, with `TZID=` or `VALUE=DATE`, plus `RRULE` and `EXDATE`.
- SUMMARY, LOCATION, and DESCRIPTION are escaped, and CR and LF are neutralized. `busy` feeds send only "Busy".
- Lines are folded at 75 octets, and at most 5000 events are sent.
- The token is never logged or audited, and `last_used_at` is written at most every 10 minutes.

**Push delivery:**

| Aspect | Rule |
| --- | --- |
| Request | Empty body, `TTL 3600`, a VAPID `Authorization` header |
| Target | `https` on port 443, host allowlist (`*.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, plus `PUSH_ENDPOINT_HOSTS`), no IP literals, private addresses rejected after DNS |
| Transport | No redirects, 5 s timeout |
| Failures | 404 or 410 deletes the subscription; 5 failures disable it |

**Config:**

- Add `PUSH_ENABLED`, `PUSH_SUBJECT` (defaults to `APP_ORIGIN`), and `PUSH_ENDPOINT_HOSTS` to config, `.env.example`, Compose, and the README.
- `DATA_DIR/push/` is included in backups. If the keys are lost, clients re-subscribe when `publicKey` changes.

**Audit:** `calendar.*`, `event.*`, `reminder.*`, `push.subscribe`, and `calendar.feed_created`/`_revoked` record ids only.

### 4.4 UI and history (390 px first)

| URL | View | Back goes to |
| --- | --- | --- |
| `/calendar` | agenda for the next 60 days (mobile default) | `/` |
| `/calendar/month/:yyyy-mm` | month grid (desktop) or dot grid plus the day list (mobile). Prev/next month **replace** the entry, so Back never walks through months. | previous entry |
| `/calendar/event/:e` | event detail with links and my reminders | agenda or month |
| `/notifications` | list on mobile; desktop uses a bell popover (a dialog with the guard) | previous entry |

These are dialogs or sheets with the guard, pushing nothing: Event edit/create sheet, Repeat sheet, Reminder picker, Calendar sharing, Feed dialog, and the "Tasks due" filter sheet.

- When the edit sheet is open on `/calendar/event/:e`, Back closes the sheet. With unsaved edits it asks "Discard changes?", and the move is undone with `history.go`.
- Notification clicks and Today links push `/calendar/event/:e` at depth+1.
- Targets are ≥44 px, and day cells in the mobile month view are ≥44 × 44.

**Push setup and the service worker:**

- **Enable.** Settings → Notifications → "Enable on this device" requests permission only on that click. It also lists devices (Remove) and offers "Send test".
- **Unavailable.** When push is unavailable the page explains: "Push needs the HTTPS address, such as your Tailscale URL; reminders still appear in Nook." On iOS it adds: "Add to Home Screen first." This needs `manifest.webmanifest` and a PNG icon (**operator: new binary**).
- **Service worker.** `public/sw.js` is handwritten, scoped to `/`, served with `no-cache`, and has **no fetch handler**. On `push` it fetches unread notifications and shows them with `tag=id`, or a generic "You have a reminder in Nook". `notificationclick` opens only same-origin paths built from ids. The CSP is unchanged (`worker-src` falls back to `'self'`).
- **Feed dialog.** Choose Busy or Full, copy the URL once, and list or revoke tokens. The dialog warns that anyone with the link can read the feed, and that cloud calendars fetch it from their own servers, which a tailnet-only origin blocks.

### 4.5 MCP (`calendar:read`, `calendar:write`)

| Tool | Scope | Input → output |
| --- | --- | --- |
| `list_calendars` | read | `{}` → `[{id, name, role}]` |
| `list_events` | read | `{from, to (≤100 d), calendarIds?}` → occurrences `{eventId, title, start, end, allDay, recurring}`. Descriptions are plain text; links are titles or `restricted`. |
| `get_event` | read | `{eventId}` → event, rule, revision |
| `create_event` | write | `{calendarId, title, allDay, start, end\|durationMinutes, tz, repeat?, description?, location?}` → `{eventId, revision, url}`. Editor role required. |
| `update_event` | write | `{eventId, baseRevision, …fields}` → `{revision}` or `EVENT_CHANGED`. Undo is available in the UI. |
| `create_reminder` | write | `{eventId, offsetMinutes}` or `{title, fireAt, tz}` → `{reminderId, nextFireAt}` for the key owner only |

Daily caps per key are 200 event writes and 100 reminders. There are no delete, exdate, share, or feed tools.

### 4.6 Tests and commits

| Area | Cases |
| --- | --- |
| Unit | Recurrence: every freq, interval, byDay, until/count, monthly on the 31st, Feb 29, DST gap and overlap (New York, Berlin), exdates, the 1000 cap. ICS escaping and folding (title containing `\r\nATTENDEE:`). VAPID JWT signature. Endpoint allowlist: IPs, ports, redirects, `http:`, look-alike hosts. |
| API | Role matrix and IDOR for calendars, events, reminders, feeds. `EVENT_CHANGED` and undo. Fake-clock dispatch: exactly one notification, advance, late under 24 h, skip over 24 h, access loss. Push: empty body, 410 cleanup, `insecure_origin` on `http://localhost`. Feed: 404 for bad, revoked, binned, or lost-access tokens; `busy` hides titles; TOTP users; token absent from logs. Bin `PARENT_IN_BIN`. Today `upcoming` parity. |
| MCP | Scopes, editor role, CAS, `create_reminder` self-only, audit, caps |
| History | 390 px: Today → agenda → month → event → edit sheet. Back closes the sheet, then returns event → month → agenda → Today. Month paging adds no entries. |
| Manual | Android Chrome and iOS PWA push on the Tailscale HTTPS origin; localhost falls back to in-app; phone calendar subscribed to the feed |

Stage A:

1. `feat: add calendar migration 013`
2. `feat: add recurrence and zoned time helpers`
3. `feat: add calendar, sharing, and event APIs`
4. `feat: add Calendar agenda, month, and event routes`
5. `feat: show due cards and event links`
6. `feat: add calendars and events to the Bin`

Stage B:

7. `feat: add reminders, dispatcher, and notifications`
8. `feat: add notification bell and Today upcoming`

Stage C:

9. `feat: add VAPID keys and payload-less Web Push`
10. `feat: add service worker and device push settings`

Stage D:

11. `feat: add revocable iCalendar feeds`
12. `feat: add MCP calendar tools and scopes`
13. `docs: document Calendar`

Run `/security-review` after stages C and D.

## 5. Threat rows (append to THREAT_MODEL.md)

| # | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| T50 | Today leaks through a new aggregation path | D51 providers only, parity test | Required |
| T51 | Today cost amplification | 11-row LIMITs, indexes, 30/min, no bodies | Required |
| T52 | IDOR across collections, rows, views, attachments | Joined path ids, role checks in services | Required |
| T53 | Abuse of schema or value JSON | Strict zod, byte CHECKs, caps, server ids | Required |
| T54 | SQL injection through sort or filter | Operator enum, schema-checked ids, bound paths | Required |
| T55 | CSV formula injection | Prefix `'` to text cells starting `= + - @ \t \r` | Required |
| T56 | Import exhaustion | 2 MB, 5000 rows, 50 columns, one transaction, 5/min | Required |
| T57 | A viewer writes (API or MCP) | `editable*` checks in shared services | Required |
| T58 | An attachment stays reachable after unshare or bin | Live predicate, `no-store` (as T39) | Required |
| T59 | Links disclose unreadable titles | Resolved per viewer, `restricted`, not indexed | Required |
| T60 | Row search leaks | ACL before LIMIT, parity test | Required |
| T61 | IDOR across calendars, events, reminders, subscriptions, feeds | Joins, self-scoping, 404 | Required |
| T62 | Push endpoint SSRF or abuse | Allowlist, https:443, post-DNS private block, no redirects, 5 s, 10 per user | Required |
| T63 | Push services learn content | Payload-less; only timing is visible | Accepted (documented) |
| T64 | Feed token leakage (shared URL, cloud providers) | Hashed, scoped, revocable, `busy`, live ACL, uniform 404, never logged, rate limit | Required |
| T65 | ICS injection through CRLF | Escaping, folding, fixtures | Required |
| T66 | Recurrence or reminder exhaustion | 1000 instances, 100 days, caps, 200 per tick, 60 notifications per user per hour | Required |
| T67 | A reminder fires after access is lost | Re-check at dispatch, live titles | Required |
| T68 | Open redirect from a notification click | Same-origin id paths only | Required |
| T69 | Service worker persistence or hijack | Same-origin, `no-cache`, no fetch handler, unregistered on sign-out | Required |
| T70 | Feeds bypass TOTP | As with MCP keys: created from a gated session, read-only, revocable | Accepted |
| T71 | Timezone or date abuse | `Intl` allowlist, real-date checks | Required |
| T72 | MCP scope escalation in the new modules | Per-scope registration plus handler checks (extends T32) | Required |
| T73 | MCP overwrites or vandalizes rows and events | Create or update only, CAS, one-step undo, "Changed by key" badge, audit, daily caps, revocation | Required |
| T74 | `get_today` bypasses module scopes | Sections filtered by the key's module scopes; test | Required |
| T75 | Prompt injection through rows or events returned to agents | As T34: data only, opt-in writes, undo, audit | Accepted (documented) |
| T76 | Back or Forward leaves the app or reopens stale dialogs | D69 guard, depth counter, history QA rows | Required |

## 6. Stance

- **Single container.** No new process or volume. The dispatcher and sweeper are `unref` timers, and one instance runs per data directory.
- **No cloud.** Push is the only outbound traffic. It needs HTTPS, per-device opt-in, and carries no payload, and `PUSH_ENABLED=false` disables it.
- **HTTP origins.** On `http://localhost` or a LAN IP, reminders appear in the bell, the notifications list, and Today.
- **Dependencies.** None added: CSV, recurrence, ICS, and VAPID are in-house on WebCrypto.

## 7. Out of scope

- **Today:** server-stored layout, counts, realtime.
- **Collections:** formulas, rollups, relations, board or gallery UI (`kind` reserved), calendar display of date fields, per-member roles, row comments or history beyond one-step undo, XLSX, MCP delete or schema tools.
- **Calendar:** CalDAV, ICS import, attendees, per-occurrence edits, BYSETPOS and BYMONTHDAY lists, cross-user free/busy, email or SMS reminders, VTIMEZONE blocks, offline caching in the service worker.

## 8. Director review (2026-09-25)

Reviewed against DEVELOPMENT_PLAN.md rules, WAVES_7-9.md §7, the threat model, and the current code. Verdict: **adopt as written**, with the notes below. Length above the requested budget is accepted because the extra text is the per-wave history and MCP sections the operator's two rules require.

**Accepted:** order 10 → 11 → 12 with migrations 011–013; Today replaces the Home grid with a launcher row (D50) and composes only existing predicates (D51); viewer/editor audience role for collections and calendars (D54); fixed field types with lenient reads (D55); parameterised query builder (D56); separate row FTS tables (D57); attachments via `documents.purpose` (D58); in-house CSV/recurrence/ICS/VAPID with no new dependency (D59, D63, D65); one-step undo covering MCP edits (D61); payload-less push on HTTPS only with a host allowlist (D65); Bin parity (D68); history parity (D69) and MCP scopes (D70) as binding rules; all Required threat rows T50–T76.

**Precondition applied now:** WAVES_7-9.md §7 change 1 is amended so migration 009 defines `documents.purpose` with `CHECK (purpose IN ('file','task_attachment','collection_attachment'))` from the start; a later widening would need a table rebuild.

**Operator decisions (defaults apply unless overridden):**
- **D66 iCalendar feed without a signed-in session** (revises §14 "no signed URLs" for this one route): default **accept**. Tokens are hashed, scoped per calendar and user, revocable, rate-limited, follow the creator's live access, and a `busy` mode hides titles. Phone calendars cannot subscribe otherwise.
- **PNG app icon for the web manifest** (first binary asset since the social preview): default **accept**; the operator approves the image before it is committed, as with the social preview.

**Notes for implementers:** `is_done` backfill matches column name "Done" case-insensitively only; owners can set it on other columns. The Today `agentDrafts` and `upcoming` sections must be absent, not empty, when W8 or W12 are not installed. The dispatcher's 30 s tick and the sweeper must both be `unref` timers and single-flight. Keep the version sequence v0.8.0 → v0.9.0 → v0.10.0 after v0.5.0 (search), v0.6.0 (boards), v0.7.0 (MCP scopes).
