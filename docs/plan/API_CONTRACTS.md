# API contracts: Files, content, Bin, Search, and Tasks

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
type BoardColumn = { id: string; board_id: string; name: string /* 1–60 */; position: number; created_at: string; updated_at: string };
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

Stage A sets the board's Bin columns only; restore, purge, and Bin listing arrive with stage D.

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
| `PATCH /columns/:c { name?, afterColumnId? }` | owner | 200 `{ column, columns, renormalized? }` | 400 (neither field, or after itself), 403, 404 |
| `DELETE /columns/:c` | owner | 200 `{ ok: true, columns }` | 403, 404, 409 `COLUMN_NOT_EMPTY` (with `cardCount`) or `LAST_COLUMN` |

Binned cards do not block deleting their column; they keep `column_id = NULL` and restore to the first column.

### Cards

```ts
type CardSummary = {
  id: string; board_id: string; column_id: string; position: number;
  title: string;                     // 1–200 characters, trimmed, no control characters
  has_description: 0 | 1;            // the board view never carries descriptions
  revision: number;                  // starts at 1, +1 on every title/description edit
  created_by: string | null; creator_name: string | null;
  comment_count: number; attachment_count: number;
  created_at: string; updated_at: string;
};
type CardDetail = CardSummary & { description: string };  // Markdown, at most 65,536 UTF-8 bytes
```

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `POST /boards/:b/cards { columnId, title, description?, afterCardId? }` | reader | 201 `{ card: CardDetail, renormalized? }`. Omitted `afterCardId` = bottom, `null` = top. | 400, 404 (board, or a column not on this board), 409 `STALE_POSITION` or `LIMIT_REACHED` |
| `GET /cards/:k` | reader | 200 `{ card: CardDetail, comments: [], attachments: [] }` (both lists fill in with stages B and C) | 404 |
| `PATCH /cards/:k { title?, description?, revision }` | reader | 200 `{ card }` with `revision + 1` | 400, 404, 409 `{ code: "CARD_CHANGED", card }` (the current card) when `revision` is not the stored one |
| `POST /cards/:k/move { columnId, afterCardId }` | reader | 200 `{ card, renormalized?, positions? }`. `afterCardId: null` = top. `positions` lists `{ id, position }` for the whole target column after a renumber. | 400, 404 (card, or a column not on the card's board), 409 `STALE_POSITION` |
| `DELETE /cards/:k` | reader | 200 `{ ok: true, purgeAfter }`: the card moves to the Bin and keeps its column | 404 |

- **Stale positions.** `afterCardId` must be another live card in the target column. Otherwise (binned, in another column or board, the moved card itself, or unknown) the response is 409 `{ error, code: "STALE_POSITION", columnId, order: string[] }`, where `order` is the target column's live card ids in their current order.
- **Moves** stay on the card's board and do not change `revision`, so an open editor can still save.
- Binned cards and cards on binned boards return 404 on every card route. Restore arrives with stage D.

**Audit** (ids only, never names or text): `task.board_create`, `task.board_rename`, `task.board_delete`, `task.board_sharing_changed { boardId, visibility, recipientCount }`, `task.column_create`, `task.column_rename`, `task.column_move`, `task.column_delete`, `task.card_create`, `task.card_update`, `task.card_move { boardId, cardId, columnId }`, and `task.card_delete`, each with `{ boardId, columnId?, cardId? }`.

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
