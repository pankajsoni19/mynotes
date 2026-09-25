# Architecture

This document describes how Nook (formerly MyNotes) is built. For using the apps see [USING.md](USING.md); for running a server see [OPERATIONS.md](OPERATIONS.md). Internal identifiers keep the original `mynotes` prefix for compatibility with existing deployments and browsers: the `mynotes.sqlite` database, the `mynotes_session` cookie, the `mynotes` container, `MYNOTES_DATA_DIR` and its `/srv/mynotes` default, `mynotes:*` localStorage keys, `mynotes.*` history-state keys, `application/x-mynotes-*` drag types, the `mynotes_` API key prefix, and the `mynotes-*` backup archives.

## Runtime

One Bun process runs a Hono app that serves the built React SPA, the `/api` JSON API, document uploads and content, and the `/mcp` endpoint. SQLite uses WAL mode. All note content is read and written through a storage service that validates UUIDs, uses fixed derived paths, and performs atomic file replacement. Uploaded documents use a second, UUID-only store beside the notes (see [Documents](#documents)).

Upload slots, per-resource locks (`withResourceLock`, keyed `note:<id>` and `document:<id>`), the auth rate limiter, and the sweeper all live in process memory, so exactly one instance may use a data directory.

Request bodies are bounded in two layers. Bun's `maxRequestBodySize` is `max(MAX_UPLOAD_BYTES, 2_100_000) + 1 MiB`, which admits uploads. JSON and MCP bodies are read through `readBoundedBody`, which aborts with 413 as soon as more than 2.1 MB arrive, whether or not a `Content-Length` was sent.

## Identity and authorization

Passwords use Bun's asynchronous Argon2id implementation. A random opaque session token is stored only as a SHA-256 hash in SQLite and sent in an `HttpOnly`, `SameSite=Strict` cookie. Mutations require a same-origin request, JSON content type, and an authenticated session.

TOTP two-factor authentication is compatible with Google Authenticator (`SHA-1`, 6 digits, 30-second period). Secrets and revealable one-time recovery codes are encrypted at rest with AES-256-GCM using purpose-separated authenticated encryption and a key supplied outside the database through `.env`. Recovery-code viewing or regeneration requires password plus a fresh TOTP code. Accepted counters and recovery-code consumption are atomically persisted so credentials cannot be replayed. When TOTP is required, authenticated users without an enrolled factor can access only enrollment, session-status, and logout endpoints. Enabling or disabling a factor revokes every other session.

Database changes live in ordered files under `server/migrations`. Startup runs each pending migration in a SQLite transaction and records it in `schema_migrations` before routes are served. Released migrations are append-only:

| Id | Name | Adds |
| --- | --- | --- |
| 001 | `initial` | users, sessions, folders, folder and note shares, notes with visibility, note versions, audit log |
| 002 | `folder-sharing-and-defaults` | folder visibility, one Default folder per user, note `sharing_override` |
| 003 | `totp` | encrypted TOTP secrets and accepted-counter tracking |
| 004 | `totp-recovery-codes` | encrypted one-time recovery codes |
| 005 | `mcp-api-keys` | hashed MCP API keys with prefix, name, and revocation |
| 006 | `documents` | `documents` and `document_shares`, Bin columns on documents, per-owner `upload_key` for idempotency |
| 007 | `bin` | `deleted_by`, `purge_after`, `purge_started_at` on notes and Bin indexes; backfills previously soft-deleted notes (published ones get 30 days from the upgrade, never-published ones are due at once) |

Notes and documents share one folder tree and one access rule. An item is readable when it is live (`deleted_at IS NULL`) and one of these holds:

1. the caller owns it;
2. it has its own sharing (`sharing_override = 1`) and its visibility is `all_users`, or a note/document share row names the caller; or
3. it inherits (`sharing_override = 0`) and its **immediate** folder is `all_users` or shared with the caller. Folder sharing does not cascade to subfolders.

Only owners may edit, publish, restore, move, rename, delete, purge, or change sharing; recipients are read-only. Uploads and moves must target a folder the caller owns. Missing, forbidden, and binned items all answer 404. Recipients never see a shared folder's parent, and a document's `folder_id` is masked for them unless that folder is itself visible. The predicate lives in `server/access.ts` (notes), `server/documentAccess.ts` (documents), the `GET /api/notes` query, and `server/mcp.ts`.

## Draft and version state machine

```text
published ── first edit ──> draft ── publish ──> published (new immutable version)
    ^                         │
    └──── discard draft ─────┘

historical version ── restore ──> draft (never rewrites history)
```

`current.md` is a convenience mirror of the newest published version; authenticated reads use the immutable version file indexed by SQLite. `draft.md` exists only while a draft is active. All note mutations are serialized by note ID. Publishing writes the next version with exclusive-create semantics, commits version metadata with compare-and-swap state checks, then refreshes `current.md` and removes the draft. A retry can safely reuse an identical staged snapshot after interruption.

Deleting a note that was never published and whose draft is blank purges it at once. Any other deleted note, and every deleted document, goes to the Bin.

<a id="documents"></a>
## Documents

### Storage

```text
<DATA_DIR>/documents/
├── objects/<document-id>          committed bytes, 0600, no extension
└── .staging/<document-id>.part    in-flight uploads, 0600
```

The user's filename lives only in SQLite (`documents.name`), after sanitising: NFC normalisation, removal of control, bidi, and zero-width characters, trimming of edge dots and spaces, and a 255-byte limit that keeps a short extension. Paths are built only from server-generated UUIDs, confined to `DATA_DIR`, and opened with `O_NOFOLLOW`; staging files are created with `O_EXCL`. Rename and move change metadata only. Duplicate names in a folder are allowed.

### Upload pipeline

`POST /api/files?folderId=<uuid>` is the only route that accepts `multipart/form-data`; it still needs the allowed `Origin` and the `X-CSRF-Token` header.

1. Check that the target folder is owned by the caller (Default when omitted).
2. With an `Idempotency-Key` (a UUID, scoped per owner), a stored upload with the same key is replayed as 200 `idempotentReplay`; if that document is now in the Bin the answer is 409 `IDEMPOTENCY_KEY_USED`.
3. A declared `Content-Length` above `MAX_UPLOAD_BYTES` + 64 KiB is refused with 413 before reading. Chunked bodies without a length are accepted and bounded while streaming.
4. Take one of 3 per-user upload slots (429 otherwise), reserve the expected size against `USER_STORAGE_QUOTA_BYTES` (live plus binned bytes plus other in-flight reservations; 507 `QUOTA_EXCEEDED`), and check `statfs` free space against `MIN_FREE_DISK_BYTES` (507 `DISK_FULL`).
5. Stream the body through busboy into `.staging/<id>.part`, hashing with SHA-256 and keeping only the first 4100 bytes in memory. Limits: exactly one file part named `file`, no fields, at most 20 header pairs. Busboy's `parts` limit is 2 and its `fileSize` limit is `MAX_UPLOAD_BYTES + 1`, because busboy flags a part that *reaches* either limit; reaching them is treated as an extra part or an oversized file (400 or 413). Writes are awaited, so the socket is read only as fast as the disk accepts data.
6. Sniff the type, fsync, rename into `objects/`, and fsync both directories.
7. In one transaction, re-check idempotency, folder ownership, and the quota, then insert the row and audit `document.upload` (size and type, never the name). A failure removes the object; staging is discarded in `finally`.

### MIME sniffing and previews

`server/mimeSniff.ts` classifies from magic bytes only; the client's declared type is never an input.

| `preview_kind` | Detected from | Stored `mime_type` |
| --- | --- | --- |
| `image` | PNG, JPEG, GIF, WebP signatures | `image/png`, `image/jpeg`, `image/gif`, `image/webp` |
| `pdf` | `%PDF-` | `application/pdf` |
| `audio` | ID3, MPEG frame with `.mp3`, `OggS`, RIFF/WAVE, `ftyp` brand `M4A ` | `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/mp4` |
| `video` | `ftyp` MP4 brands, EBML with `webm` | `video/mp4`, `video/webm` |
| `text` | extension `.txt .md .markdown .csv .tsv .log .json` **and** valid UTF-8 with no NUL in the sample | `text/plain; charset=utf-8` |
| `none` | anything else, including SVG, HTML, XML, scripts, Office files, archives | `application/octet-stream` |

The UI renders images in `<img>`, opens PDFs in a new top-level tab (never framed), reads text with `Range: bytes=0-1048575` into a `<pre>` as React text nodes, and uses native audio/video players. `none` is download-only. Rename never changes the kind.

### Content responses

`GET` and `HEAD /api/files/:id/content?disposition=inline|attachment` (default `attachment`) is readable by any reader of the document. Inline is honoured only when `preview_kind ≠ none`; otherwise the response is `application/octet-stream` with `attachment`. `Content-Disposition` carries an ASCII fallback with CR, LF, quotes, backslashes, and controls stripped, plus a percent-encoded UTF-8 `filename*`.

The global `secureHeaders` middleware is skipped for exactly this route, which sets its own headers on every response, including errors from earlier middleware: `Content-Security-Policy: default-src 'none'; sandbox` (inline PDF gets `default-src 'none'; frame-ancestors 'none'` so browsers can render it), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, and `Cache-Control: private, no-store`. The strong `ETag` is the SHA-256.

A single `bytes` range (`a-b`, `a-`, `-n`) returns 206 with `Content-Range`; multiple ranges, other units, and malformed values return the full 200; an unsatisfiable range returns 416 with `bytes */size`; an `If-Range` that is not the current ETag returns 200. The object is opened with `O_NOFOLLOW` and its size checked with `fstat` (500 on an integrity failure, logging only the error class and id); the body streams from the file handle, which closes on end, error, or client abort. Streamed bodies are sent chunked. Downloads are not audited.

## Bin

Deleting moves a note or document to the owner's Bin: `deleted_at`, `deleted_by`, and `purge_after = deleted_at + 30 days` are set. Files, versions, and share rows are kept, and every read path (lists, content, versions, sharing, MCP) requires `deleted_at IS NULL`. Retention is a constant (`BIN_RETENTION_MS`).

```text
live ── delete ──> binned ── restore (CAS, no purge started) ──> live
                     │
                     ├── delete forever / Empty Bin / purge_after passed
                     v
                 tombstoned (purge_started_at set: unreadable, unrestorable)
                     │  remove bytes (ENOENT = success; any other error → stays here)
                     v
                 row deleted (cascades versions and shares), audited `<type>.purge`
```

Every step runs under the item's resource lock and is idempotent. Restore is a compare-and-swap that refuses rows with `purge_started_at` set (409 `PURGING`) and returns the item to its original folder if the owner still has it, otherwise to the owner's Default folder, reporting the new effective visibility. Purge audit reasons are `user`, `blank`, `retention`, or `resumed` (a purge the sweeper finished after an interruption; the original reason is not stored).

### Sweeper

`server/sweeper.ts` runs once at boot (without delaying startup) and hourly; overlapping calls share the run in flight.

1. Remove staging files older than one hour, and at boot every staging file older than the process.
2. Remove files in `objects/` older than one hour that have no `documents` row in any state. At boot, also log how many stored documents are missing or have the wrong size.
3. Per table (notes, documents): resume up to 50 tombstoned purges, then purge up to 100 items whose `purge_after` has passed, re-checking retention under the lock so an item restored and deleted again mid-run survives. The two budgets are separate, so repeatedly failing tombstones never starve due items; the rest waits for the next run.

Bin purges run even when the file sweep fails. Logs carry counts only.

## Search

Full-text search over notes (WAVES_7-9.md §2) uses an SQLite FTS5 table that stores its text, so `snippet()` and `highlight()` work (migration 008):

- `note_search_rows`: one row per `(note_id, kind)`, `kind` being `published` or `draft`, with the `source_checksum` of the text it was built from. `ON DELETE CASCADE` from `notes`.
- `note_fts(title, body)`: rowid = `note_search_rows.id`, tokenizer `unicode61 remove_diacritics 2` (case- and accent-folding) with prefix indexes of 2 and 3 characters. An `AFTER DELETE` trigger on `note_search_rows` removes the FTS row, so purging a note clears its index through the cascade.

**Text.** `server/search.ts` holds the pure helpers. `searchText()` projects Markdown to plain text: headings, paragraphs, link text, image alt text, table cells, and code are kept; URLs, HTML tags, and markup are dropped, as are control characters (the highlight markers are C0 controls). The title line is kept out of the body so snippets do not repeat it.

**Sync.** `server/searchIndex.ts` writes inside the same transaction as the notes change: a draft save indexes the draft (an empty one is unindexed), publish indexes the new version and removes the draft row, discarding a draft removes it, and restoring a version indexes the restored draft. The Bin changes nothing (search filters on `deleted_at`), and purge cascades. Index text always comes from `draft.md` or the version file after its checksum was verified, never from the `current.md` mirror.

**Reconcile.** At boot, after the mirror reconcile, `reconcileSearchIndex()` removes orphan FTS and mapping rows and rows whose source is gone, then reindexes every published version and draft whose row is missing or whose `source_checksum` differs from the database checksum (under the note lock), and finally runs FTS `optimize`. A file that fails its checksum is left out and counted as unreadable. Logs carry counts only. Changing `searchText()` does not trigger a rebuild by itself; delete the rows (`DELETE FROM note_search_rows`) to force one on the next boot.

**Query.** `buildFtsQuery()` never passes user input through as FTS syntax: it applies NFKC and lowercase, keeps up to 4 quoted phrases, splits the rest into up to 8 words of 2–64 letters, numbers, or combining marks, quotes each one, and joins them with spaces (implicit AND). The last word gets a prefix `*` unless the query ends in a space or punctuation. Combining marks count as word characters so Indic scripts are not split at vowel signs.

**API.** `GET /api/search` (`server/searchRoutes.ts`) joins `note_fts MATCH` to `notes` and applies the live access rule before `LIMIT`: the draft row only for its owner, and the published row only when `current_version > 0`, the caller is not the owner with a draft (who gets the draft, as `GET /api/notes/:id` does), and `readableNotePredicate` from `server/access.ts` holds. Binned notes never match. Results are ordered by `bm25(note_fts, 8.0, 1.0)` then `updated_at`, `folder_id` is masked as in `GET /api/notes`, highlights return as `{text, hit}` segments (never HTML), and scores are never returned. A per-user in-memory limiter allows 20 searches per 10 seconds. BM25 statistics are computed across every user's rows; only the order they produce is exposed.

**UI.** `src/search/` provides `useNoteSearch` (200 ms debounce, starts at 2 characters, aborts the previous request, keeps results on screen while a data refresh re-runs) and `SearchResults` (a listbox driven from the search input with `aria-activedescendant`). While a request is in flight or failed, the note list falls back to the instant title filter.

## API surface

All `/api` routes except health, about, login, and register need a session. Mutations need an allowed `Origin`, `X-CSRF-Token`, and a JSON body (except the upload). With `TOTP_POLICY=required`, a user without a factor can reach only logout and the TOTP status, setup, and enable routes.

- **Public:** `GET /api/health`, `GET /api/about`, `POST /api/auth/register`, `POST /api/auth/login`
- **Session:** `GET /api/auth/me`, `POST /api/auth/logout`
- **TOTP:** `GET /api/auth/totp/status`, `POST /api/auth/totp/setup`, `POST /api/auth/totp/enable`, `DELETE /api/auth/totp`
- **Recovery codes:** `POST /api/auth/totp/recovery-codes` (view; password and fresh TOTP code), `POST /api/auth/totp/recovery-codes/regenerate`
- **MCP keys:** `GET /api/mcp/keys`, `POST /api/mcp/keys` (password plus a TOTP or recovery code when enrolled; the plaintext key is returned once), `DELETE /api/mcp/keys/:id`
- **Users:** `GET /api/users`
- **Folders:** `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id`, `GET/PUT /api/folders/:id/sharing`
- **Notes:** `GET/POST /api/notes`, `GET/PATCH/DELETE /api/notes/:id`, `PUT/DELETE /api/notes/:id/draft`, `POST /api/notes/:id/publish`, `GET /api/notes/:id/versions`, `GET /api/notes/:id/versions/:version`, `POST /api/notes/:id/versions/:version/restore`, `GET/PUT /api/notes/:id/sharing`
- **Files:** `POST /api/files?folderId=` (multipart upload), `GET /api/files?folderId=`, `GET/PATCH/DELETE /api/files/:id`, `GET/HEAD /api/files/:id/content`, `GET/PUT /api/files/:id/sharing`
- **Bin:** `GET /api/bin?type=note|document`, `POST /api/bin/:type/:id/restore`, `DELETE /api/bin/:type/:id`, `DELETE /api/bin`
- **Search:** `GET /api/search?q=&scope=notes&folder=all|shared|<uuid>&limit=20`
- **MCP:** `/mcp` (outside `/api`): Streamable HTTP with a `Bearer` API key, `Host` and `Origin` checks, a failed-auth rate limit, and bounded bodies. Tools: `list_notes` and `read_note`, over the latest published versions the key owner can read. Drafts, documents, and binned items are excluded.

Any other `/api` path returns a JSON 404. In production every other path serves the SPA's `index.html`. Request and response shapes for Files, Bin, and Search are in [docs/plan/API_CONTRACTS.md](plan/API_CONTRACTS.md).

## UI

### Apps

After sign-in, Home (`src/AppShell.tsx`) offers Notes, Files, and Bin. Notes uses a collapsible folder rail, note list, and editor; Files a folder rail, file list, upload queue, and preview/details pane; the Bin a single list. At 760 px and below each app becomes a sequence of full-width panels (Notes: folders → list → editor; Files: folders → files → preview).

Tiptap provides an Outline-like block editor with Markdown serialization, keyboard shortcuts, a bubble toolbar, and `/` commands. `/image` and paste/drop upload PNG, JPEG, GIF, or WebP through `POST /api/files` into the note's folder and embed `/api/files/<id>/content?disposition=inline`; the image is kept only if the server's sniffed kind agrees, and image sources other than this app's content URLs are dropped. Images therefore follow the folder's sharing, not a note-level override. `/table` uses the Tiptap table extensions and round-trips GitHub-flavoured pipe tables. Download as PDF uses print CSS and `window.print()`.

### URL routing and history

`src/router.ts` maps paths to routes with pure `parseRoute`/`formatRoute`: `/`, `/notes`, `/notes/folder/:id`, `/notes/shared`, `/notes/:noteId`, the same shapes under `/files`, and `/bin`. Unknown paths resolve to Home; ids must be UUIDs and are lowercased. `navigate()` pushes (or replaces) a real history entry on desktop and mobile, and `popstate` re-parses `location.pathname`.

History state layers hints over the URL:

- `mynotes.app-shell`: the app section, tied to the user id.
- `mynotes.mobile-navigation` and `mynotes.files-navigation`: the phone panel (and, for Files, the folder a file was opened from), so Back steps between panels.
- `mynotes.notes-search`: the Notes search query and scope an entry showed, tied to the user id. The query never enters the URL. On phones the first search from a list entry pushes one same-URL entry, and later edits replace it, so Back from a note returns to the results and Back from the results closes the search. Every Notes entry written while a search is active carries it, and entering an entry without it clears the search.
- `mynotes.depth`: how many entries the app has pushed below the current one. In-app Back calls `history.back()` only when depth > 0, otherwise it changes the panel in place, so it never leaves the site from a first entry.

Leaving a note by any route change runs `finalizeOpenNote` (remove a blank never-published note, or save and publish a changed draft) with the editor locked; on failure the URL stays on the note. Deep links resume the named note or file; unreadable ids fall back to the list with a toast. A signed-out deep link is kept in memory through login. A failed first workspace load retries on the next route change.

Dialogs and sheets push no history. While one is open, the app registers a guard (`src/historyDialogs.ts`): the first `popstate` handler to see a Back or Forward closes the dialog and undoes the move with `history.go(±1)`, chosen by comparing `mynotes.depth` of the two entries, and the popstate that causes is ignored once.
