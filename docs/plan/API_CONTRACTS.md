# API contracts: Files, content, Bin, Search, Tasks, Today, Preferences, MCP, Collections, and Calendar

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
  type: "note" | "document" | "card" | "board" | "collection" | "collection_row" | "calendar" | "event";   // collection types: Wave 11; calendar types: Wave 12
  id: string;
  title: string;                 // note title, document name, card title, or board name
  folder_id: string | null;      // original folder, null if it no longer exists
  folder_name: string | null;    // null → restore target is Default
  size_bytes: number | null;     // documents only
  deleted_at: string;
  purge_after: string;
  purging: boolean;              // purge_started_at IS NOT NULL
  board_id: string | null;       // cards: their board; boards: themselves; else null
  board_name: string | null;
  attachment: boolean;           // a document that was a card attachment (restores into Files)
  can_purge: boolean;            // false for a card, row, or event the caller deleted on someone else's board, collection, or calendar
};
```

`sha256`, `upload_key`, the storage path, and the deletion columns are **never** returned by list or metadata endpoints.

## Files

### Upload

`POST /api/files?folderId=<uuid>`. If `folderId` is omitted, the file goes to the caller's Default folder.

`purpose` (Wave 9, migration 009): every document has `documents.purpose` = `file` (default), `task_attachment`, or `collection_attachment` (reserved for Wave 11). The optional `?purpose=` parameter accepts `file` or `task_attachment`; anything else returns 400. A `task_attachment` upload takes no `folderId` (400 otherwise), is stored with `folder_id = NULL`, never appears in Files, counts toward the quota, and becomes readable to a board's readers only once linked to one of its cards (§ Tasks, Attachments).

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

**Non-file documents (Wave 9 review fix):** `PATCH /api/files/:id`, `GET`/`PUT /api/files/:id/sharing` return 404 for documents whose `purpose` is not `file`; `DELETE /api/files/:id` bins an attachment only when no card links it, otherwise 409 `{ code: "ATTACHMENT_LINKED" }`. Folder and sharing access apply only to `file` documents; attachments are readable solely through their board (Wave 9 §3.2).

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

Every Bin endpoint is scoped to the caller's own items, plus binned cards they deleted (below). `:type` is `note`, `document`, `card`, `board`, `collection`, `collection_row`, `calendar`, or `event` (see [Calendar § Bin](#calendar-items-in-the-bin)); any other value returns 400.

**Cards and boards (Wave 9, D41).** A binned board is listed for its owner. A binned card is listed for the board owner and for the member who deleted it, while that member can still open the board. Either can restore the card; only the board owner deletes it forever (403 `OWNER_ONLY` for the deleter). Cards and boards have no bytes, so a purge never returns 202. Purging a card or board deletes its comments and links; a document that loses its last link moves to its uploader's Bin. A restored attachment document with no links becomes an ordinary Files item (`purpose = 'file'`) in its folder or Default.

### List

`GET /api/bin?type=note|document|card|board` (the `type` filter is optional; `document` lists Files items only, while attachments appear in the unfiltered list) → 200 `{ items: BinItem[] }`, ordered by `deleted_at DESC`, with a limit of 500. Notes in the list: `deleted_at IS NOT NULL` (blank unpublished notes never enter the Bin; they are purged immediately).

### Restore

`POST /api/bin/:type/:id/restore` with body `{}`:

| Status | When | Body |
| --- | --- | --- |
| 200 | Restored | `{ ok: true, folderId, folderName, visibility }`: original folder, or Default when the original is gone or not owned. `visibility` is the new effective visibility, because a Default fallback can change it. |
| 200 | Already live (owner) | `{ ok: true, alreadyRestored: true, folderId, folderName }` |
| 200 | Card or board restored (or already live) | `{ ok: true, alreadyRestored?, boardId, boardName, columnId, columnName }`. A card returns to the bottom of its column, or of the first column when its column was deleted; `columnId`/`columnName` are null for boards. |
| 404 | Missing or not owned | `{ error }` |
| 409 | Purge in progress | `{ error, code: "PURGING" }` |
| 409 | A card whose board is in the Bin | `{ error, code: "BOARD_IN_BIN" }` |
| 409 | The board would exceed 1000 live cards, or the owner 50 live boards | `{ error, code: "LIMIT_REACHED" }` |

Restore is a compare-and-swap update under the resource lock. Share rows remain as they were, so the item's previous audience regains access. Audit: `note.restore` / `document.restore`.

### Delete forever

`DELETE /api/bin/:type/:id` with body `{}`:

| Status | When | Body |
| --- | --- | --- |
| 200 | Purged, or a purge was already in progress and has now finished | `{ ok: true }` |
| 202 | Purge started but byte removal failed; the sweeper will retry | `{ ok: true, pending: true }` |
| 403 | A card the caller deleted on a board they do not own | `{ error, code: "OWNER_ONLY" }` |
| 404 | No such binned item for this owner (including items already purged) | `{ error }` |
| 409 | The item is live (not in the Bin) | `{ error, code: "NOT_IN_BIN" }` |

Clients treat a 404 on a **retry** as success.

### Empty Bin

`DELETE /api/bin` with body `{}` → 200 `{ ok: true, purged: number, pending: number }`. Items are processed in batches. Failures stay marked for the sweeper. It includes the caller's binned boards and the binned cards on boards they own, never cards on other people's boards.

### Collections and rows (Wave 11, D68)

`:type` also accepts `collection` and `collection_row`, and `GET /api/bin?type=` takes either. Collection items come from a provider registered by `server/collections/bin.ts`; `BinItem` gains an optional `can_purge`.

| Type | Listed for | `title` / `folder_*` | Restore | Delete forever |
| --- | --- | --- | --- | --- |
| `collection` | its owner | name / null | owner; 409 `LIMIT_REACHED` at 100 live collections | owner |
| `collection_row` | the collection owner and whoever binned it | primary field / the collection's id and name | owner or deleter while they can still edit the collection (404 otherwise); 409 `PARENT_IN_BIN` while the collection is binned; 409 `LIMIT_REACHED` at 10,000 live rows | collection owner only (`can_purge: false` for others) |

A purge is one transaction (nothing lives outside SQLite) and cascades to rows, members, views, links, and search rows; documents it leaves unlinked with `purpose = 'collection_attachment'` move to the uploader's Bin. The sweeper purges collections and rows past `purge_after`, and Empty Bin purges the owner's collections and the binned rows of collections they own. Audit: `collection.restore`, `collection.purge { collectionId, reason, rowCount, binnedDocuments }`, `collection.row_restore`, `collection.row_purge`.

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

### Collection rows (Wave 11)

`GET /api/search?scope=collections&q=&collection=all|<uuid>&limit=20` uses the same query builder, rate limit, limit bounds, and segments. `folder` is ignored; a `collection` that is neither `all` nor a UUID is 400.

```ts
type RowSearchHit = { rowId: string; collectionId: string; collectionName: string; title: Segment[]; snippet: Segment[]; updated_at: string };
```

→ 200 `{ results: RowSearchHit[], truncated }`. The live `readableCollection` rule is applied in the query before `LIMIT` (T60); binned rows and rows of binned collections never match. The title is the primary field; the body is the other text, url, number, and date values and chosen option labels. Note titles and file names are never indexed (T59). Rows are indexed in the transaction that writes them (`collection_row_search` + `collection_row_fts`), a schema change reindexes its collection, and boot reconciles entries whose `source_revision` or `schema_version` is stale.

## Tasks (Wave 9)

Task Boards ([WAVES_7-9.md](WAVES_7-9.md) §3). Every endpoint is under `/api/tasks`, takes and returns JSON, and inherits the global session, Origin, CSRF, `Content-Type: application/json`, and TOTP rules. Path ids are UUIDs (400 otherwise) and are always joined to a board the caller can read.

**Roles (D38, D39).** A board's readers are its owner, its members when `visibility = 'selected'`, and every user when `visibility = 'all_users'`. Readers create, edit, move, and bin cards. Only the owner renames the board, manages columns and sharing, and deletes it. A caller who cannot read the board gets **404**; a reader calling an owner-only endpoint gets **403** `{ error, code: "OWNER_ONLY" }`. Binned boards are unreadable for everyone.

**Caps** (409 `{ error, code: "LIMIT_REACHED" }`): 50 live boards per owner, 20 columns per board, 1000 live cards per board.

```ts
type BoardSummary = {
  id: string; name: string;          // 1–120 characters, trimmed, no control characters
  owner_id: string; owner_name: string; is_owner: 0 | 1;
  visibility: Visibility;
  card_count: number;                // live cards
  created_at: string; updated_at: string;
};
type BoardColumn = {
  id: string; board_id: string; name: string /* 1–60 */; position: number;
  is_done: 0 | 1;                    // migration 011
  wip_limit: number | null;          // Wave 13 (D108): 1–1000, or null for no limit
  created_at: string; updated_at: string;
};
```

Positions are computed by the server (D40) and never accepted from clients: a new item goes to the midpoint of its neighbours, to last + 1024 at the bottom, or to half the first position at the top. When a gap would drop below 1e-6, the whole column (or the board's column list) is renumbered to 1024, 2048, … and the response says `renormalized: true`. Ordering changes run under the `board:<id>` lock.

### Boards

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /boards` | any | 200 `{ boards: BoardSummary[] }`: owned boards first, then shared ones, each by name (limit 500) | |
| `POST /boards { name }` | any | 201 `{ board, columns }` with To do, Doing, Done at 1024, 2048, 3072 | 400, 409 `LIMIT_REACHED` |
| `GET /boards/:b` | reader | 200 `{ board, columns, cards: CardSummary[] }` (columns and cards by position) | 404 |
| `PATCH /boards/:b { name }` | owner | 200 `{ board }` | 400, 403, 404 |
| `DELETE /boards/:b` | owner | 200 `{ ok: true, purgeAfter }`: the board moves to the Bin for 30 days | 403, 404 |

The board and its cards stay together in the Bin; see § Bin for restore and purge. Audit: `task.board_restore`, `task.card_restore`, `task.board_purge`, `task.card_purge { reason: "user" | "retention" }`.

### Sharing

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /boards/:b/sharing` | owner | 200 `{ visibility, users: [{ id, display_name }] }` | 403, 404 |
| `PUT /boards/:b/sharing { visibility: "private" \| "selected" \| "all_users", userIds ≤ 100 }` | owner | 200 `{ ok: true }` | 400, 403, 404 |

Same rules as folder sharing: the owner cannot be a recipient (400), `selected` needs at least one user (400), every user must exist and be enabled (400), and member rows are kept only for `selected`. Removing a member revokes access at once.

### Columns

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `POST /boards/:b/columns { name, afterColumnId? }` | owner | 201 `{ column, columns }`. Omitted `afterColumnId` appends; `null` puts the column first. | 400, 403, 404 (board, or an anchor not on this board), 409 `LIMIT_REACHED` |
| `PATCH /columns/:c { name?, afterColumnId?, isDone?, wipLimit? }` | owner | 200 `{ column, columns, renormalized? }`. Columns carry `is_done: 0 \| 1` (migration 011); a new board's Done column starts at 1. `wipLimit` is an integer 1–1000 or `null` (Wave 13, D108) and may be set below the current count. | 400 (no field, after itself, or a bad limit), 403, 404 |
| `DELETE /columns/:c` | owner | 200 `{ ok: true, columns }` | 403, 404, 409 `COLUMN_NOT_EMPTY` (with `cardCount`) or `LAST_COLUMN` |

Binned cards do not block deleting their column; they keep `column_id = NULL` and restore to the first column.

**WIP limits (Wave 13, D108, T96).** A hard block, checked under the `board:<id>` lock for REST and MCP: creating a card in a column, or moving one in **from another column**, returns 409 `{ error, code: "COLUMN_FULL", columnId, wipLimit, cardCount }` when the column already holds `wipLimit` or more live cards. Moving within a column and moving out are always allowed, and a Bin restore never fails because of a limit (it may put the column over it). Audit: `task.column_wip { boardId, columnId, wipLimit }`.

### Cards

```ts
type CardSummary = {
  id: string; board_id: string; column_id: string; position: number;
  title: string;                     // 1–200 characters, trimmed, no control characters
  has_description: 0 | 1;            // the board view never carries descriptions
  revision: number;                  // starts at 1, +1 on every title/description edit
  created_by: string | null; creator_name: string | null;
  due_on: string | null;             // YYYY-MM-DD (migration 011); the civil date in due_tz when a time is set
  due_time: string | null;           // Wave 13 (D100): "HH:MM" in due_tz, or null
  due_tz: string | null;             // the IANA zone the setter's browser sent (D101), set exactly when due_time is
  due_at: string | null;             // computed UTC instant (ISO) when due_time is set
  assignees: CardAssignee[];         // Wave 13 (D102): at most 20, in assignment order
  assignee_id: string | null;        // DEPRECATED (D103): assignees[0].id, kept through v0.8.x
  assignee_name: string | null;      // DEPRECATED (D103): assignees[0].display_name
  comment_count: number; attachment_count: number;
  created_at: string; updated_at: string;
};
type CardAssignee = { id: string; display_name: string; can_read: 0 | 1 };  // 0: lost board access or disabled ("Former member", T93)
type CardDetail = CardSummary & { description: string };  // Markdown, at most 65,536 UTF-8 bytes
```

**Due time (Wave 13, D100–D101).** A card may carry a wall time next to its date. The client sends `dueTime` (`HH:MM`, 00:00–23:59) with `dueTz` (`Intl.DateTimeFormat().resolvedOptions().timeZone`); the server checks the zone with `isValidTimeZone` (browser aliases included), stores it as sent, and never converts it. `due_at` comes from `zonedToUtc`: a time inside a DST gap moves forward, and the earlier instant wins in an overlap. Rules (400 otherwise): a time needs a date and a zone; `dueTz` only comes with `dueTime`; `dueTime: null` clears the time and zone; changing only `dueOn` keeps the wall time and zone; `dueOn: null` also clears the time.

**Assignees (Wave 13, D102–D103).** Assignees live in `card_assignees` (migration 015). `cards.assignee_id` is a legacy mirror of the first assignee, rewritten in the same transaction, for a rollback to v0.7.x only. Every user being **added** must be enabled and able to read the board (400 `ASSIGNEE_NOT_MEMBER`); a former member already on the card may stay until any reader removes them. Assigning never grants access.

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /boards/:b/readers?q=&limit=` | reader | 200 `{ users: { id, displayName }[], truncated }`: everyone who can open the board (owner plus members, or every enabled user on an `all_users` board), display names only, for the assignee picker. Without `q`: at most 200 by name. With `q` (1–64 characters): a case-insensitive `instr` match on the display name (no wildcards), at most `limit` (1–50, default 20; `limit` needs `q`) | 400, 404, 429 `RATE_LIMITED` with `Retry-After` (60 a minute per user, T92) |
| `POST /boards/:b/cards { columnId, title, description?, dueOn?, dueTime?, dueTz?, assigneeIds? (≤ 20), afterCardId? }` | reader | 201 `{ card: CardDetail, renormalized? }`. Omitted `afterCardId` = bottom, `null` = top. Assignees are written in the same transaction. | 400 (including `ASSIGNEE_NOT_MEMBER`), 404 (board, or a column not on this board), 409 `COLUMN_FULL`, `STALE_POSITION`, or `LIMIT_REACHED` |
| `GET /cards/:k` | reader | 200 `{ card: CardDetail, comments: CardComment[], hasMoreComments, attachments: CardAttachment[] }`: the newest 50 comments in chronological order, and every live attachment | 404 |
| `PATCH /cards/:k { title?, description?, dueOn?, dueTime?, dueTz?, assigneeIds?, assigneeId?, revision }` | reader | 200 `{ card }` with `revision + 1`, exactly once however many fields change (one transaction). `dueOn` is a real date `YYYY-MM-DD` (1900–2999) or `null`; `dueTime`/`dueTz` follow the due-time rules above; `assigneeIds` (≤ 20 after deduplication) replaces the whole set and `[]` clears it; the legacy `assigneeId` (a user or `null`) means `[id]` or `[]` (D103); omitted fields are unchanged | 400 (including `ASSIGNEE_NOT_MEMBER` when a new assignee is disabled or cannot read the board, and `assigneeId` sent together with `assigneeIds`), 404, 409 `{ code: "CARD_CHANGED", card }` (the current card, every field) when `revision` is not the stored one |
| `POST /cards/:k/move { columnId, afterCardId }` | reader | 200 `{ card, renormalized?, positions? }`. `afterCardId: null` = top. `positions` lists `{ id, position }` for the whole target column after a renumber. | 400, 404 (card, or a column not on the card's board), 409 `STALE_POSITION`, or `COLUMN_FULL` when moving in from another column |
| `DELETE /cards/:k` | reader | 200 `{ ok: true, purgeAfter }`: the card moves to the Bin and keeps its column | 404 |

- **Stale positions.** `afterCardId` must be another live card in the target column. Otherwise (binned, in another column or board, the moved card itself, or unknown) the response is 409 `{ error, code: "STALE_POSITION", columnId, order: string[] }`, where `order` is the target column's live card ids in their current order.
- **Moves** stay on the card's board and do not change `revision`, so an open editor can still save.
- Binned cards and cards on binned boards return 404 on every card route. They are restored through `POST /api/bin/card/:id/restore` (§ Bin).

### Comments

```ts
type CardComment = {
  id: string; card_id: string;
  author_id: string | null; author_name: string | null;  // null once the author's account is deleted
  is_author: 0 | 1;
  body: string;                        // plain text, 1–16,384 UTF-8 bytes, not only whitespace
  created_at: string; edited_at: string | null;
};
```

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /cards/:k/comments?before=<commentId>&limit=1–50` | reader | 200 `{ comments, hasMore }`: the `limit` comments before `before` (or the newest), in chronological order | 400, 404 (card, or `before` not a comment of this card) |
| `POST /cards/:k/comments { body, attachmentIds? }` | reader | 201 `{ comment }`. The author is always the session user. `attachmentIds` (≤ 10) are linked through the comment, with the linking rules below. | 400, 404 (card, or a file that is not the caller's live attachment), 409 `LIMIT_REACHED` (500 comments per card, 10 attachments per comment, 50 per card) |
| `PATCH /comments/:m { body }` | author | 200 `{ comment }` with `edited_at` set | 400, 403 `AUTHOR_ONLY`, 404 |
| `DELETE /comments/:m` | author or board owner | 200 `{ ok: true }`. Comments are deleted outright, not binned; links made through the comment go with it. | 403 `AUTHOR_ONLY`, 404 |

Comments on binned cards, binned boards, or boards the caller can no longer read return 404.

### Attachments

```ts
type CardAttachment = {
  document_id: string; card_id: string;
  comment_id: string | null;           // set when linked through a comment
  linked_by: string | null; linker_name: string | null;
  name: string; mime_type: string; preview_kind: PreviewKind; size_bytes: number;
  created_at: string;                   // when it was linked
};
```

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `POST /cards/:k/attachments { documentId, commentId? }` | reader | 201 `{ attachment }`, or 200 when this owner already linked it | 400, 404 (card; a document that is not a live `task_attachment` owned by the caller; a comment that is not the caller's own on this card), 409 `LIMIT_REACHED` (50 per card, 10 per comment) |
| `DELETE /cards/:k/attachments/:d` | linker or board owner | 200 `{ ok: true, movedToBin }` | 403 `LINKER_ONLY`, 404 |

- **Reading (D43).** `GET /api/files/:id` and `/content` also admit a caller when the live document is linked to a live card on a board they can read. This never applies to lists. Access ends the moment the member is removed, the card or board is binned, the comment is deleted, or the link is removed.
- **Lifecycle (director review §7).** Unlinking never deletes the file directly. When a document loses its last link (unlink, comment deleted, card or board purged), it moves to its uploader's Bin with `deleted_by` = the actor, and purges 30 days later. Binning a card keeps its links, so restoring the card brings its attachments back.
- Inline images in a description use the same content URL, `/api/files/:id/content?disposition=inline`.

**Audit** (ids only, never names or text): `task.board_create`, `task.board_rename`, `task.board_delete`, `task.board_sharing_changed { boardId, visibility, recipientCount }`, `task.column_create`, `task.column_rename`, `task.column_move`, `task.column_delete`, `task.column_wip { wipLimit }`, `task.card_create { assigneesAdded? }`, `task.card_update { dueOn?, dueTime?: "set" | "cleared", assigneeId?, assigneesAdded?, assigneesRemoved? }` (counts, not ids), `task.card_move { boardId, cardId, columnId }`, `task.card_delete`, and `task.comment_create` / `task.comment_update` / `task.comment_delete { boardId, cardId, commentId }`, `task.attachment_link` / `task.attachment_unlink { boardId, cardId, documentId, commentId? }`, and `document.delete { documentId, reason: "attachment_unlinked" }` when an unlinked file moves to the Bin, each with `{ boardId, columnId?, cardId? }`.
## Today (Wave 10)

`GET /api/today?tz=<IANA>&sections=<a,b>?` returns 200 `{ generatedAt, date, sections }`. `date` is today in `tz`. `sections` maps each installed section, in order, to `{ items, more, href }` (at most ten items; `more` when there are more; `href` is the owning app's list). A section whose provider failed is `{ items: [], more: false, href, error }`; the others still load. Sections of modules that are not installed are absent. There are no counts, bodies, or caching. `sections=` limits the response to those names (the per-section Retry).

| Section | Items |
| --- | --- |
| `tasksDue` | `{ cardId, boardId, boardName, title, dueOn, dueTime, dueTz, dueAt, overdue }`: live cards on readable boards, not in a done column, `due_on ≤ date + 7`, soonest first (by `due_on`, then timed cards by wall time, then date-only ones; approximate across zones). A timed card (Wave 13) is `overdue` once `now > dueAt`, a date-only one once `due_on < date` |
| `tasksMine` | as `tasksDue` plus `reason: "assigned" \| "created"`: open cards the caller is one of the assignees of (`card_assignees`, Wave 13) or created |
| `notesRecent` | `{ id, title, owner_name, is_owner, updated_at }`: readable notes; others' notes only once published, with the published title and time |
| `drafts` | `{ id, title, updated_at, neverPublished }`: the caller's notes whose draft differs from the published version, not written by an MCP key |
| `agentDrafts` | `{ id, title, keyName, updated_at }`: the caller's drafts written by an MCP key |
| `files` | `{ id, name, mime_type, preview_kind, size_bytes, owner_name, is_owner, updated_at }`: the Files list, newest first |
| `collectionsRecent` | `{ rowId, collectionId, collectionName, title, updated_at, changedByKey }`: live rows in readable collections, most recently edited first; titles only (`listRecentRows` in `server/collections/service.ts`, which scans only the ten-plus-one most recently updated readable collections, since every row write touches its collection's `updated_at`) |
| `binSoon` | `{ type, id, title, purge_after }`: the caller's Bin items purged within three days |
| `upcoming` | `{ eventId, calendarId, title, start, end, allDay, date }`: occurrences on readable calendars over the next seven local days, not yet ended (Calendar, Wave 12; see § Calendar) |
| `storage` | one item `{ usedBytes, binnedBytes, quotaBytes }`: bytes counted against the quota (live and binned), the binned part, and the quota (`null` = unlimited) |

Errors: 400 when `tz` is not an IANA zone `Intl` accepts (list entries and the aliases browsers still report) or `sections` names an unknown section; 429 `RATE_LIMITED` with `Retry-After` above 30 requests a minute per user.

## Preferences (Wave 13, D92, D114)

Per-user settings that follow the account across devices. Today they hold only the modules the user turned off in **Settings → Modules** (migration 016, `server/preferences.ts`).

```ts
type ModuleId = "notes" | "files" | "tasks" | "collections" | "calendar" | "search" | "bin" | "notifications" | "team";
type Preferences = { disabledModules: ModuleId[]; revision: number; updatedAt: string | null };
```

- **A hidden module is not a security boundary (T97).** Preferences only hide UI in the web app. Every API route, ACL, MCP tool, calendar feed, reminder, and push keeps working for a module that is turned off, and keeps enforcing its own access rules. MCP never reads preferences, and there is no MCP tool to change them.
- `team` is reserved for Wave 14. Home and Settings are not modules and cannot be turned off.
- A user without a row has every module on: `{ disabledModules: [], revision: 0, updatedAt: null }`. Modules added later start on.
- `disabledModules` is returned unique and in the order above. Ids the server no longer knows are dropped on read.

| Endpoint | Body | Returns | Errors |
| --- | --- | --- | --- |
| `GET /api/preferences` | | 200 `{ preferences }` | |
| `PUT /api/preferences` | `{ disabledModules: ModuleId[], revision }` (strict; unique known ids, at most one per module; `revision` is the one last read, `0` before the first save) | 200 `{ preferences }` with `revision` + 1 (the first save creates revision 1) | 400 for an unknown or repeated id, a missing or negative `revision`, or an extra key. 409 `PREFERENCES_CHANGED` with the current `preferences` when `revision` is stale (compare-and-swap, one writer wins) |

`GET /api/auth/me` adds `preferences: Preferences`, so the app knows which modules to show before its first render. It is served before the TOTP setup gate, like the rest of `/auth/me`; `/api/preferences` is behind it. Each successful PUT is audited as `preferences.update { disabledModules, revision }` (module ids only).

## MCP keys and tools (Wave 8)

### Keys

| Endpoint | Body | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/mcp/keys` | | 200 `{ keys: McpKey[] }` (active keys, newest first) | |
| `POST /api/mcp/keys` | `{ name, password, totpCode? \| recoveryCode?, scopes? }` | 201 `{ key: McpKey & { token, userId, prefix, createdAt } }`; the token is shown once | 400 (bad name or scopes), 401 (password or second factor), 409 (10 active keys) |
| `DELETE /api/mcp/keys/:id` | `{}` | 200 `{ ok: true }` | 404 |

```ts
type McpScope = "notes:read" | "notes:write-draft" | "files:read" | "tasks:read" | "tasks:write" | "today:read"
  | "calendar:read" | "calendar:write" | "collections:read" | "collections:write";
type McpKey = { id: string; name: string; key_prefix: string; scopes: McpScope[]; created_at: string; last_used_at: string | null };
```

- `scopes`: 1–10 unique values (one per defined scope), default `["notes:read"]`. A write scope adds its read scope (`notes:write-draft` → `notes:read`, `tasks:write` → `tasks:read`, `calendar:write` → `calendar:read`, `collections:write` → `collections:read`). Scopes are returned in the order above and cannot be changed later; create a new key instead.
- Keys created before migration 010 have `["notes:read"]`.
- The audit row `mcp.key_created` records `{ keyId, name, scopes }`.

### Tools

`/mcp` (outside `/api`) speaks Streamable HTTP with `Authorization: Bearer <token>`; transport, key format, Host/Origin checks, and body limits are unchanged. `tools/list` returns only the tools the key's scopes allow, and each handler checks the key again. Tools run as the key's owner.

| Tool | Scope | Arguments | Result |
| --- | --- | --- | --- |
| `list_notes` | notes:read | `{ query? }` title filter | `{ notes }`: published notes the owner can read |
| `read_note` | notes:read | `{ noteId }` | `{ id, title, version, markdown }` of the published version |
| `search_notes` | notes:read | `{ query (1–200), folderId?, limit? (1–20, default 10) }` | `{ results: { id, title, snippet, version, folder_id, owner_name, is_owner, updated_at }[], truncated }`. Published text only (never drafts, not even the owner's); the title comes from the published version; snippets are plain text; query rules and live access as in `GET /api/search` |
| `list_folders` | notes:read or files:read | `{}` | `{ folders }` as `GET /api/folders` |
| `create_note` | notes:write-draft | `{ markdown (not blank), folderId? }` | `{ noteId, revision: 1, title, folderId, url }`: a never-published note whose draft is `markdown`, in an owned folder (default: Default) |
| `get_note_draft` | notes:write-draft | `{ noteId }` (owned) | `{ noteId, revision, hasDraft, markdown, publishedVersion, url }`. Without a draft, `revision` is null and `markdown` is the published text |
| `update_note_draft` | notes:write-draft | `{ noteId, markdown, baseRevision: number \| null, mode: "replace" \| "append" }` | `{ noteId, revision, title, hasDelta, url }`. Append adds `markdown` as a new paragraph. Never publishes or creates a version |
| `list_documents` | files:read | `{ folderId? }` | `{ documents: DocumentSummary[] }` as `GET /api/files` |
| `get_document_metadata` | files:read | `{ documentId }` | `{ document: DocumentSummary }` under the Files list predicate |
| `read_document_text` | files:read | `{ documentId }` | `{ id, name, mimeType, sizeBytes, text }` for `preview_kind = 'text'` up to 1 MiB, strict UTF-8 |

| `list_boards` | tasks:read | `{}` | `{ boards }` as `GET /api/tasks/boards` |
| `list_cards` | tasks:read | `{ boardId, columnId? }` | `{ board: { id, name, owner_name, is_owner }, columns: { id, name, position, wip_limit }[], cards: { id, column_id, column_name, position, title, description_preview, revision, creator_name, due_on, due_time, due_tz, due_at, assignees: string[], assignee_name, comment_count, attachments: string[], updated_at }[] }`. `assignees` are display names in assignment order (Wave 13); `assignee_name` is the first one. `description_preview` is plain text, at most 280 characters; `attachments` are file names only. A `columnId` not on the board is `NOT_FOUND` |
| `get_card` | tasks:read | `{ cardId }` | `{ card: { id, board_id, board_name, column_id, column_name, title, description, revision, creator_name, due_on, due_time, due_tz, due_at, assignees: string[], assignee_name, created_at, updated_at }, comments (latest 50), hasMoreComments, attachments: string[] }`. `description` is plain text |
| `create_card` | tasks:write | `{ boardId, columnId, title, description?, dueOn?, dueTime?, dueTz?, assigneeIds? (≤ 20), afterCardId? }` | `{ card: { id, board_id, column_id, title, revision, due_on, due_time, due_tz, due_at, assignees: string[], assignee_name } }`. `afterCardId` omitted = bottom, `null` = top. Same validation as `POST /api/tasks/boards/:b/cards`; a full column is `COLUMN_FULL` |
| `update_card` | tasks:write | `{ cardId, baseRevision, title?, dueOn?, dueTime?, dueTz?, assigneeIds? }` (no other keys) | `{ card }` as `create_card` returns it, with `revision + 1`. Same validation as `PATCH /api/tasks/cards/:k`: `dueOn: null` clears the date and time, `dueTime: null` only the time, `assigneeIds` replaces the set. **Never changes the description** (a `description` key is `INVALID`, §11 Q8). `CARD_CHANGED` with `currentRevision` when `baseRevision` is stale. Wave 13 |
| `move_card` | tasks:write | `{ cardId, columnId, afterCardId? }` | `{ card: { id, column_id, position } }`. Same board only; `afterCardId` omitted = bottom, `null` = top; moving into another column at its WIP limit is `COLUMN_FULL` |
| `comment_on_card` | tasks:write | `{ cardId, body }` | `{ comment: { id, card_id, created_at } }`, authored by the key's owner |
| `get_today` | today:read | `{ tz? }` (IANA, default UTC) | The `GET /api/today` body, titles and ids only, with only the sections the key may read (T74): task sections need `tasks:read`, `notesRecent`/`drafts`/`agentDrafts` need `notes:read`, `files` needs `files:read`, `collectionsRecent` needs `collections:read`, `upcoming` needs `calendar:read`; `binSoon` and `storage` need `today:read` alone, and `binSoon` keeps only item types the key may read (notes: `notes:read`, documents: `files:read`, cards and boards: `tasks:read`, collections and rows: `collections:read`, calendars and events: `calendar:read`). It shares the 30-a-minute per-user Today limit (`RATE_LIMITED` with `retryAfterSeconds`). `list_cards` and `get_card` also return `due_on` and `assignee_name` |
| `list_calendars` | calendar:read | `{}` | `{ calendars: { id, name, role, color, ownerName }[] }` as `GET /api/calendars` (a first call creates "Personal", as there) |
| `list_events` | calendar:read | `{ from, to, calendarIds? (≤ 50), tz? }` (dates, `to` exclusive, at most 100 days) | `{ occurrences: { eventId, calendarId, title, location, start, end, allDay, recurring, date }[], truncated }` as `GET /api/events` |
| `get_event` | calendar:read | `{ eventId }` | `{ event: { id, calendarId, calendarName, title, description, location, allDay, start, end, tz, durationMinutes, repeat, exdates, updatedAt }, revision, role, links, url }`. `description` is plain text; `links` are `{ targetType, targetId, title }` or `{ targetType, restricted: true }` |
| `create_event` | calendar:write | `{ calendarId, title, allDay, start, end?, durationMinutes?, tz?, repeat?, description?, location? }` | `{ eventId, revision: 1, url }`. All-day: `start`/`end` are dates (`end` exclusive, default the next day). Timed: `start` is local `yyyy-mm-ddTHH:MM` in `tz`, with `durationMinutes` or a local `end`. Editor role; validated by the `POST /api/calendars/:k/events` schema |
| `update_event` | calendar:write | `{ eventId, baseRevision, title?, allDay?, start?, end?, durationMinutes?, tz?, repeat?, description?, location? }` | `{ eventId, revision, url }` or `EVENT_CHANGED` with `currentRevision`. Undoable in the app |
| `create_reminder` | calendar:write | `{ eventId, offsetMinutes, tz? }` or `{ title, fireAt, tz? }` (`tz` default UTC) | `{ reminderId, nextFireAt, eventId }`, always for the key's owner; viewers may set reminders on events they can read |
| `list_collections` | collections:read | `{}` | `{ collections: { id, name, role, rowCount, ownerName, fields: { id, name, type, required?, unit?, decimals?, options?: { id, label }[] }[] }[] }` |
| `query_rows` | collections:read | `{ collectionId, filters?: { field, op, value? }[] (≤ 10), sort?: { field, direction? }[] (≤ 3), q?, limit? (1–50, default 20), cursor? }` | `{ rows: McpRow[], total, nextCursor }`. `field` is a field name or id; select values may be labels. Operators and cursors as `POST /api/collections/:c/query` |
| `get_row` | collections:read | `{ rowId }` | `{ row: McpRow, revision, role, collectionName }` |
| `create_row` | collections:write | `{ collectionId, values }` | `{ rowId, revision: 1, url }`. Editor role; the row goes at the bottom |
| `update_row` | collections:write | `{ rowId, values, baseRevision }` | `{ rowId, revision, url }` or `ROW_CHANGED` with `currentRevision`. Values merge; `null` clears a field |

Task tools call the `/api/tasks` services as the key's owner, so the W9 rules apply unchanged: any board reader (owner, member, everyone on an `all_users` board) may create, update, move, and comment; a board the user cannot read, and every id on it, is `NOT_FOUND`, identical to a missing id. There are no tools that edit descriptions, delete, or bin cards, or that change columns, WIP limits, sharing, or boards. `ASSIGNEE_NOT_MEMBER` and the due-time rules are `INVALID` (with `reason` when the service gave a code). A stale `afterCardId` returns `STALE_POSITION` with `columnId` and the column's current `order`; `LIMIT_REACHED` passes through the board caps. Task writes are audited through the usual `task.card_create`, `task.card_update`, `task.card_move`, and `task.comment_create` events with `{ via: "mcp", keyId }` added.

Calendar tools call the `/api/calendars`, `/api/events`, and `/api/reminders` services, and collection tools the `/api/collections` services, as the key's owner (D70, T72–T75). Readers read; only the owner and editors write (a viewer gets `READ_ONLY`); anything the user cannot read, including binned items, is `NOT_FOUND`. Writes are create and update only: there are no delete, exdate, share, feed, schema, view, attachment, or import tools. Every write sets `updated_via_key_id` (the event view's and row panel's "Changed by <key>", with Undo), is audited through the usual `event.create`, `event.update`, `reminder.create`, `collection.row_create`, and `collection.row_update` events with `{ via: "mcp", keyId }` added, and counts against the daily buckets below. A person's own edit or undo clears the key mark.

```ts
// Rows as agents see them: keyed by field name.
type McpRow = {
  id: string; collectionId: string; title: string;
  values: Record<string, string | number | boolean | string[]   // select → label, multi_select → labels, file → attachment names
    | { noteId: string; title: string } | { restricted: true }>;  // note fields
  revision: number; updatedAt: string; updatedBy: string | null;
  changedByKey: string | null;   // the key's name when the last change came through MCP
  url: string;                   // <origin>/collections/<c>/row/<r>
};
```

Collection `values` are keyed by field name (or id), with select options as labels (case-insensitive) or ids; unknown fields and file fields are `INVALID` with `fieldErrors` keyed by name, and the service's strict validation (types, required fields, readable note links, 16 KiB) applies unchanged. Field names `__proto__`, `constructor`, and `prototype` are refused by schema validation (400 `INVALID_SCHEMA`), since name-keyed inputs drop or refuse such keys; a collection that already has one still presents it as an ordinary key (row `values` objects have no prototype), and agents write it by field id.

Errors are tool results with `isError: true` whose text is `{ error, code, ...details }`:

| Code | When |
| --- | --- |
| `NOT_FOUND` | Missing, not readable, not owned (draft tools), binned, or not a Files document; all look the same |
| `INVALID` | Arguments fail validation (the transport may also reject them before the tool runs) |
| `SCOPE_REQUIRED` | The key lacks the tool's scope, or was revoked meanwhile |
| `RATE_LIMITED` | Per key: 120 calls and 30 writes per minute; per day 200 `create_note`, 500 task writes, 200 event writes (`create_event`, `update_event`), 100 `create_reminder`, and 500 row writes (`create_row`, `update_row`). Per user across keys: 1000 calls and 60 writes per minute; per day 400 `create_note`, 1000 task writes, 400 event writes, 200 reminders, and 1000 row writes. Includes `retryAfterSeconds` |
| `DRAFT_CHANGED` | `baseRevision` is not the current draft revision. Includes `currentRevision` |
| `STALE_POSITION` | `afterCardId` is not a live card in the target column. Includes `columnId` and the column's current `order` |
| `LIMIT_REACHED` | A module cap (cards per board, comments per card, events per calendar, reminders per event, rows per collection) |
| `READ_ONLY` | A viewer called a write tool on a calendar or collection shared read-only |
| `EVENT_CHANGED` | `update_event`'s `baseRevision` is not the event's revision. Includes `currentRevision` |
| `CARD_CHANGED` | `update_card`'s `baseRevision` is not the card's revision. Includes `currentRevision` only |
| `COLUMN_FULL` | `create_card` or `move_card` (from another column) into a column at its WIP limit. Includes `columnId`, `wipLimit`, and `cardCount` |
| `ROW_CHANGED` | `update_row`'s `baseRevision` is not the row's revision. Includes `currentRevision` |
| `REMINDER_EXISTS` | The key's owner already has a reminder at that offset on the event |
| `SCHEMA_CHANGED` | A `query_rows` cursor was issued before the collection's fields changed; start again without it |
| `NOT_TEXT` | Not a text file, or not valid UTF-8 |
| `TOO_LARGE` | Text file over 1 MiB, or Markdown over `MAX_MARKDOWN_BYTES` |
| `INTERNAL` | Integrity or server failure |

Note writes are audited as `mcp.note_create` and `mcp.note_draft_update` (`{ via: "mcp", keyId, mode?, revision? }`), task writes as their usual `task.*` events with `{ via: "mcp", keyId }` added; reads are not audited.

### Note fields for MCP drafts

- `GET /api/notes` rows gain `draft_mcp_key_name: string | null` (owner only, while a draft exists).
- `GET /api/notes/:id` gains `draftMcpKeyName: string | null` (owner only); `draft_mcp_key_id` is never returned.
- `POST /api/notes/:id/publish` takes `{ revision }`, the draft revision the client last saw; the app always sends it. A different revision returns 409 `{ code: "DRAFT_CHANGED", currentRevision }` and publishes nothing. Omitting it is allowed only when no MCP key wrote the draft (older clients); otherwise 400.
- Publishing, discarding the draft, and restoring a version to the draft clear `notes.draft_mcp_key_id`. A human autosave keeps it, because the draft still holds the key's text.

## Collections (Wave 11)

Typed tables ([WAVES_10-12.md](WAVES_10-12.md) §3). Every endpoint is under `/api/collections`, takes and returns JSON (except CSV export), and inherits the global session, Origin, CSRF, `Content-Type: application/json`, and TOTP rules. Path ids are UUIDs (400 otherwise). Request bodies containing `__proto__`, `constructor`, or `prototype` keys at any depth are rejected with 400.

### Schema

```ts
type FieldType = "text" | "number" | "date" | "checkbox" | "select" | "multi_select" | "url" | "note" | "file";
type SelectOption = { id: string /* o_[a-z0-9]{6} */; label: string /* 1–60, unique per field, case-insensitive */; color: "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" };
type FieldDefinition = {
  id: string;                          // f_[a-z0-9]{8}, generated by the server
  name: string;                        // 1–60 characters, unique case-insensitive
  type: FieldType;
  required?: true;                     // never on file fields
  number?: { decimals: number /* 0–6 */; unit: string /* ≤ 8 */ };   // number fields only
  options?: SelectOption[];            // select and multi_select only, ≤ 100
};
type CollectionSchema = { fields: FieldDefinition[] };   // 1–50 fields; fields[0] is text (the primary field, the row title); ≤ 65,536 bytes
type FieldInput = Omit<FieldDefinition, "id" | "options" | "required"> & { id?: string; required?: boolean; options?: Array<{ id?: string; label: string; color?: string }> };
```

- Ids are assigned by the server. An input `id` must name a field (or option) that already exists; fields and options without one are new.
- Allowed type changes: text ↔ url and select → multi_select. Anything else is 400 `INCOMPATIBLE_TYPE_CHANGE`; other schema errors are 400 `INVALID_SCHEMA`.

**Values** are keyed by field id. Writes are strict (400 `INVALID_VALUES { fieldErrors: { [fieldId]: message } }`); reads are lenient (values of removed fields or options, or of a now-incompatible type, read as empty and are dropped on the next write). `null` or an empty value clears a field.

| Type | Stored value |
| --- | --- |
| `text` | string ≤ 4000 characters: NFC, CRLF → LF, controls (other than tab and newline) and bidi overrides stripped, trimmed |
| `number` | finite JSON number |
| `date` | `YYYY-MM-DD`, a real calendar date |
| `checkbox` | `true` (false clears) |
| `select` | one option id |
| `multi_select` | ≤ 20 distinct option ids |
| `url` | `http:` or `https:` URL, ≤ 2048 characters |
| `note` | a note uuid the writer can read at write time |
| `file` | never stored; derived from attachment links |

A row's values JSON is at most 16,384 bytes. Required fields must be set on create and cannot be cleared.

**Templates** (`GET /templates`): `inventory`, `subscriptions`, `expenses`, `recipes`, `contacts`. A template's fields are copied into the new collection with fresh ids.

### Roles

A collection's readers are its owner, its members when `visibility = 'selected'`, and every user when `visibility = 'all_users'`. The audience has one role, `share_role` (`viewer` or `editor`, D54): editors create, edit, undo, and bin rows. Only the owner edits the name, icon, schema, views, and sharing, and deletes. A caller who cannot read the collection gets **404** on every route (path ids are always joined to their collection); a viewer writing a row gets **403** `READ_ONLY`; a non-owner calling an owner-only route gets **403** `OWNER_ONLY`. Binned collections and rows are unreadable for everyone.

**Caps** (409 `LIMIT_REACHED`): 100 live collections per owner, 10,000 live rows per collection, 20 views per collection, 20 attachments per row.

```ts
type CollectionSummary = {
  id: string; name: string /* 1–120 */; icon: string /* [a-z0-9-]{1,32} */;
  owner_id: string; owner_name: string; is_owner: 0 | 1;
  role: "owner" | "editor" | "viewer";
  visibility: Visibility; share_role: "viewer" | "editor";
  row_count: number; field_count: number; template_id: string | null;
  created_at: string; updated_at: string;
};
type CollectionDetail = CollectionSummary & { fields: FieldDefinition[]; schema_version: number };
type NoteLink = { id: string; title: string } | { id: string; restricted: true };
type RowSummary = {
  id: string; collection_id: string; position: number;
  title: string;                          // the primary field's text
  values: Record<string, FieldValue>;     // lenient read against the current schema
  links: Record<string, NoteLink>;        // note fields, resolved for the caller (never an unreadable title)
  revision: number; can_undo: boolean;
  created_by: string | null; created_by_name: string | null; updated_by_name: string | null;
  updated_via_key_id: string | null;      // set by MCP writes (Stage E); cleared by a person's edit or undo
  updated_via_key_name: string | null;    // that key's name while it exists ("Changed by <key>")
  created_at: string; updated_at: string;
};
```

### Collections and rows

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /` | any | 200 `{ collections: CollectionSummary[] }`: owned first, then shared, each by name (limit 500) | |
| `GET /templates` | any | 200 `{ templates: [{ id, name, icon, description, fields: [{ name, type }] }] }` | |
| `POST / { name, icon?, templateId?, fields? }` | any | 201 `{ collection: CollectionDetail }`. Neither `templateId` nor `fields` gives Name + Notes. | 400 (`INVALID_SCHEMA`, unknown template, both given), 409 `LIMIT_REACHED` |
| `GET /:c` | reader | 200 `{ collection, role, views }` | 404 |
| `PATCH /:c { name?, icon? }` | owner | 200 `{ collection }` | 400, 403, 404 |
| `DELETE /:c` | owner | 200 `{ ok: true, purgeAfter }`: to the Bin with its rows | 403, 404 |
| `PUT /:c/schema { fields: FieldInput[], schemaVersion }` | owner | 200 `{ collection }` with `schema_version + 1` | 400 `INVALID_SCHEMA` / `INCOMPATIBLE_TYPE_CHANGE`, 403, 404, 409 `{ code: "SCHEMA_CHANGED", collection }` |
| `POST /:c/query { viewId?, sort?, filters?, q?, cursor?, limit? }` | reader | 200 `{ rows: RowSummary[], nextCursor: string \| null, schemaVersion, total }` | 400 `INVALID_QUERY` / `INVALID_CURSOR`, 404, 409 `SCHEMA_CHANGED` |
| `POST /:c/rows { values, afterRowId? }` | editor | 201 `{ row }`. Omitted `afterRowId` = bottom, `null` = top. | 400 `INVALID_VALUES`, 403 `READ_ONLY`, 404 (collection, or an anchor not in it), 409 `LIMIT_REACHED` |
| `GET /rows/:r` | reader | 200 `{ row, role, schemaVersion }` | 404 |
| `PATCH /rows/:r { values, revision }` | editor | 200 `{ row }`: `values` is merged; `revision + 1`; the previous values are kept for undo | 400, 403, 404, 409 `{ code: "ROW_CHANGED", row }` |
| `POST /rows/:r/undo { revision }` | editor | 200 `{ row }`: the previous values, projected onto the current schema; undo is one step | 403, 404, 409 `ROW_CHANGED` or `NOTHING_TO_UNDO`. An undo of an attach or unlink follows those routes' rules for the caller: every link it puts back must be to a document the caller owns, and every link it removes must be the caller's own unless the caller owns the collection; otherwise the whole undo is refused with 403 `{ code: "NOT_LINKER", documentIds }` and nothing changes |
| `DELETE /rows/:r` | editor | 200 `{ ok: true, purgeAfter }`: to the Bin | 403, 404 |

### Saved views

```ts
type ViewConfig = { sort?: SortSpec[] /* ≤ 3 */; filters?: FilterSpec[] /* ≤ 10 */; hiddenFieldIds?: string[] /* never the primary field */ };
type CollectionView = { id: string; collection_id: string; name: string /* 1–60 */; kind: "table"; config: ViewConfig; position: number; created_at: string; updated_at: string };
```

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `POST /:c/views { name, kind?: "table", config }` | owner | 201 `{ view }` (appended) | 400 `INVALID_QUERY` (config does not compile against the schema, unknown hidden field) or over 8 KiB, 403, 404, 409 `LIMIT_REACHED` (20) |
| `PATCH /views/:v { name?, config? }` | owner | 200 `{ view }` | 400, 403, 404 |
| `DELETE /views/:v` | owner | 200 `{ ok: true }` | 403, 404 |

Views are listed by `GET /:c` for every reader and used through `POST /:c/query { viewId }`; a view id from another collection is 404. `q` is never stored. `kind: "board"` is reserved. Audit: `collection.view_create`, `collection.view_update`, `collection.view_delete` with `{ collectionId, viewId }`.

### Row attachments

`file` values are derived from links (D58): `RowSummary.files` is `{ [fieldId]: AttachmentSummary[] }` with `AttachmentSummary = { id, name, mime_type, preview_kind, size_bytes, linked_by, created_at }`, live documents only. Uploads for rows use `POST /api/files?purpose=collection_attachment` (no `folderId`, 400 otherwise): the document is stored with `folder_id = NULL`, counts against the uploader's quota, and never appears in `GET /api/files`, folder counts, or the Files Bin filter.

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `POST /rows/:r/attachments { documentId, fieldId }` | editor that owns the document | 201 `{ row }` | 400 (not a file field), 403 `READ_ONLY`, 404 (row, or a document that is not the caller's live `file` or `collection_attachment` document), 409 `ALREADY_ATTACHED` / `LIMIT_REACHED` (20 per row) |
| `DELETE /rows/:r/attachments/:d` | editor who linked it, or the owner | 200 `{ row, documentBinned }` | 403 `READ_ONLY` / `NOT_LINKER`, 404 |

- **Access.** A linked document is readable (`GET /api/files/:id`, `/content`) by anyone who can read a live row that links it in a live collection; the check is live, so unsharing, binning the row or collection, or unlinking ends access at once (T58). This path is OR-ed into `readableDocument*` only, never into lists.
- **Files routes.** Rename, move, and sharing (`PATCH /api/files/:id`, `GET|PUT /api/files/:id/sharing`) are 404 for any document whose `purpose` is not `file`, and sharing rows or folder access never apply to such documents. `DELETE /api/files/:id` on a row attachment that a row still links is 409 `ATTACHMENT_LINKED`.
- **Never linked.** The hourly sweeper moves `collection_attachment` uploads with no row link that are older than 24 hours to the uploader's Bin (100 per run, `deleted_by = NULL`, audit reason `attachment_never_linked`).
- **Lifecycle.** When the last link to a `collection_attachment` document is removed (unlink, or a row or collection purge), the document moves to the uploader's Bin (`deleted_by` = actor). Files items that were linked are never binned. Restoring an attachment from the Bin keeps `folder_id = NULL`.
- **Notes** in `note` fields never grant access: a note the caller cannot read resolves as `{ id, restricted: true }` (T59).
- Audit: `collection.row_attach` and `collection.row_detach` with `{ collectionId, rowId, documentId }`; a binned upload adds `document.delete { documentId, reason: "attachment_unlinked" }`.

### CSV import and export

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `POST /:c/import { csv, mapping?, dryRun }` | editor | dry run: 200 `{ dryRun: true, header, total, valid, errorCount, errors ≤ 50, mapping, preview ≤ 20, wouldExceedLimit }`; import: 200 `{ inserted }` | 400 `INVALID_CSV` (with `line`) / `INVALID_MAPPING` / `IMPORT_INVALID { errorCount, errors }`, 403 `READ_ONLY`, 404, 409 `LIMIT_REACHED`, 413 `IMPORT_TOO_LARGE`, 429 `RATE_LIMITED` |
| `GET /:c/export.csv?viewId=` | reader | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `no-store` | 400 (bad `viewId`), 404 (collection, or a view of another collection) |

- **Import** (D59, T56). `csv` is the file's text inside JSON, at most 2,000,000 UTF-8 bytes; the first record is the header, then at most 5000 rows of at most 50 columns (in-house RFC 4180 parser: quotes, doubled quotes, embedded line breaks, CRLF/LF/CR, BOM stripped, empty records skipped). `mapping` has one entry per header column: a field id or `null` to skip; without it, columns map to fields with the same name (case-insensitive). File fields cannot be mapped. Cells convert per type (numbers may use `,` separators; checkboxes accept yes/no/true/false/1/0/x; options match by label or id, several separated by `;`; notes by id and must be readable), then pass the same strict validation as `POST /rows`. `errors[].row` counts data rows from 1. A real import inserts every row in one transaction, indexed for search, or nothing; imports count five per minute per user, dry runs included. Audit: `collection.import { collectionId, count }`.
- **Export** (T55). The rows `POST /:c/query { viewId }` returns (all pages, in order) and the view's shown fields, as UTF-8 with a BOM and CRLF. Text cells (names, text, url, option labels, note titles, file names) that start with `=`, `+`, `-`, `@`, tab, or CR get a leading `'`; numbers, dates, and checkboxes are written as-is. Note titles follow the caller's access (empty when unreadable). Importing an export removes the added `'`. Audit: `collection.export { collectionId, count }`.

### Collection sharing

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /:c/sharing` | owner | 200 `{ visibility, role: "viewer" \| "editor", users: [{ id, display_name }] }` | 403 `OWNER_ONLY`, 404 |
| `PUT /:c/sharing { visibility: "private" \| "selected" \| "all_users", userIds ≤ 100, role? = "viewer" }` | owner | 200 `{ ok: true }` | 400, 403, 404 |

Same rules as board sharing: the owner cannot be a recipient (400), `selected` needs at least one user (400), every user must exist and be enabled (400), and member rows are kept only for `selected`. `role` applies to the whole audience (D54). Removing someone revokes access to the collection, its rows, its search hits, and its row attachments at once. Audit: `collection.sharing_changed { collectionId, visibility, role, recipientCount }`.

**Query** (D56, T54). `sort` ≤ 3 `{ fieldId, direction: "asc" | "desc" }` (text, url, number, date, checkbox, and select fields; select sorts by option order; empty values last); `filters` ≤ 10 `{ fieldId, op, value? }`, AND-ed; `q` ≤ 200 characters matches any text or url field (case-insensitive substring); `limit` 1–100 (default 50). Field ids are checked against the schema, operators are enumerated, and JSON paths are bound as parameters. With `viewId`, the view's sort and filters apply unless the request gives its own; view clauses that name removed fields are dropped.

| Types | Operators and `value` |
| --- | --- |
| text, url | `contains` / `equals` (non-empty string), `empty`, `not_empty` |
| number, date | `eq`, `lt`, `lte`, `gt`, `gte` (a number, or `YYYY-MM-DD`), `empty` |
| checkbox | `is` (boolean) |
| select | `is`, `is_not` (an option id), `in` (1–20 option ids) |
| multi_select | `has_any`, `has_all` (1–20 option ids) |
| note, file | `empty`, `not_empty` |

`nextCursor` is opaque: an offset bound to the spec and to `schema_version`. A cursor from another spec is 400 `INVALID_CURSOR`; after a schema change it is 409 `SCHEMA_CHANGED`. Offsets stop at 10,000.

**Audit** (ids and counts only, never values or names): `collection.create { collectionId, fieldCount, templateId? }`, `collection.update`, `collection.delete`, `collection.schema_update { collectionId, fieldCount }`, `collection.row_create`, `collection.row_update { collectionId, rowId, fieldCount }`, `collection.row_undo`, `collection.row_delete`.
## Calendar (Wave 12)

Calendars, events, links, reminders, notifications, Web Push, and iCalendar feeds ([WAVES_10-12.md](WAVES_10-12.md) §4, D54, D61–D66). JSON only, except the feed itself.

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
  revision: number; canUndo: boolean; changedByKey: boolean; changedByKeyName: string | null;  // MCP key behind the last change
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

**Tasks due (D67).** `include=tasks` (the only accepted value; anything else is 400) adds `tasks: [{ cardId, boardId, boardName, title, dueOn, dueTime, dueTz, dueAt, date }]`: live cards that fall in `[from, to)` for the viewer, on boards the caller can read (the Task Boards predicate), in columns not marked done, at most 200, ordered by `date` (date-only cards first, then timed ones by instant). A date-only card falls on its `due_on`; a card with a due time (Wave 13, §5.2) falls on the viewer-local day of its exact instant `dueAt` in `tz`, which `date` carries, so a card due 23:30 in UTC+14 shows a day earlier to a UTC−12 viewer. The query widens `[from, to)` by two days on each side before this filter (zones span 26 hours). The overlay is read-only and filters boards with `readableBoardPredicate` from `server/tasks/access.ts`. `cards.due_on` and `board_columns.is_done` come from migration 011, which always runs before 013. Without `include`, the key is absent.

**Links.** The linker must be able to read the target, and an unreadable target returns the same 404 as a missing one. Links are resolved per viewer on every read: the title when the viewer can read the target, otherwise `{ title: null, restricted: true }` (T59). Links never grant access. `note` targets use the live note ACL, `card` targets the Tasks board ACL (`readableCard`; the card's title), and `collection_row` targets the Collections ACL (`readableRow`; the row's primary field), each registered in `server/calendar/links.ts`.

**Audit.** `calendar.create`, `calendar.update`, `calendar.delete`, `calendar.sharing_changed { calendarId, visibility, shareRole, recipientCount }`, `event.create { eventId, calendarId }`, `event.update`, `event.undo`, `event.exdate`, `event.delete { eventId }`, `event.link` / `event.unlink { eventId, targetType, targetId }`. Ids only: titles, descriptions, and locations are never audited.

### Reminders and notifications (Wave 12 stage B)

Reminders are private to whoever set them (D64): every endpoint is scoped to the caller, and anyone who can read an event (viewers included) may set their own reminders on it.

```ts
type Reminder = { id: string; eventId: string | null; offsetMinutes: number | null; title: string | null; tz: string; nextFireAt: string | null; lastFiredAt: string | null; createdAt: string };
type NotificationItem = { id: string; title: string; href: string; late: boolean; read: boolean; createdAt: string; occurrenceStart: string | null };
```

| Endpoint | Success | Errors |
| --- | --- | --- |
| `GET /api/reminders?eventId` | 200 `{ reminders: Reminder[] }`: the caller's event reminders and upcoming standalone ones | 400 (malformed `eventId`) |
| `POST /api/reminders {eventId, offsetMinutes, tz}` | 201 `{ reminder }` | 400; 404 (event not readable); 409 `REMINDER_EXISTS` (same offset) or `LIMIT_REACHED` (10 per event per user) |
| `POST /api/reminders {title, fireAt, tz}` | 201 `{ reminder }` | 400 (`fireAt` is a real local `yyyy-mm-ddTHH:MM` in `tz`, in the future); 409 `LIMIT_REACHED` (500 upcoming standalone per user) |
| `DELETE /api/reminders/:id` | 200 `{ ok }` | 404 (missing or someone else's) |
| `GET /api/notifications?unread=1&limit` | 200 `{ items: NotificationItem[], unreadCount }`, newest first, `limit` 1–50 (default 20) | 400 |
| `POST /api/notifications/read {ids: uuid[1..100]} \| {all: true}` | 200 `{ ok, updated }`; ids that are not the caller's are ignored | 400 |

- `offsetMinutes` is how long before each occurrence starts the reminder fires (−1440 to 40320; negative is after the start). Timed events use their own zone; all-day events start at midnight in the reminder's `tz`, so 09:00 on the day is −540. A single event in the past has no upcoming time (400).
- **Dispatcher.** Every 30 s (an `unref` timer, one tick at a time, at most 200 reminders per tick) each due reminder is claimed, re-checked, written as a durable `notifications` row, and advanced to its next occurrence in one transaction. A reminder missed while the server was down fires once, `late: true`, when under 24 h late, and is skipped when later; either way it advances past now, so misses never pile up. At most 60 notifications per user per hour are written; the rest are dropped.
- **Access (T67).** At fire time the dispatcher re-checks that the user is still in the calendar's audience and deletes the reminder otherwise (audited `reminder.removed_access_lost`). A binned event or calendar pauses its reminders (`nextFireAt: null`); restoring it, editing the event's timing, undo, or skipping a date reschedules them.
- **Titles and links.** Titles are resolved when listed: the event's current title while the caller can read it, otherwise "An event you can no longer open"; a standalone reminder's own title. `href` is `/calendar/event/<id>` built from a validated event id, or `/notifications` (T68).
- **Retention.** The hourly sweeper deletes notifications after 30 days, and fired standalone reminders 30 days after they fired.
- **Audit.** `reminder.create { reminderId, eventId? }`, `reminder.delete { reminderId }`: ids only.
- **Today.** `listUpcoming(userId, tz, days)` in `server/calendar/service.ts` backs the `upcoming` section (registered in `server/today/providers.ts`, between `binSoon` and `storage`): unfinished occurrences through the next 7 local days, at most 10 with `more`, as `{ eventId, calendarId, title, start, end, allDay, date }`. `get_today` includes it, and calendar and event items in `binSoon`, only for keys that also hold `calendar:read` (T74).

### Web Push (Wave 12 stage C)

Payload-less Web Push (D65, T62, T63). A push has an empty body: it only wakes the device, and the service worker fetches `GET /api/notifications?unread=1` with the session cookie, so push services see timing only.

| Endpoint | Success | Errors |
| --- | --- | --- |
| `GET /api/push/config` | 200 `{ enabled: true, publicKey }` (base64url P-256 point) or `{ enabled: false, reason: "insecure_origin" \| "disabled" }` | — |
| `GET /api/push/subscriptions` | 200 `{ subscriptions: [{ id, label, createdAt, lastSuccessAt, disabled }] }` (endpoints are never returned) | — |
| `POST /api/push/subscriptions {endpoint, expirationTime?, keys: {p256dh, auth}, label?}` | 201 `{ subscription }`; 200 when the caller already has this endpoint (keys refreshed, failures cleared) | 400 `ENDPOINT_NOT_ALLOWED`; 409 `PUSH_DISABLED` or `LIMIT_REACHED` (10 per user) |
| `DELETE /api/push/subscriptions {id} \| {endpoint}` | 200 `{ ok }` | 404 (missing or someone else's) |
| `POST /api/push/test` | 200 `{ ok, sent, failed }` | 409 `PUSH_DISABLED`; 429 `RATE_LIMITED` with `Retry-After` (5 per hour per user) |

- **Enabled.** `PUSH_ENABLED=auto` turns push on only when `APP_ORIGIN` is `https:`; `true` forces it on and `false` off. When on, a VAPID ES256 key pair is created at first boot in `DATA_DIR/push/vapid.json` (0600, written atomically).
- **Endpoints.** `https:` on port 443, no credentials, not an IP literal, and a host on the allowlist (`*.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, plus `PUSH_ENDPOINT_HOSTS`). Every address the host resolves to must be public (no private, loopback, link-local, CGNAT, or multicast ranges); this is checked when subscribing and again before each delivery. An endpoint is owned by one account: subscribing it from another account moves it.
- **Delivery.** After each dispatcher tick commits, every user who got a notification gets one push per device: `POST` with no body, `TTL: 3600`, `Urgency: normal`, and `Authorization: vapid t=<JWT>, k=<publicKey>` (claims `aud` = the endpoint's origin, `exp` = 12 h, `sub` = `PUSH_SUBJECT`). Redirects are not followed and requests time out after 5 s. 404 or 410 deletes the subscription; any other failure (including a redirect) counts, and 5 consecutive failures disable it until the device subscribes again.
- **Audit.** `push.subscribe { subscriptionId }`, `push.unsubscribe`. Endpoints and keys are never logged or audited.

<a id="calendar-feeds"></a>
### iCalendar feeds (Wave 12 stage D)

Read-only subscription links for phone and desktop calendars (D66, T64, T65, T70). A reader of a calendar (owner, editor, or viewer) creates up to **5** live links per calendar, each `busy` (times only, every event titled "Busy", and the calendar named "Busy") or `full` (titles, locations, and descriptions). The token is returned once and stored only as its SHA-256 hash plus a 13-character display prefix (`nookfeed_` and four characters).

```ts
type CalendarFeed = { id: string; calendarId: string; prefix: string; detail: "busy" | "full"; createdAt: string; lastUsedAt: string | null };
```

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/calendars/:k/feeds` | reader | 200 `{ feeds: CalendarFeed[] }`: the caller's own live links for this calendar, newest first | 404 |
| `POST /api/calendars/:k/feeds {detail}` | reader | 201 `{ feed, token, url }`; `url` is `<origin>/api/calendars/:k/feed.ics?token=<token>` on the request's origin when it is one of `APP_ORIGINS`, else `APP_ORIGIN` | 400; 404; 409 `LIMIT_REACHED` (5 live links per user per calendar) |
| `DELETE /api/feeds/:f` | the link's creator | 200 `{ ok }`; the link stops working at once | 404 (unknown, revoked, or someone else's) |
| `GET /api/calendars/:k/feed.ics?token=` | the token | 200 `text/calendar; charset=utf-8` | 404 for every failure; 429 with `Retry-After` above 60 fetches per hour per live token, and for failures past 30 per minute from one client address (live tokens from that address still work). Unknown tokens never get a per-token entry; both limiters are capped and evict the least recently used entry |

- **Authentication.** The feed route is the only `/api` path outside the session and TOTP middleware. `isFeedRequest` in `server/calendar/feeds.ts` exempts exactly `GET` or `HEAD` of `/api/calendars/<uuid>/feed.ics`; every other method, and any other path, still needs a session. Tokens are created from a signed-in (and, under `TOTP_POLICY=required`, gated) session.
- **Live access.** Every fetch re-checks that the token's creator is enabled, still allowed by `ALLOWED_EMAILS`, and can still read the calendar. A malformed, unknown, or revoked token, a token for another calendar, a binned calendar, and a creator who lost access all return the same `404 {"error":"Not found"}`.
- **Output (RFC 5545).** `VERSION:2.0`, `PRODID:-//Nook//Calendar feed//EN`, `METHOD:PUBLISH`, `X-WR-CALNAME`; one `VEVENT` per live event with `UID:<event id>@nook`, `DTSTAMP`, timed `DTSTART;TZID=<zone>:<local>` plus `DURATION:PT<n>M` or all-day `DTSTART;VALUE=DATE`/`DTEND;VALUE=DATE`, `RRULE` (`FREQ`, `INTERVAL`, `WKST=MO` and `BYDAY` for weekly, `COUNT`, or `UNTIL` as a date for all-day events and as the last second of the until day in UTC for timed ones), and `EXDATE` in the same form as the start. No `VTIMEZONE` blocks. `SUMMARY`, `LOCATION`, and `DESCRIPTION` are escaped (`\\`, `\;`, `\,`, and every CR, LF, CRLF, U+2028, or U+2029 as `\n`; other control characters dropped); lines are folded at 75 octets without splitting a UTF-8 sequence, with CRLF endings. At most 5000 events, most recent series first.
- **Headers.** `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and the global CSP unchanged. No cookie is set.
- **Bookkeeping.** `last_used_at` is written at most every 10 minutes. The token is never logged or audited; `calendar.feed_created` and `calendar.feed_revoked` record `{ feedId, calendarId }` only. Purging a calendar deletes its links.

<a id="calendar-items-in-the-bin"></a>
### Calendar items in the Bin (D68)

`DELETE /api/calendars/:k` and `DELETE /api/events/:e` move items to the shared Bin through Bin providers registered by `server/calendar/calendarBin.ts` (like Collections), with the same columns (`board_*` and `attachment*` null/false), 30-day retention, tombstone, and compare-and-swap restore as notes and documents (no bytes to remove).

| Item | Listed for | Restore | Delete forever |
| --- | --- | --- | --- |
| `calendar` (`folder_id`/`folder_name` null) | its owner | owner | owner; cascades to its events, members, links, reminders, and feeds |
| `event` (`folder_id`/`folder_name` = its calendar) | the calendar's owner, and whoever deleted it while they can still edit the calendar (`can_purge: false` for them) | the same two | the calendar's owner only (404 for anyone else) |

- A binned calendar hides all of its events; they are not listed one by one and come back with it.
- Restore responses for these types are `{ ok: true, calendarId, calendarName }` (plus `alreadyRestored: true` for a live item). Restoring an event whose calendar is in the Bin returns 409 `{ code: "PARENT_IN_BIN" }`; restoring a calendar when the owner already has 20 live ones returns 409 `{ code: "LIMIT_REACHED" }`. A purge in progress returns 409 `PURGING`, as for other types.
- `GET /api/bin?type=calendar|event` filters; the Bin app's Calendar chip shows both.
- Empty Bin purges the caller's binned calendars and the binned events on calendars they own; events they deleted on someone else's calendar stay for that owner.
- The hourly sweeper resumes tombstones and purges expired calendars and events with the same per-table budgets (events first).
- Audit: `calendar.restore { calendarId }`, `event.restore { eventId, calendarId }`, `calendar.purge { calendarId, reason }`, `event.purge { eventId, reason }` with `reason` `user`, `retention`, or `resumed`.

## Changes to existing note endpoints (Wave 4)

- `DELETE /api/notes/:id`:
  - Blank never-published note → purged immediately → `{ ok: true, purged: true }`.
  - Any other note → moved to the Bin → `{ ok: true, purgeAfter }`.
  - The response is 404 for missing notes, as it is today.
- `DELETE /api/notes/:id/draft` on a never-published note:
  - Blank → purged immediately.
  - Content → moved to the Bin with the draft file and `draft_revision`/`draft_checksum` **kept** (today this route deletes them). The response still returns `{ ok: true }`, plus `binned: true`, so the client can pick the right toast.
- "Blank" means `current_version = 0` and the draft is absent or empty after `trim()` (DEVELOPMENT_PLAN §9.1).
- Unchanged: every read endpoint continues to exclude `deleted_at IS NOT NULL`. So do all MCP tools.
