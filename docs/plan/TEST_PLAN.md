# Test plan: Home, Files, Bin, Search, Tasks, MCP scopes, Today, Collections, Calendar, and Team

Companion to [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md). Every automated case below must exist and pass before its wave's exit gate.

## Harness notes

- `tests/api.test.ts` sets `process.env` and then dynamically imports `server/index`. `server/config.ts` reads the environment **at import time**, and modules are cached, so a second test file cannot start a differently configured server in the same run.
- Before adding server tests, extract the setup from `api.test.ts` (env, `request()`, `register()`, the server lifecycle) into `tests/support/harness.ts`, imported by every server test file. The harness sets small limits so the tests stay fast: `MAX_UPLOAD_BYTES=4194304` (4 MiB), `USER_STORAGE_QUOTA_BYTES=12582912` (12 MiB), `MIN_FREE_DISK_BYTES=0`. The tests run a real `Bun.serve`, so Bun's `maxRequestBodySize` applies; the upload limit must keep that cap above the 2.1 MB JSON limit, or the body-limit regression tests pass for the wrong reason.
- If Bun runs the files in isolated contexts instead, the harness still works. Verify this once and note the result in the harness file comment.
- Update the migration assertion in `api.test.ts`: `[1..6]` in W3 and `[1..7]` in W4.
- The allowlist in the harness uses `@example.test` addresses only. Add more when new tests register users.
- Pure modules (`mimeSniff`, `sanitizeDisplayName`, Content-Disposition, Range parsing, the upload queue reducer, and the history helpers) get their own fast unit test files with no server.

## Wave 2 (Home), already present

- `tests/appShellNavigation.test.ts`: round trip; preserves foreign state; rejects a cross-user entry or an invalid section.
- Add tests only when review findings require them. For example, if the fix for gate G2.1 (draft finalization when leaving Notes for Home) extracts a pure helper, test that helper.
- Manual review gates (DEVELOPMENT_PLAN §4), recorded in `TODO.md` before release:
  - [ ] G2.1: edit a published note, then leave via the Home brand button (desktop) and via Back (mobile). Record whether the draft is saved and whether it is published. Create a blank note, leave via Home, and record whether it is left behind.
  - [ ] G2.2: from Home and from the Files/Bin placeholders, record whether Settings and Sign out are reachable. With `TOTP_POLICY=required` and no enrolled factor, confirm the user lands in the workspace with Settings open, not on Home.
  - [ ] Mobile Back/Forward across Home ⇄ Notes (folders/list/editor) ⇄ Files/Bin placeholders, including Forward after Back.

## Wave 3: documents backend

### Unit tests

`tests/mimeSniff.test.ts`:

- [ ] Each allowlisted signature maps to the expected `{ mimeType, previewKind }`: PNG, JPEG, GIF87a/89a, WebP, PDF, ID3 MP3, frame-sync MP3 with `.mp3` (and `none` without the extension), OGG, WAV, MP4 brands, the M4A→audio case, and WebM.
- [ ] Rejections classify as `none`: SVG (`<svg`), HTML (`<!doctype html>`), XML, JS, ZIP/DOCX (`PK\x03\x04`), ELF/PE, HEIC, and a truncated signature (for example 3 bytes of PNG).
- [ ] Text requires both an allowed extension and valid UTF-8 without NUL bytes. `.txt` with a NUL → `none`. `.exe` containing ASCII → `none`. `.md` with a multi-byte character cut at the sample boundary → `text`. An empty `.txt` → `none`.
- [ ] A PNG signature in a file named `.html` → image/png (bytes decide). HTML bytes named `.png` → `none`.

`tests/filenames.test.ts` (`sanitizeDisplayName`):

- [ ] NFC normalization. Stripping of controls, bidi characters (U+202E and friends), and zero-width characters. `/`, `\`, `:` → `-`. Trimming of dots and whitespace. `.` and `..` rejected. Truncation at 255 UTF-8 bytes keeps the extension. Emoji and CJK names are preserved.

`tests/contentHeaders.test.ts`:

- [ ] Content-Disposition for ASCII, Unicode, quotes, backslashes, CR/LF, and empty-after-strip → `download`. The output never contains a raw CR or LF.
- [ ] Range parser: `bytes=0-0`, `0-`, `-1`, `-0` (unsatisfiable), `5-2` (malformed → ignore), multi-range (ignore), unit `items` (ignore), end past size (clamp), a 0-byte file (416).

### API integration tests

`tests/documents.test.ts`:

**Upload**

- [ ] 201 on a happy path. The row is in the DB, the object exists at `documents/objects/<id>` with mode `0600`, the directory mode is `0700`, the sha256 and size are correct, and nothing is left in `.staging`.
- [ ] The response and the list never include `sha256`, `upload_key`, or a path.
- [ ] The display name is sanitized. The on-disk name is exactly the UUID.
- [ ] No `folderId` → the document lands in Default. Another user's folder, or a folder shared with the caller → 404.
- [ ] Oversized: 413 on the `Content-Length` pre-check, and 413 on a chunked or streamed overflow without `Content-Length`. Nothing is left in staging or objects.
- [ ] Two file parts → 400. An extra text field → 400. A field named other than `file` → 400. Not multipart → 415.
- [ ] Multipart sent to a **different** mutation route (for example `POST /api/folders`) → 415.
- [ ] Missing CSRF → 403. Wrong Origin → 403. No session → 401. `TOTP_POLICY=required` without enrollment → 403 `TOTP_SETUP_REQUIRED`. Run this as a separate harness process or assert the gate function directly if env isolation prevents it.
- [ ] Quota: filling up to the quota then uploading more → 507 `QUOTA_EXCEEDED`. Binned documents still count.
- [ ] Concurrency: a 4th simultaneous upload from the same user → 429. Slots are released after aborts.
- [ ] Idempotency: the same `Idempotency-Key` twice → the second returns 200 `idempotentReplay` with the same id, and there is one row and one object. The same key from a different user → a separate document.
- [ ] Client abort mid-upload (`AbortController`) → no row, and the staging file is removed.

**Metadata and ACL**

- [ ] Share matrix (owner, recipient through a folder share, recipient through a document `selected` share, `all_users`, unrelated user), run against both **notes and documents** with identical expectations:
  - an inheriting document follows its folder
  - a document override beats the folder in both directions (a private override in a shared folder, and a shared override in a private folder)
  - a subfolder of a shared folder is **not** shared
- [ ] Recipients see `folder_id` masked when the folder itself is not visible to them. `sharing_override` is reported as 0 to recipients.
- [ ] Recipients cannot rename, move, share, or delete (404).
- [ ] Rename validation: empty → 400, more than 255 bytes → 400, bidi characters stripped. The MIME type and preview kind are unchanged after renaming a `.png` to `.html`.
- [ ] Move to an owned folder → the effective visibility in the response changes. Move to someone else's shared folder → 404.
- [ ] Folder deletion sets `folder_id` to NULL and the document stays live and private (D15).

**Content**

- [ ] The owner and a recipient get 200. An unrelated user gets 404. A binned document gets 404 for everyone, including the owner (the owner uses the Bin).
- [ ] Headers exactly as the contract: Content-Type rules, Content-Disposition, `nosniff`, `X-Frame-Options`, **the exact CSP string** (catches `secureHeaders` overwriting), CORP, Cache-Control, ETag, and Accept-Ranges.
- [ ] Other `/api` responses and the SPA still carry the unchanged global CSP (the content-route exclusion is path-exact).
- [ ] `disposition=inline` on a `none` document → forced `attachment` and `application/octet-stream`.
- [ ] 206 for `bytes=0-9` (body and `Content-Range` correct). A suffix range. An open-ended range. 416 with `bytes */size`. Multi-range → 200 full. `If-Range` mismatch → 200 full. `If-Range` match → 206. HEAD → headers only.
- [ ] Integrity: replacing the object with a symlink → 500 and no content leaked. Truncating the object → 500 (size mismatch). Deleting the object → 500.

**Body limits** (regression tests for the refactor)

- [ ] A chunked JSON body over 2.1 MB (and below Bun's cap) to `PUT /api/notes/:id/draft` → 413 with the bounded reader's error body, with no `Content-Length` sent.
- [ ] Same for `/mcp` → 413.

**Sweeper**

- [ ] A stale `.part` file older than the threshold is removed. A fresh one is kept (use an injected clock or `utimes`).
- [ ] An orphan object with a UUID name and no row is removed. A non-UUID file in `objects/` is left untouched and logged. A live object is untouched.

**Audit**

- [ ] `document.upload`, `document.rename`, `document.move`, `document.sharing_changed`, and `document.delete` are written. No audit `metadata_json` contains the filename (search for the test filename).

**Migration**

- [ ] A fresh DB contains migrations `[1..6]`. A v0.2.2-shaped DB (migrations 1–5 applied, with sample data) upgrades cleanly.

## Wave 4: Bin

`tests/bin.test.ts`:

- [ ] Migration 007 backfill: a legacy deleted published note → `purge_after ≈ migration time + 30d`. A legacy deleted unpublished note → `purge_after = migration time` and it is purged by the first sweep. `deleted_by` equals the owner.
- [ ] Deleting a published note → it appears in `GET /api/bin`. It is gone from `/api/notes`, `/api/notes/:id` (404), versions, sharing, and MCP `list_notes`/`read_note`, for the owner and for recipients.
- [ ] Deleting a never-published note with a non-empty draft → Bin, with the draft preserved and restorable. A blank never-published note → purged immediately (`purged: true`), not in the Bin, directory gone.
- [ ] Discarding the draft of a never-published note with content → Bin (`binned: true`), and after restore the draft content is intact. Blank → purged.
- [ ] A never-published note whose draft is whitespace only (for example `"\n"`) counts as blank → purged, matching the client's `trim()` check.
- [ ] Deleting a document → Bin. A second delete → 200 `alreadyDeleted`.
- [ ] Restore: 200 back to the original folder. Original folder deleted → Default, reported in the response with the new effective `visibility`. Already live → 200 `alreadyRestored`. Another user → 404. Shares are active again after restore (a recipient can read).
- [ ] Delete forever: bytes and row removed, cascades cleared (versions, shares), audit `*.purge` with the id in metadata. A retry → 404. A live item → 409 `NOT_IN_BIN`.
- [ ] Crash safety:
  - With `purge_started_at` set manually and bytes still present → the item is unreadable, restore → 409 `PURGING`, and the sweeper completes the purge.
  - A simulated byte-removal failure (for example making the note directory unremovable by test injection) → 202 `pending`, the row stays tombstoned, and the next sweep finishes.
- [ ] Retention: items whose `purge_after` is in the past are purged by the sweeper (inject the clock or update `purge_after`). Items with a future `purge_after` are kept. Batch size is honored.
- [ ] Empty Bin purges only the caller's items. Another user's binned items are untouched. Counts are correct.
- [ ] Concurrency: parallel restore and purge on the same item → exactly one wins, with no half state (the row is either live or gone).
- [ ] The quota frees up after a purge.

## Wave 5: Files UI

Unit tests (no DOM):

- [ ] `tests/filesNavigation.test.ts`: round trip; preserves foreign state (the app-shell key and the notes key); rejects a cross-user entry, an invalid panel, and a non-string documentId; `sameFilesSnapshot`.
- [ ] `tests/uploadQueue.test.ts`: enqueue several files; concurrency cap of 2; progress updates; cancel; failure with an error code; retry keeps the same idempotency key; completed items do not re-run.

## Wave 7: Search

Unit tests (no server):

- [x] `tests/search.test.ts`: `buildFtsQuery` quotes every term with implicit AND and a trailing prefix (none after a space or punctuation); FTS operators, `title:x`, `NEAR()`, `-`/`+`/`^`, `{col}`, `foo*`, `***`, and unterminated quotes become plain words or nothing; up to 4 phrases (extra phrases become words); NFKC, lowercase, emoji, diacritics, and Devanagari; caps (1–200 characters, 2–64 characters per word, 8 words); every built query is valid FTS5 syntax. `searchText` keeps headings, text, link and alt text, code, and table cells, and drops URLs, HTML, markup, reference definitions, and control characters. `toSegments` splits highlight markers into text/hit segments and never produces HTML.
- [x] `tests/searchHistory.test.ts`: the search hint round-trips on history state, keeps other keys, rejects other users and malformed entries, caps the query, and leaves an empty hint only on entries that had one; the client starts searching at 2 characters and sends at most 200.

`tests/migrations.test.ts`:

- [x] Migration 008 creates the tables with their CHECK and UNIQUE constraints, backfills nothing, folds accents, and deleting a note cascades to `note_search_rows` while the trigger removes its FTS rows.

`tests/searchIndex.test.ts`:

- [x] Draft save, empty draft, publish, second draft, discard, publish, and version restore each leave exactly the expected rows, titles, bodies, and checksums. Note creation indexes nothing.
- [x] Bin and restore keep rows; purge removes them (FTS count drops). A discarded never-published note keeps its draft row in the Bin; a blank note is purged with none.
- [x] Reconcile reindexes a missing row and a stale checksum, removes an orphan FTS row, leaves out a draft whose file fails its checksum, and a second run changes nothing.
- [x] Boot backfill (subprocess `tests/support/searchBackfillProbe.ts`): a 007-shaped data directory with notes on disk boots to `[1..8]` and indexes published versions, drafts, both kinds for one note, and binned notes; skips an empty draft and a tampered version file; never indexes the stale `current.md` mirror; a second reconcile indexes nothing.

`tests/searchApi.test.ts`:

- [x] Matching: accents and case, prefix, a trailing space disables the prefix, title matches outrank body matches, `limit` and `truncated`, segments carry no HTML, no scores are returned, operators are plain words.
- [x] Drafts: only the owner finds draft text (as `source: "draft"`) and then not their published text; readers find only the published text; after publish the draft row is gone; never-published notes are invisible to readers.
- [x] Access: across owner, folder share, note share, `all_users` folder and note, private override, and a stranger, results equal the expected set and ⊆ `GET /api/notes`; `folder_id` is masked; `folder=<id>` and `folder=shared` filter; unsharing a folder or note applies at once.
- [x] Bin: binned notes are hidden for owner and reader, restored notes return, purge removes the index rows.
- [x] Version restore reindexes the draft.
- [x] 400 for bad `scope`, `folder`, `limit` (0, 51, `abc`, `1.5`) and `q` over 200 characters; 401 without a session; 429 `RATE_LIMITED` with `Retry-After` after 20 searches in 10 s, per user.

Manual QA (desktop and 390×844):

- [ ] Desktop: `/` and Ctrl/⌘+K focus search; typing shows the title filter instantly, then full-text results with highlighted title and snippet, folder, owner, Draft badge, and time; ↑/↓ move the highlight, Enter opens, Esc clears; the result count is announced.
- [ ] Desktop: in a folder, results are limited to it; **Search all notes** widens the scope; opening a hit from another folder switches to All notes and keeps the query; Back and Forward restore each entry's search.
- [ ] A second user sees only shared, published notes (with the owner's name) and never the first user's drafts.
- [ ] 390×844: rows and the scope chip are at least 44 px; no horizontal scroll; open a result, Back returns to the results with the query kept, Back again returns to the list without the search, then to the folders.
- [ ] More than 20 searches in 10 s show the inline rate-limit message with the title filter still visible.

## Wave 9: Task Boards, stage A (boards, columns, cards)

Unit tests (no server):

- [x] `tests/boardOrder.test.ts`: `planInsert` places at 1024 in an empty list, last + 1024 at the bottom, half the first at the top, and the midpoint after an anchor; a stale anchor returns null; a gap below 1e-6 renumbers to 1024, 2048, … with the new item in place; 80 repeated inserts at one spot stay strictly ordered.
- [x] `tests/tasksBoardOrder.test.ts`: the `application/x-mynotes-card` payload accepts a UUID only; drop slots map to `afterCardId`; local moves mirror the server rules; Alt+Arrow targets within and across columns stop at edges; column ←/→ anchors; Move sheet Top/Bottom anchors; the phone track's scroll offset maps to a clamped column index.
- [x] `tests/tasksRoute.test.ts` and `tests/router.test.ts`: `/tasks`, `/tasks/:boardId`, `/tasks/:boardId/card/:cardId` round-trip and normalise, malformed ids degrade to the board or the list, formatting never escapes the origin; Back steps card → board → list → Home (history when this visit pushed entries, otherwise a replace or Home); the column hint round-trips, is bound to user and board, is clamped, and survives same-board writes only.
- [x] `tests/appShell.test.tsx`, `tests/tasksApp.test.tsx`: Home shows a live Tasks card; the board list renders its loading state and New board; name validation mirrors the server.

`tests/migrations.test.ts`:

- [x] A v0.5.0-shaped database upgrades to `[1..9]`: task tables with their CHECKs and cascades, `documents.purpose` defaulting to `file` with the three-value CHECK, and no `folders.system_role`.

`tests/documents.test.ts`:

- [x] Documents with `purpose <> 'file'` never appear in `GET /api/files` (all or by folder) or `GET /api/bin?type=document`; uploads reject any `purpose` other than `file` with 400.

`tests/tasksBoards.test.ts` and `tests/tasksCards.test.ts`:

- [x] Boards: default columns, validation, list (owned first, shared with owner name, strangers see nothing), rename, delete to the Bin for everyone, 50-board cap, JSON/Origin/CSRF rules.
- [x] Owner-only matrix: every owner-only route returns 403 `OWNER_ONLY` to a member and 404 to a stranger; strangers get 404 on every card route.
- [x] Sharing: notes rules (owner not a recipient, `selected` needs users, unknown users, ≤100) and immediate revocation.
- [x] Columns: append, after anchor, first; reorder; renormalisation; 20-column cap; `COLUMN_NOT_EMPTY` and `LAST_COLUMN`; binned cards do not block deletion; binned boards' columns are unreachable.
- [x] IDOR: board A's columns and cards are rejected through board B, including for a user who can read both.
- [x] Cards: create at bottom, top, or after an anchor; moves to top, middle, bottom, and across columns; stale anchors (binned, other column, self, unknown) return 409 `STALE_POSITION` with the current order; renormalisation returns the new positions; revision CAS (`CARD_CHANGED` carries the current card, moves keep the revision); any reader bins a card; 1000-card cap; parallel moves stay strictly ordered; audit metadata holds ids only.

Manual QA (desktop and 390×844, two users):

- [ ] Home → Tasks → New board → board shows To do, Doing, Done; rename and share from the list and the board header.
- [ ] Desktop: drag cards within and between columns (insertion line, drop, order persists on reload); a drop onto a card another user just binned rolls back with a toast; ⋯ → Move to… with Top/Bottom; Alt+Arrow moves with focus kept; owner adds, renames, moves (←/→), and deletes columns; quick-add at the bottom of a column.
- [ ] Member: sees the owner badge, no column or board controls, can add and move cards.
- [ ] 390×844: one column at a time with swipe snapping, the tab strip follows and taps scroll; the column survives Back/Forward and reload; Move sheet is full-screen; every target is at least 44 px; no horizontal page scroll.
- [ ] Back: card URL → board → list → Home; Back with a dialog or sheet open only closes it.

## Wave 9: Task Boards, stages B–D (comments, attachments, Bin)

Unit tests (no server):

- [x] `tests/cardMarkdown.test.ts`: XSS fixtures for card descriptions through the notes renderer: `<script>`, `<img onerror>`, `<a href="javascript:">`, `<iframe>`, and `<svg onload>` stay plain text; `data:`, external, protocol-relative, `javascript:`, and malformed file images are dropped; `javascript:` and `data:` links render with an empty `href`.
- [x] `tests/tasksApp.test.tsx`: attachments group by comment, removal is for the linker or the owner, inline images are PNG/JPEG/GIF/WebP only, confirm copy names the right Bin, comment body limits.
- [x] `tests/binFormat.test.ts`: the Tasks filter, card/board/attachment labels, and restore toasts.

`tests/tasksComments.test.ts`:

- [x] Readers comment as the session user (a spoofed author field is 400); validation; only the author edits (403 `AUTHOR_ONLY`), the author or board owner deletes, strangers get 404; binned cards and revoked members get 404; pages of 50 with a `before` cursor; the 500-comment cap; audit ids only.

`tests/tasksAttachments.test.ts`:

- [x] Attachment uploads have no folder, are never listed in Files, and only `task_attachment` is accepted (with no `folderId`).
- [x] Linking needs the caller's own live attachment (someone else's, a Files document, or a stranger → 404); linking again is 200; linked files are readable to board readers with `no-store` and never listed.
- [x] Access ends at once when the member is removed, the card is binned, or the comment is deleted; a deleted comment's file moves to its uploader's Bin.
- [x] Comment attachments are the author's own files on their own comment; caps of 10 per comment and 50 per card.
- [x] Unlinking is for the linker or the board owner (403 `LINKER_ONLY`); the last unlink moves the file to the Bin, an earlier one does not; a binned file cannot be linked again. Audit ids only.

`tests/tasksBin.test.ts` and `tests/bin.test.ts`:

- [x] A binned card is listed for the board owner and its deleter only (and not after the deleter loses access); `type=card|board` filters; Bin rows carry `board_id`, `board_name`, `attachment`, and `can_purge`.
- [x] Restore by the deleter or owner returns the card to the bottom of its column, or to the first column when its column was deleted; `alreadyRestored`; cards on a binned board return 409 `BOARD_IN_BIN` until the board is restored.
- [x] Only the board owner deletes forever (403 `OWNER_ONLY` for the deleter, 409 `NOT_IN_BIN` for live items); card and board purges cascade comments, cards, and links and move unused attachments to their uploader's Bin; a restored attachment becomes a Files item.
- [x] Empty Bin clears the owner's boards and the binned cards on their boards, never cards on other people's boards; the sweeper purges expired cards and boards and keeps fresh ones.

Manual QA (desktop and 390×844, two users):

- [ ] Click a card: the URL gains `/card/<id>`, Back closes the card and focuses it on the board, Forward reopens it; Back with the delete-comment or remove-attachment confirm open only closes the confirm.
- [ ] Edit the title (saves on blur) and the description (explicit Save); with a second user saving first, the conflict banner offers Reload and Copy my text.
- [ ] Comments: post, edit, delete; Load earlier after 50; the owner deletes a member's comment.
- [ ] Attach files to the card and to a comment; paste an image into the description (it shows inline and appears under Attachments); the member sees and downloads them; after removing the member from the board, the file URL is 404 for them; none of it appears in Files.
- [ ] Delete a card from its dialog and a board from the list or header: the confirm reads like Files, the toast's Undo restores it. In the Bin, the Tasks filter shows both; restoring a card on a deleted board asks to restore the board first; the deleter of a card on someone else's board sees Restore but not Delete forever.
- [ ] 390×844: the card view is full screen with 44 px targets; the Move sheet and confirms are reachable; no horizontal page scroll.
## Wave 8: MCP scopes

Unit tests (no server):

- [x] `tests/mcpScopes.test.ts`: normalizing adds implied reads, dedupes, and orders; write implies read and never the reverse; stored JSON reads leniently (null, bad JSON, objects, unknown values) and never grants more than is stored.
- [x] `tests/mcpPermissions.test.ts`: the Settings list mirrors the server scopes and implications; the Write drafts help says "never publishes"; checking a write scope checks and locks its read scope; unchecking it unlocks but keeps the read; every scope is offered, and the Write tasks help says "never deletes".
- [x] `tests/noteFinalization.test.ts`: leaving a note auto-publishes only a draft edited in this session; a waiting draft (MCP or another session) is not published; the Publish button is offered for any owner delta; the "Draft by <key>" label.

`tests/migrations.test.ts`:

- [x] Migration 010 applies to an 008-shaped database without 009's tables; an existing key reads `["notes:read"]`; `scopes` must be valid JSON; `draft_mcp_key_id` references a key and becomes NULL when the key row is deleted. Migration id assertions read the registered list and pin 1–8 and 10.

`tests/mcp.test.ts`:

- [x] Keys: an API-created key defaults to `notes:read`; chosen scopes are stored with implied reads, listed, and audited in `mcp.key_created`; empty, duplicate, unknown, too many, and non-array scopes are 400.
- [x] Scopes: `tools/list` per scope (`files:read` sees only the document tools and `list_folders`; `notes:read` no write or document tools; `notes:write-draft` also the read tools); calling an unregistered tool fails; a direct handler call without the scope returns `SCOPE_REQUIRED`; a revoked key gets 401 and `SCOPE_REQUIRED`.
- [x] `search_notes`: published text only (the owner's newer draft is neither searched nor used for the title), plain snippets, reader and stranger access, unsharing applies at once, folder filter, `limit` over 20 fails, FTS operators are plain words, binned notes vanish. `list_folders` equals `GET /api/folders`.
- [x] Draft writes: `create_note` makes a draft-only note (no version) in Default or an owned folder, never a folder shared by someone else; the draft is indexed for the owner's search but not for MCP search; `draftMcpKeyName`/`draft_mcp_key_name` show the key and `draft_mcp_key_id` is never returned; publish and discard clear it. `update_note_draft` appends and replaces, keeps the version count, audits `mcp.note_draft_update`, and returns `DRAFT_CHANGED` with `currentRevision` for a stale revision and after a human autosave. Shared (readable but not owned), binned, and missing notes return the same `NOT_FOUND`.
- [x] Documents: text is read as strict UTF-8; PDFs, binaries, a bad UTF-8 tail past the sniffed prefix (`NOT_TEXT`), and files over 1 MiB (`TOO_LARGE`) are refused; metadata carries no hash, path, or upload key; sharing, the Bin, and `purpose <> 'file'` documents follow the Files list predicate.
- [x] Limits: 120 calls a minute, then `RATE_LIMITED` with `retryAfterSeconds`, per key; 30 writes a minute (refused CAS attempts count); a refused call charges no bucket; the daily `create_note` bucket resets after a day; per-user limits (60 writes and 1000 calls a minute, 400 `create_note` a day) span all keys of a user and leave other users unaffected.
- [x] Tasks (`tests/mcpTasks.test.ts`): task tools appear only for task scopes (write implies read, no delete, column, or sharing tools) and handlers reject other keys; a stranger and a non-member of a private board get `NOT_FOUND` identical to a missing id for every tool; IDOR through another board's column is `NOT_FOUND`; a member creates, moves, and comments, and the rows land as that user; `task.card_create`, `task.card_move`, and `task.comment_create` carry `{via: "mcp", keyId}` and HTTP writes do not; removing the member applies at once; plain-text descriptions, attachment names only, and the column filter; `STALE_POSITION` with the current order for create and move; route validation (`INVALID`); `TaskError` mapping (`CARD_CHANGED`, `OWNER_ONLY`, `LIMIT_REACHED`); the daily `task_write` bucket blocks writes but not reads.

Manual QA:

- [ ] Settings → MCP server at desktop and 390×844: Permissions rows are at least 44 px, checking Write drafts checks and locks Read notes, the key list shows scope chips, and the copied config still works.
- [ ] With a `notes:write-draft` key, call `create_note`, then open Nook: the list and editor show "Draft by <key>"; switching notes without typing leaves it unpublished; Publish version removes the badge.
- [ ] A notes-only client (for example the MCP Inspector) lists only the read tools.

## Wave 10: Today

- [x] `tests/migrations.test.ts`: 011 on a v0.6.0-shaped database adds `due_on` (GLOB CHECK), `assignee_id` (SET NULL when the user goes), and `is_done` (backfilled for Done, done, and DONE, not "Done soon"), plus the three indexes; ids 1–11 present whether or not 012/013 are registered
- [x] `tests/tasksDates.test.ts`: new boards mark Done as done; readers set and clear `dueOn` and `assigneeId` under revision CAS; real-date validation (Feb 29, month 13, shapes, range); `ASSIGNEE_NOT_MEMBER` for strangers, unknown and disabled users, and anyone once the board is `all_users`; the readers list; `isDone` owner only; the due chip helper
- [x] `tests/mcpTasks.test.ts`: `create_card` takes and validates `dueOn`; `get_card` returns `due_on`
- [x] `tests/today.test.ts`: section shape and order (`upcoming` between `binSoon` and `storage` once Calendar is installed, listing readable occurrences without descriptions); tz validation (including a browser alias), `sections=`, 401, and 30/min per user; UTC+14 and UTC−12 midnights for the date and overdue flags; a failing provider errors only its section, an unavailable module is absent, and a long page is cut to ten; parity with the Notes, Files, Tasks, and Bin lists across sharing, unsharing, Bin, member removal, done columns, and drafts (draft titles never reach recipients); agent drafts; storage and `binSoon`; 10 + `more`
- [x] `tests/mcpToday.test.ts`: `get_today` only with `today:read` (handler re-check); sections filtered per module scope, write implies read (T74); titles only; tz validation; not audited
- [x] `tests/appShell.test.tsx`: Today keeps the account row and greeting; launcher links Notes, Files, Tasks, Collections, and Calendar without the Bin; busy skeletons labelled by headings; row copy and routes; storage text; hidden sections per user survive bad storage; one column with 44 px targets at phone widths
- [x] `tests/tasksApp.test.tsx`: due chip and assignee on cards, none in a done column

Manual QA (desktop and 390×844):

- [ ] Today loads with skeletons, then every section; Refresh announces through the live region; a failed section shows Retry
- [ ] Each item link opens its app at the item (note in the editor, card over its board, file preview, Bin); Back returns to Today, and Back on Today at depth 0 leaves the site
- [ ] Customize sections hides and shows sections, survives a reload, and Back while it is open only closes it
- [ ] The card view sets and clears Due and Assignee; the chip turns red when overdue; marking a column done removes its cards from Today
- [ ] axe (or the browser accessibility tree) shows labelled sections, headings, links, and the storage meter

## Wave 11: Collections

Migration ids are asserted against the registered list and pin 1–13.

`tests/collectionsSchema.test.ts` (no server):

- [x] Schema: ids are generated (`f_` + 8, `o_` + 6) and client-invented ids are refused; `__proto__`/`constructor` keys at any depth are rejected; 51 fields, duplicate names (case-insensitive), a non-text primary field, unknown keys or types, 61-character names, control characters, 101 options, duplicate option labels, and 7 decimals are refused; only text ↔ url and select → multi_select type changes pass; the five templates and the default fields build.
- [x] Values: text normalisation and the 4000-character cap; number, date (real dates only), checkbox, select, multi_select, url (`http(s)` only), note (readable at write time), and file rules; strict writes (unknown fields, required fields, 16 KiB rows); lenient reads (removed fields and options, wrong types, select → multi_select).

`tests/collectionsQuery.test.ts` (no server; runs the compiled SQL on an in-memory table):

- [x] Every operator family filters correctly (a wrong JSON type never matches a comparison; binned attachments do not count); `q` matches text and url fields; sorts put empty values last and order select fields by option order; unknown fields, mismatched operators, bad values, unsortable types, and a field sorted twice are refused; lenient mode drops stale view clauses; hostile values and field ids never appear in the SQL text; cursors round-trip and reject tampering.

`tests/collectionsApi.test.ts`:

- [x] Create from fields, a template, or the default; templates list; strict schema validation over HTTP (51 fields, duplicate names, client ids, unknown types, `__proto__` bodies, bad icons).
- [x] A stranger gets 404 on every collection and row route and never sees row text.
- [x] Rows: bottom/top/after placement and stale anchors; `INVALID_VALUES` with per-field errors; revision CAS (`ROW_CHANGED` carries the row); one-step undo (`NOTHING_TO_UNDO` after); bin; audit metadata never contains values.
- [x] Schema: `INCOMPATIBLE_TYPE_CHANGE`; version CAS (`SCHEMA_CHANGED`); lenient reads after text → url and select → multi_select; removed values are dropped on the row's next write, and undo does not bring them back.
- [x] Query: filters, sort, and `q`; cursor paging; a cursor from another spec is `INVALID_CURSOR`, and after a schema change `SCHEMA_CHANGED`; unknown fields, operators, injected ids, and over-limit specs are 400.
- [x] Note links: only readable notes can be linked; a note binned later reads as `{ id, restricted: true }`.
- [x] Caps: 100 collections, 10,000 live rows (`LIMIT_REACHED`); CSRF, Origin, and JSON rules.

`tests/collectionsSharing.test.ts`:

- [x] Role matrix: viewers read and query; every row write is 403 `READ_ONLY` for a viewer-role audience; with the editor role, members create, edit, and undo rows; every owner-only route (rename, delete, schema, sharing) is 403 `OWNER_ONLY` to members and 404 to strangers; the list shows each member's role; audit records visibility, role, and a recipient count.
- [x] Sharing rules (owner not a recipient, `selected` needs users, unknown users, ≤ 100, bad visibility or role); `all_users` gives everyone the viewer role; switching to private revokes at once.

`tests/collectionsViews.test.ts`:

- [x] Views save sort, filters, and hidden fields; `query { viewId }` applies them and request clauses override; rename and reconfigure; a field removed later drops out of the view; delete.
- [x] Configs are checked against the schema (unknown fields, mismatched operators, injected ids, the primary field hidden, stored `q`, prototype keys, 61-character names); 20-view cap; owner-only for editors (403) and strangers (404); editors still query through views.
- [x] IDOR: a view id never works through another collection, and another owner's view cannot be renamed or deleted.

`tests/collectionsAttachments.test.ts` (and `tests/documents.test.ts` for the upload purpose):

- [x] A `collection_attachment` upload has `folder_id = NULL`; linked, it is readable (metadata and content, `no-store`) by collection readers only, never listed in `GET /api/files`, and 404 after unshare, row bin, collection bin, and unlink; the last unlink bins it for the uploader; a Bin restore keeps it out of every folder.
- [x] A Files item the linker owns can be linked, stays in the owner's Files, and is never binned on unlink.
- [x] Rules: viewers 403 `READ_ONLY`; strangers 404; only the caller's own live `file`/`collection_attachment` documents and only file fields; `ALREADY_ATTACHED`; `NOT_LINKER` for editors removing someone else's link, the owner may; 20 per row.
- [x] IDOR across rows and collections; `restricted` note links never disclose titles or grant access.
- [x] Files routes: rename, move, and sharing are 404 for a row attachment; stale sharing rows or a shared folder never make it readable; `DELETE /api/files/:id` is 409 `ATTACHMENT_LINKED` while a row links it and works once unlinked.
- [x] The sweeper bins `collection_attachment` uploads with no row link after 24 hours (`deleted_by` NULL, audit `attachment_never_linked`) and leaves linked, fresh, and Files documents alone.

`tests/collectionsBin.test.ts`:

- [x] A binned collection is unreadable to members, listed (and filterable) for its owner only, restored with a CAS (sharing kept), 409 `NOT_IN_BIN` when live, and 409 `LIMIT_REACHED` past 100 live collections; unknown Bin types are 400.
- [x] A binned row is listed for the owner and its deleter (`can_purge` false for the deleter); strangers and non-deleters cannot restore; 409 `PARENT_IN_BIN` while the collection is binned; a deleter who lost edit access gets 404; only the owner purges.
- [x] Purging a row bins uploads no other row links; the sweeper purges collections (rows and all, binning the last attachment) and rows past retention; Empty Bin purges the owner's collections and rows.

`tests/collectionsSearch.test.ts`:

- [x] Indexed text: the primary field is the title; other values and option labels are the body, controls stripped; note links and files are never indexed.
- [x] Parity: a reader sees nothing before sharing, their own hits within `limit=2` despite 30 matches in a hidden collection (ACL before LIMIT), option-label hits, and nothing after unsharing; a binned row drops out and returns on restore; `collection=<id>` filters, and a bad id is 400; FTS rows equal mapping rows.
- [x] Writes, undo, and an option rename (schema change) keep the index in step (`source_revision`, `schema_version`); boot reconcile rebuilds missing and stale entries, removes orphan FTS rows, and is idempotent.

`tests/collectionsCsv.test.ts` (no server):

- [x] RFC 4180: quotes, doubled quotes, commas and line breaks inside quotes, literal quotes in unquoted fields, CRLF/LF/CR, BOM, empty records skipped; unterminated quotes and text after a closing quote fail with the line; row and 50-column caps; 50,000 cells parse in well under 1.5 s.
- [x] Writing: BOM, CRLF, quoting only when needed, round-trips through the parser; `= + - @ \t \r` starts are neutralized with `'` (and restored on import), nothing else is.

`tests/collectionsImport.test.ts`:

- [x] Dry run: header mapping by name (BOM, case-insensitive, unknown columns skipped), preview values, per-cell errors (required, number, date, checkbox, option, multi-option) with row numbers, nothing written; the real import with errors is 400 `IMPORT_INVALID` and writes nothing; a clean import inserts every row in order and audits a count.
- [x] Explicit mappings (wrong length, duplicate, unknown, file field, all skipped) are `INVALID_MAPPING`; bad CSV is `INVALID_CSV`; prototype keys are refused.
- [x] Viewers 403, strangers 404, 2 MB → 413, 5001 rows and 51 columns → 400, the 10,000-row cap → 409 with nothing written, 5000 rows import, and the sixth import in a minute → 429.
- [x] Export: BOM, `text/csv`, attachment, `no-store`; formulas neutralized in names, text, and option labels but not in numbers; note titles only for readers who can read the note; 404 after unsharing; the export imports back unchanged; an export through a view equals the view's query (rows, order, shown fields) and a view of another collection is 404.

`tests/collectionsRoute.test.ts` and `tests/collectionsApp.test.tsx` (no server):

- [x] `/collections`, `/collections/:c`, `/collections/:c/view/:v`, and `/collections/:c/row/:r` round-trip and normalise; malformed pieces degrade to the collection or the list; formatting never escapes the origin; Back steps row → view → collection → list → Home (history when this visit pushed entries, a replace or Home at depth 0); the row entry's view hint is bound to user and row; the dialog guard closes only the top-most layer and leaves popstate alone when nothing is open.
- [x] Today's launcher has a Collections entry (`/collections`); the list renders its loading state and New collection; values display and parse per type; viewers get read-only cells; multi-line text is never edited in a single-line cell; field drafts mirror the schema rules and build the `PUT /schema` body.
- [x] Phone cards show the primary field plus up to three fields with values and a 44 px actions button; the row panel labels one editor per field (a textarea for text) and shows "View only" with no inputs to viewers; filters are sent only when complete.

Stage E (MCP):

- [x] `tests/mcpCollections.test.ts`: collection tools only for `collections:read`/`collections:write` (write implies read; direct handler calls without the scope are `SCOPE_REQUIRED`; no delete, schema, share, import, view, or attachment tools); a key with all ten scopes can be created. Role matrix: viewers and editors read, strangers and private or binned collections are `NOT_FOUND`, viewers get `READ_ONLY`, editors create. Rows keyed by field name, select labels, note links as titles or `{ restricted: true }` (never the hidden title or id), attachments as names only; filters and sorts by name or id and option label; cursor paging; unknown fields, mismatched operators, unknown options, over-long values, unsortable fields, `limit` 51, and bad cursors are `INVALID`. `create_row` stores ids from names and labels, marks `updated_via_key_id`, and audits `{ via, keyId }`; field errors are keyed by name, file fields and unreadable notes are refused. `update_row` merges, clears with `null`, keeps required fields, returns `ROW_CHANGED` with `currentRevision`, and shows "Changed by the MCP key <name>" with Undo in the row panel; undo and a person's edit clear the mark. 500 row writes per key per day and 1000 per user (T72, T73, T75).
- [x] `tests/mcpCollections.test.ts` (Today): `collectionsRecent` lists recently edited rows in readable collections, titles and ids only, for sessions; `get_today` includes it only with `collections:read` (T74). `tests/mcpToday.test.ts`: binned collections and rows reach `get_today` only with `collections:read`.

Manual QA (desktop and 390×844, two users; the scratch click-through for commits 4–5 covered the unchecked rows marked *):

- [ ] Today → Collections → New collection (template) → table; edit cells (blur saves; an invalid link is flagged and not saved); a second session's change makes the next edit show Reload*, and Reload shows their value*.
- [ ] 390×844: cards are ≥ 56 px with no horizontal scroll*; tap → full-screen row panel with ≥ 44 px editors*; the sort/filter sheet filters and sorts*; ⋯ → Undo / Copy link / Move to Bin.
- [ ] Back: row → collection → list → Home*; with a picker open over the row panel, Back closes only the picker, and the next Back leaves the row*; Forward restores the row*.
- [ ] An MCP client with `collections:write` adds and changes a row; the row panel shows "Changed by the MCP key <name>" with Undo (≥ 44 px at 390 px), and Undo restores the previous values.

`tests/migrations.test.ts`:

- [x] Migration 012 adds `collections`, `collection_members`, `collection_rows`, `collection_views`, `collection_row_attachments`, `collection_row_search`, and `collection_row_fts`; name, JSON, share-role, and Bin CHECKs hold; `values_json` is capped at 16,384 bytes; purging a collection cascades to rows, search rows, and (through the trigger) FTS rows.

## Wave 12: Calendar

Migration ids pin 1–13; `tests/calendarMigration.test.ts` applies 013 on a fresh database and on one at migration 9 and checks its CHECKs and cascades.

- [x] `tests/calendarRecurrence.test.ts`: zoned wall times across DST gaps and overlaps (New York, Berlin); daily, weekly, monthly on the 31st, yearly on Feb 29; until, count, exdates; the instance cap and 100-day ranges; rule and timing validation (T66, T71).
- [x] `tests/calendarApi.test.ts`: the Personal calendar, caps, owner-only actions, sharing, the viewer/editor role matrix, IDOR through every path (T61), revision CAS with one-step undo, range expansion, and links: note, card, and collection-row targets need a readable target to link and resolve per viewer (T59).
- [x] `tests/calendarTasks.test.ts`: `include=tasks` lists readable, open, live due cards through `readableBoardPredicate`.
- [x] `tests/calendarBin.test.ts` and `tests/calendarBinUi.test.tsx`: calendars and events as Bin providers; owner and deleter rules, `PARENT_IN_BIN`, `LIMIT_REACHED`, tombstones and the sweeper, Empty Bin; the Calendar filter chip and labels.
- [x] `tests/calendarReminders.test.ts`: reminder validation and privacy, caps, exactly-once dispatch, late and skipped fires, access loss at fire time (T67), rescheduling, 60 notifications per user per hour, same-origin hrefs (T68), the 30-day sweep, `listUpcoming`.
- [x] `tests/push.test.ts`: `PUSH_ENABLED=auto` on http, VAPID keys (0600, reused) and ES256 JWTs, the push-host allowlist and post-DNS private-address block (T62), subscription caps and IDOR, payload-less pushes (T63), 404/410 cleanup, the Send test limit.
- [x] `tests/serviceWorker.test.ts`: no fetch handler, generic notices, same-origin clicks only, and the manifest (T69).
- [x] `tests/notificationsUi.test.tsx` and `tests/calendarRoute.test.tsx`: routes, history hints, the stacked dialog guards, the bell inside the signed-in shell, and the Today launcher entry.
- [x] `tests/today.test.ts` and `tests/mcpToday.test.ts`: `upcoming` for sessions, and in `get_today` only with `calendar:read` (write implies read); calendar items in `binSoon` need `calendar:read` too (T74).
- [x] `tests/calendarFeeds.test.ts` (stage D, feeds): ICS escaping of `\ ; ,` and every line break, a title containing `\r\nATTENDEE:` and a description containing `END:VEVENT` never start a property, no bare CR or LF; 75-octet folding on UTF-8 boundaries; `UID <id>@nook`, `TZID` + `DURATION`, `VALUE=DATE`, `RRULE` (weekly `BYDAY`, `COUNT`, `UNTIL` as a date or UTC), and `EXDATE`; `busy` hides titles, places, descriptions, and the calendar name; 5000-event cap; only `GET`/`HEAD` of the exact feed pattern skips the session. API: readers (owner, editor, viewer) create links, strangers get 404, lists show only the caller's own links, nobody revokes someone else's, 5 per user per calendar; the token is stored only as its hash; `Content-Type`, `Cache-Control: private, no-store`, `nosniff`, and the global CSP; the same 404 body for a missing, malformed, unknown, revoked, or other-calendar token, a binned calendar (and 200 again after restore), an unshared creator, and a disabled creator; 60 fetches per hour per token then 429 with `Retry-After`; `last_used_at` written at most every 10 minutes; console output and the audit log never contain the token, and audit rows carry `feedId` and `calendarId` only (T61, T64, T65).
- [x] `tests/support/feedTotpProbe.ts` (a subprocess under `TOTP_POLICY=required`): an unenrolled user cannot create a link (403), an enrolled user can, and the link works with no session while `/feeds` still needs one (T70).
- [x] `tests/calendarFeedUi.test.tsx`: the Feed dialog's warning copy, Busy and Full choices, and a subscribe button on owned and shared calendars.
- [x] `tests/mcpCalendar.test.ts` (MCP): calendar tools only for `calendar:read`/`calendar:write` (write implies read, handler re-check, no delete, share, feed, or exdate tools), and the keys API accepts the scopes; role matrix: `list_calendars` roles, `list_events` and `get_event` only on readable calendars, `READ_ONLY` for viewers, `NOT_FOUND` for strangers and binned calendars, editors create; timed events by end or duration across DST, validation errors, the 100-day range; `update_event` revision CAS (`EVENT_CHANGED` with `currentRevision`), `updated_via_key_id` and "Changed by <key>" in the app, undo; `create_reminder` only for the key owner (viewers too; strangers `NOT_FOUND`; `REMINDER_EXISTS`; standalone reminders); audit `{ via, keyId }` on writes and none on reads; 200 event writes and 100 reminders per key per day, and per user; links as titles or `restricted` (T72, T73, T75).

Manual QA (desktop and 390×844):

- [ ] Calendar opens on the agenda on a phone and the current month on desktop; Back from an event returns to where it was opened.
- [ ] A reminder shows in the bell on Today, Tasks, Collections, Files, and Calendar; on an https origin with push enabled it also arrives as a system notification, and clicking it opens the event.
- [ ] Sign-out removes this device's push subscription.
- [ ] Calendars → Subscribe links: create a Busy link, copy it once (the dialog never shows it again), subscribe from a phone calendar on the tailnet HTTPS origin, and see times titled "Busy"; revoke it and the phone's next refresh fails. The dialog is usable at 390 px and Back closes it.
- [ ] An MCP client with `calendar:write` creates and moves an event; the event view says "Changed by the MCP key <name>", and Undo last change restores it.

## Wave 13: task cards (13B server)

Plan of record: [WAVE_13_TASK_CARD_UX.md](WAVE_13_TASK_CARD_UX.md) §7. Migration ids pin 1–16 (015 here, 016 from 13F) and tolerate 017 onwards (Team, Wave 14).

- [x] `tests/migrations.test.ts`: 015 on a 014-shaped database: exactly one `card_assignees` row per non-NULL `assignee_id` (assigned, unassigned, binned, and a later-disabled assignee) with `assignee_id` unchanged; `idx_cards_assignee` dropped; CHECK refusals (a time without a date, `24:00`, `9:05`, a time without a zone, clearing the date under a time, an oversized excerpt, WIP 0 and 1001, a self relation, a reversed `relates`, a `parent` kind, a duplicate pair in either order, an unknown flag or colour, a tag name differing only in case); cascades on tag delete, user delete, card purge, and board purge. The SQLite features the plan flagged (a sibling-column CHECK in `ADD COLUMN`, a two-argument `min()`/`max()` unique expression index) are verified here on Bun 1.4.2 / SQLite 3.53.2, so the §2.1 fallbacks are not used.
- [x] `tests/tasksCardUx.test.ts` (assignees): set, replace (order kept for those who stay), and clear through `assigneeIds`; the legacy `assigneeId` maps to one or none, and 400 together with `assigneeIds`; the `assignee_id` mirror and the deprecated response fields follow the first assignee; `ASSIGNEE_NOT_MEMBER` for strangers, unknown ids, and re-adding a removed former member, with nothing written; a former member (unshared or disabled) shows `can_read: 0` and may stay; create with `assigneeIds` in one transaction; the cap of 20; a multi-field patch raises `revision` by exactly 1; `CARD_CHANGED` carries every field; binned cards keep assignees through restore; audit counts. `readers?q=`: only readers, display names only, `instr` without wildcards, `limit` and `truncated`, strangers 404, parameter validation, and 429 after 60 a minute (T92, T93).
- [x] `tests/tasksDueTime.test.ts` (unit): `HH:MM` validation (`24:00`, `9:05`, seconds refused); zones including `Etc/GMT+12` and the alias `Asia/Calcutta`; `dueAt` in UTC+14 and UTC−12; Berlin and New York across both DST changes, a gap time moving forward and an overlap taking the earlier instant; `resolveDue` keeps the wall time when only the date moves and clears the time with the date (T94).
- [x] `tests/tasksCardUx.test.ts` (due time): set, move, and clear over `PATCH` and create; `due_at` on the card and the board; the alias stored as sent; clearing the date clears the time; audit `dueTime: set|cleared`; 400 without a zone, without a date, for a bad zone, `24:00`, `9:5`, a zone alone, or a numeric time, with nothing written.
- [x] `tests/tasksCardUx.test.ts` (WIP): only the owner sets `wipLimit` (members 403, strangers 404), 0, 1001, fractions, and strings are 400, columns carry `wip_limit`, audit `task.column_wip`; a limit below the count is allowed; creating in, or moving across into, a full column returns 409 `COLUMN_FULL` with `columnId`, `wipLimit`, and `cardCount`; moves within a column, moves out, and Bin restore still succeed; parallel creates and a move stay within the limit (T96).
- [x] `tests/today.test.ts` (Today): task items carry `dueTime`, `dueTz`, and `dueAt`; a timed card is overdue once its instant passed and not before, a date-only card due today is not; on one day timed cards sort by time before date-only ones; `tasksMine` reads `card_assignees`, so a second assignee sees the card as `assigned`. `get_today` shares the providers (`tests/mcpToday.test.ts`).
- [x] `tests/calendarTasks.test.ts` (overlay): items carry `dueTime`, `dueTz`, `dueAt`, and the viewer-local `date`; a card due 23:30 in UTC+14 appears on the previous day for a UTC−12 viewer and not on its civil date, a UTC−12 card appears two days later for a UTC+14 viewer, date-only cards sort before timed ones, and `GET /api/events?include=tasks` places a timed card by `tz` (T94).
- [x] `tests/mcpTasks.test.ts` (MCP): `update_card` is listed only for `tasks:write` and re-checked in the handler; `create_card` takes `dueTime`, `dueTz`, and `assigneeIds` (a time without a zone and a stranger assignee are `INVALID`, the latter with `reason: ASSIGNEE_NOT_MEMBER`); `update_card` edits title, due time, and assignees, returns `CARD_CHANGED` with `currentRevision` (and no card) on a stale revision, refuses a `description` key and an empty change, clears the date with the time and `[]` assignees, and is `NOT_FOUND` for strangers exactly like a missing id; `list_cards` and `get_card` carry `due_time`, `due_tz`, `due_at`, and `assignees` names, and columns `wip_limit`; `create_card` and a cross-column `move_card` return `COLUMN_FULL` with the counts while a move within the column works; the audit entry records `via: "mcp"` and counts only; `taskErrorToMcp` maps `COLUMN_FULL` and `ASSIGNEE_NOT_MEMBER` (T99).

## Wave 13: relations and card search (13D server)

- [x] `tests/taskRelations.test.ts` (unit): the §3.3 table round-trips (each type is stored as planned and reads back as itself from X and as its inverse from Y), both perspectives are inverses (the inverse type created from the other side stores the same row), `relates` is stored in canonical order from either side, and a self relation, an unknown end, `blocks`, and `parent` are refused.
- [x] `tests/tasksRelations.test.ts` (relations): create across boards by a reader of both cards, the inverse type from the other side, stored once; neither card's `revision` or `updated_at` changes (D107); newest first; audit `task.relation_create { boardId, cardId, relationId, kind }`. An unknown, unreadable (private board), or binned target returns the same 404 body; a stranger gets 404 on either card; self, `blocks`, `parent`, and extra keys are 400. `RELATION_EXISTS` in both directions and for any kind, with the existing relation seen from `k`. A card on a board the viewer cannot read is exactly `{ id, type, restricted, created_at }`, and the body carries no id, title, board name, or creator of it; revoking board access turns a row restricted at once. Bin: binning a readable card hides the relation for everyone who can read it, binning an unreadable one keeps it restricted for the member, a binned board hides its cards' relations, restore brings them back, routes of a binned card are 404, and a purge cascades. Delete: through an unrelated card or an unknown id is 404, strangers 404, a member removes a restricted relation, either end works, revision unchanged, audit `task.relation_delete`. The 50-per-card cap applies on both ends (`LIMIT_REACHED`). The board payload's `relation_count` and `open_blockers` per viewer: restricted rows count but never block, done columns do not block, a binned blocker is hidden and stops counting, cards without relations carry zeros.
- [x] `tests/tasksRelations.test.ts` (card search): only live cards on readable boards (the owner finds the private card, the member and stranger do not), and each hit is on a board `GET /boards/:b` shows the same user; titles and names only; binned cards drop out; `excludeCardId`; `boardId` orders that board first and never reveals an unreadable board; `%` and `_` match literally; case-insensitive; prefix matches first; `limit` and `truncated`; empty, blank, 101-character `q`, bad `limit`, and non-uuid ids are 400; `/cards/search` is never read as a card id; 20 per 10 s then 429 with `Retry-After`, per user.

- [x] `tests/mcpTasks.test.ts` (MCP, 13D): `search_cards` is listed for `tasks:read` and `link_cards` only for `tasks:write`, both re-checked in the handler (`SCOPE_REQUIRED`), and no tool name matches unlink; `link_cards` returns the relation seen from `cardId`, the REST view from the other side is the inverse, revisions stay at 1, `RELATION_EXISTS` in the other direction carries the existing relation, a self link is `INVALID`, and the audit entry is `task.relation_create` with `via: "mcp"` and ids only; missing, unreadable (either end), stranger, and binned cards are all the same `NOT_FOUND`; a restricted relation in `get_card` is exactly `{ type, restricted: true }` and the result carries no id, title, or board name of it; `list_cards` carries `relation_count` and `open_blockers`; `search_cards` returns readable live cards only (the owner finds the private card), with `query` and `limit` bounds; `link_cards` counts against the `task_write` bucket while `search_cards` does not; `taskErrorToMcp` maps `RELATION_EXISTS` with an MCP-shaped relation.

- [x] `tests/tasksAttachments.test.ts` (attachment discard, T100): the uploader discards an unlinked task attachment with `DELETE /api/files/:id` (a repeat is `alreadyDeleted`), the board owner and a stranger get the same 404 body as a missing id and the file stays live, the Bin lists it as an attachment, and a restore makes it a Files item. The existing sweeper tests cover the 24-hour never-linked step (`attachment_never_linked`, `deleted_by` NULL, 100 per run) and `ATTACHMENT_LINKED` for a linked file.

## Wave 13C: tags, flags, excerpts, and MCP filters (server)

Plan of record: [WAVE_13_TASK_CARD_UX.md](WAVE_13_TASK_CARD_UX.md) §7. No migration: 13C uses the 015 schema as merged.

- [x] `tests/tasksTags.test.ts` (tags): any reader creates a tag (trimmed, default colour gray), strangers 404; `TAG_EXISTS` with the existing tag for a name differing only in case, including non-ASCII case (`Äpfel`/`äpfel`); 400 for an empty, 41-character, bidi-carrying, or wrongly coloured name and extra keys; the board lists `tags` by name with live `card_count`; only the owner renames or recolours (`OWNER_ONLY` for members, 404 for strangers and unknown ids, `TAG_EXISTS` against another tag, its own name in another case allowed) and deletes (`{ removedFrom }` counts binned cards too; the card's revision stays; a restore keeps only the tags that still exist); audit rows with ids only (T101).
- [x] `tests/tasksTags.test.ts` (card tag sets): `tagIds` on create and `PATCH` with deduplication (case-insensitive ids) and order kept for tags that stay; audit `tagsAdded`/`tagsRemoved`; a tag of another board is 404 for the owner of both boards, on create and patch, and nothing is written; `CARD_CHANGED` carries `tag_ids` and `flags`; `[]` clears; caps of 100 per board (`LIMIT_REACHED`, while `TAG_EXISTS` still answers at the cap) and 10 per card (400, and 400 above 20 ids before deduplication).
- [x] `tests/tasksTags.test.ts` (flags): only the fixed set, each once (400 for a repeat, an unknown flag, a string, or five values); returned in the fixed order on the card and the board; `[]` clears; create takes `flags`; one patch of title, tags, and flags raises `revision` by exactly 1; a binned card keeps its tags and flags through restore.
- [x] `tests/tasksExcerpt.test.ts` (excerpt, D111): `descriptionExcerpt` strips Markdown and URLs and collapses whitespace; at most 160 code points with an ellipsis, exactly 160 kept whole, emoji never split into a lone surrogate; create, a description patch, and clearing the description write it, a title-only patch keeps it, and the board carries `description_excerpt` but never `description`; the boot `reconcileCardExcerpts()` fills live and binned cards with an empty excerpt, leaves a link-only description at `''`, and is idempotent.
- [x] `tests/taskQuery.test.ts` (unit, `shared/taskQuery.ts`): board order (column position, card position, id) both ways; `due` sorts undated cards last in both directions with board-order ties; titles sort accent-folded; filters OR within a field and AND across fields, `me` and `none`, exclusive `before`/`after` bounds AND-ed into a range, `none` OR-ed in, text folded for case and accents, blank text ignored.
- [x] `tests/taskQuery.test.ts` (parity, D113): one fixture board (three columns, three assignees, three tags including `Café`, flags, dated and undated cards, a timed card, and a binned card) through 26 filters, covering every field, `me`, `none`, ranges, accent-folded text in titles and excerpts, a literal `%`, an id no card has, and combinations: `filterBoardCardIds` (server SQL) returns exactly the ids and order of `queryCards` over `GET /boards/:b`, and MCP `list_cards` the same set; a stranger's query returns nothing.
- [x] `tests/mcpTasks.test.ts` (13C): `list_cards` returns the board's `tags` and each card's `tags` names, `flags`, and `description_excerpt`, as does `get_card`; `create_card` and `update_card` take tags by name in any case or by id and flags, reject an unknown tag or another board's tag with `INVALID` `UNKNOWN_TAG` and write nothing, reject an unknown flag, replace and clear both sets with the revision compare-and-swap (`CARD_CHANGED` on a stale one), audit `tagsAdded`/`tagsRemoved`/`flags` with `via: "mcp"`, and look missing to strangers; `list_cards` filters on the server for each field (`me`, `none`, names in any case, the due range and `dueNone`, accent-folded text, `columnId` combined), refuses bad dates, empty or 101-character text, unknown flags, and non-uuid assignees, lists the known tag names on `UNKNOWN_TAG`, and a filter never opens an unreadable board (T99).
- [x] `tests/tasksBoardPayload.test.ts` (D113 measurement): 1000 live cards with 3 assignees, 3 tags, 2 flags, a due time, and a 160-character excerpt each load in one `GET /boards/:b`; the JSON stays under a 1.5 MB regression ceiling. The plan's 1 MB and 1.5× targets are **not met** in this worst case (about 1.25–1.39 MB and about 4× the bare board); the numbers and options are in the plan's D113 note, pending a director decision. `MYNOTES_PAYLOAD_REPORT=1` prints the sizes and timings.
- [x] `tests/tasksCreateComposite.test.ts` (one-call create): tags, flags, assignees, a relation, and an attachment in one `POST /boards/:b/cards`, the relation's inverse on the target with its revision unchanged, `relation_count`/`open_blockers` on the board, and `task.relation_create`/`task.attachment_link` audit rows; a restricted or unknown target is 404, two relations to one card are `RELATION_EXISTS`, and bad types, extra keys, and 51 relations are 400, all writing nothing; someone else's attachment is the attachments route's 404 and an already linked one is 409 `ATTACHMENT_LINKED`; a full column is `COLUMN_FULL` before any other check and writes nothing.
## Wave 13: card fields UI (13B)

Plan of record: [WAVE_13_TASK_CARD_UX.md](WAVE_13_TASK_CARD_UX.md) §4.3, §4.4 (only the 13B parts), §7. Rendered with `react-dom/server`, as 13A.

- [x] `tests/tasksCardFields.test.tsx` (due time): a timed chip uses the viewer's local day and time of `due_at` ("Today 17:00"), turns overdue exactly at the instant, and shows "Tomorrow" the day before; a card due 23:30 at UTC+14 is "Today 21:30" the day before for a UTC−12 viewer; date-only cards keep the date chip; the time field saves only a complete, changed `HH:MM` (a changed zone counts, `:00` seconds are dropped, `24:00` and `9:05` are not); the zone note appears only when the card's zone differs from the viewer's, with the day when it differs.
- [x] `tests/tasksCardFields.test.tsx` (fields): `CardFields` shows no time control without a date, **Add time** after a date, and the time input with **Remove time** for a timed card; the assignee picker is a multiple `Combobox` bound to its label, with "Remove <name>" chips and "(no access)" for `can_read: 0`; no native select; lane cards read "Assigned to Ann and Bo" and show "+1", and a timed chip.
- [x] `tests/noNativeSelect.test.ts`: the allowlist is empty now that the card dialog uses `Combobox`.
- [x] `tests/tasksWip.test.tsx` (WIP, D108): under, at, and over the limit, with "2 of 3 cards", "…, at the limit", and "…, over the limit" labels; a full column refuses cards from other columns and new cards but not reordering within it; the limit field takes empty (no limit) or 1–1000 and refuses 0, 1001, fractions, negatives, and text; the header shows `n / limit` with the full and over styles and a refused drop shows the hint; **Move to…** disables a full column (labelled "Full (limit N)") and keeps the card's own column; the limit dialog offers **Remove limit** only when one is set and warns when the new limit is below the count.
- [x] `tests/tasksDueDisplay.test.tsx` (Today and the Calendar overlay): overlay cards group by the server's viewer-local `date` (a card due 23:30 at UTC+14 on the day before for a UTC−12 viewer) and fall back to `dueOn`; a timed overlay row shows its local time in the row and its accessible name, a date-only row says "Due"; Today task rows read "Due today at 09:30" for a timed card, keep "Due today" for a date-only one, and turn overdue once the instant passed.

Manual QA (headless Chrome over CDP at 1280×800 and 390×844 with touch, a scratch `DATA_DIR`, two throwaway accounts sharing a board):

- [x] Desktop: the card dialog is centred with no transform, and the assignee popup opens 4 px under the field; typing "Ben" and "Asha" searches the board's readers ("Asha Owner (me)"); nothing saves while the list is open, and Escape closes only the list and saves both in order; a chip's ✕ with the list closed saves at once; the lane card shows the first name and "+1".
- [x] Desktop: a due date (Enter commits it), then **Add time** focuses the time field and 17:30 saves with the browser zone; the dialog reads "Due 5 Mar 2027 at 17:30" and the lane chip "5 Mar 2027 17:30"; Back closes the card.
- [x] Phone: the card is full screen; the assignee picker is a bottom sheet with 44 px rows, a choice saves on **Done**; Back closes only the sheet, the next Back closes the card, and Forward reopens it; a due time of 23:59 today shows "Due today at 23:59" and the lane chip "Today 23:59"; no horizontal page scroll on the board, the sheet, or the card. (Native date and time pickers do not take CDP keys under touch emulation, so on the phone their values were set through the input's value setter.)
- [x] WIP: the owner sets a limit of 1 from the column menu (Back closes the limit dialog, on desktop and on the phone); the header reads "0 / 1", then "1 / 1" in the full style after **Move to…**, and the phone tab shows the same; **Move to…** lists the full column as "Full (limit 1)" and disabled; a drag over it is not accepted and shows the hint (driven with synthetic `DragEvent`s), and the card stays; Alt+→ and quick add into it show "“Doing” is full (limit 1). Move a card out of it first."; a move within the full column works; the member sees "1 / 1", has no column menu, gets 403 setting a limit and 409 `COLUMN_FULL` moving a card in.
- [x] Today's Due soon reads "QA board · Due today at 23:59", and the Calendar overlay row reads "23:59" with the name "Task due at 23:59: Second card".
- [x] As the member with the browser zone overridden to Europe/Berlin: a card set to 17:30 in Asia/Calcutta shows "5 Mar 2027 13:00" on the lane and "Set as 17:30 Asia/Calcutta (13:00 your time). Changing the time uses your zone (Europe/Berlin)." in the card; **Remove time** keeps the date, clears the time and zone, and offers **Add time** again.
- [ ] Not checked in the browser: a "(no access)" chip after unsharing (covered by the render test), and a real pointer drag (synthetic drag events only).


## Wave 13E: board views, filter bar, and board calendar

Plan of record: [WAVE_13_TASK_CARD_UX.md](WAVE_13_TASK_CARD_UX.md) §4.5–§4.7, §7. Pure modules are unit tested; views are rendered with `react-dom/server`, as 13A.

- [x] `tests/boardUrl.test.ts` (URL state, T102): filters are the 17C grammar carried as one canonical `q=` (`decodeFilterParams`/`encodeFilterParams`), and `src/tasks/boardUrl.ts` adds only `view`, `group`, `sort`, `cal`, and `month`; the default query is no query string; keys come out in a fixed order with readable `:` and `,`, and term order in the input never changes the output; the older per-key parameters (`assignee`, `tag`, `due=before:`, `column`, `rel`) still read and are written back as `q`; invalid views, groups, sorts, layouts, months, values, and unknown keys are dropped without throwing, and a query over 4 KiB reads as the default; the grammar's limits (20 terms, 20 values, 100-character text, no control characters) bound a URL; hostile text stays a text term inside its parameter; the month rule matches the router's `isRouteMonth`.
- [x] `tests/routerSearch.test.ts` (router, §10 risk): a Tasks location keeps its query (formatted as `?view=table&q=flag:urgent`) only when `location.search` is passed; card URLs carry the board query and closing (or in-app Back at depth 0) returns to the same view, while the board list drops it; an href with its own `?query` parses like a location; other apps ignore the search; `locationUrl` adds the query only on Tasks paths; and a source check fails if `src/App.tsx`, `src/tasksRoute.ts`, or `src/tasks/**` parse `location.pathname` without the search or compare Tasks URLs without it.
- [x] `tests/boardQuery.test.ts` (one pipeline, D113, §4.5): `boardData` fills the optional payload fields of an older board; every filter field (assignee with `me` and `none`, tag with `none` and an unknown id, flag, column, relations, the due range and `none`, folded text over the title and excerpt), values OR within a term and terms AND; the relative due windows against the viewer's today (`week` is today and six days, `next-week` the seven after, a timed card overdue once its instant passed, a date-only card overdue from midnight); the grammar-only terms run in memory (negation, tag names in any case, `state:` from the column state or `is_done`, `creator:me`, `has:blocked`, `has:relation`), and the structured `queryCards` path and the in-memory matcher agree; each grouping dimension in order, with empty columns kept, a card with two assignees or tags in each group with "also in" labels, and filters applied first; every table sort stable, tie-broken on board order, with empty values last both ways; the bar edits one positive term per field and keeps negated terms from a shared URL; and a stub `parent` dimension and filter field plug into the registries without code changes (hierarchy readiness).
- [x] `tests/boardViews.test.tsx` (table and grouped list, §4.5): the view switch is a radio group labelled "View" with one tab stop; table headers carry `aria-sort` and cycle ascending, descending, then board order; the table sits in a focusable region labelled "Cards table" with the sticky title column holding the open button and ⋯; card titles render as text; assignees without access read "(no access)"; tag and flag labels are named; done cards show no due chip; an empty table says whether filters hide the cards; the grouped list has a "Group by" custom dropdown, counted and collapsible sections, "also in …" for a card listed twice, and empty columns kept; no native select.
- [x] `tests/boardFilterBar.test.tsx` (filter bar, §4.6, §4.8): chips read as sentences for positive, negated, and grammar-only terms ("Assignee is Me, Asha", "Flag is not Urgent", "Overdue or Due before …", "No relations", "Unknown tag"); the bar is a group labelled "Filters" with an edit and a remove button per chip, a "+ Filter" custom dropdown, the text box holding the positive text term, **Clear**, and a live "n of m cards" count; tag names render as text; with the Search module off the text box is hidden and a text filter from a link shows as a removable chip; a filtered lane keeps the column's real WIP count and says "No matching cards"; no native select.
- [x] `tests/calendarGrid.test.tsx` (§4.5a refactor): `src/ui/calendarGrid/MonthGrid` renders six Monday-first weeks (42 cells), the caller's chips as text, "…, 2 items" day names, today and the selected day, Today only outside the current month, compact dot cells with one-letter weekdays, a status that replaces the grid, the busy state, and drop targets only when asked; `AgendaList` renders one section per day with Today/Tomorrow headings, the caller's rows and trailing note, or its empty state; Calendar's `MonthView` and `AgendaView` still render their own shells on the shared pieces. Browser check (headless Chrome, a scratch `DATA_DIR`, events including a daily series, an all-day span, a busy day with "+1 more", and the Tasks due overlay): the rendered DOM of Calendar's desktop month, phone month, and agenda is byte-identical before and after the refactor.
- [x] `tests/boardCalendar.test.tsx` (board calendar view, §4.5a, D115): date-only cards sit on `due_on`, a timed card on the viewer-local date and time of `due_at` (23:30 at UTC+14 shows 21:30 the day before for a UTC−12 viewer), date-only first then by time, the rest in Unscheduled; filters run before placement; a drop shifts the civil date by the days between the shown and the drop day (so the time and zone stay), an unscheduled card takes the drop day, and the optimistic instant shifts with it; Alt+←/→ is a day and Alt+↑/↓ a week, announced as "Due …"; the view reads "Due dates of cards on this board. Events linked to cards are in Calendar.", has the Month/Agenda radio group, the Unscheduled tray with its help line and "Set due date for …" buttons, muted done cards, drop targets on day cells, the "(… your time)" name for a card set in another zone, titles as text, the empty-month copy, and the agenda.

## Wave 13F: Modules

With 13B merged, `tests/migrations.test.ts`, `tests/api.test.ts`, and `tests/searchIndex.test.ts` pin 1–16 and allow 017 onwards.

- [x] `tests/migrations.test.ts`: 016 on a database at migration 10 with users and no backfill; the defaults (`[]`, revision 1); the CHECK refuses non-JSON, a JSON object, and a value over 512 bytes; the user foreign key and its cascade.
- [x] `tests/preferences.test.ts` (API): defaults for a user without a row (revision 0) in both `GET /api/preferences` and `/api/auth/me`; PUT stores ids in registry order and bumps the revision by exactly one; `/api/auth/me` includes the saved value; a stale revision gets 409 `PREFERENCES_CHANGED` with the current value, and of two parallel writers exactly one wins; unknown ids (`home`, `settings`, wrong case), duplicates, too many ids, a missing or negative revision, and extra keys get 400 and change nothing; per-user rows; a session and CSRF are required; retired ids are dropped on read; a disabled module's API still works for its owner and still returns 404 to a stranger (T97).
- [x] `tests/modules.test.tsx` (registry and Settings): the client and server module ids match, including `team`; Settings lists every module including Team (from Wave 14), guests get no Team row, and admins see that Team stays in Settings; Team off removes the Team button and redirects `/team`; every Today section belongs to exactly one module; unknown ids, duplicates, and non-arrays are ignored; toggles keep registry order; malformed server preferences mean every module is on; each row is a labelled `role="switch"`, on by default, off when disabled; the Bin and Notifications help says what keeps working; a conflict is a status and a failure an alert.
- [x] `tests/modules.test.tsx` (gating, client only): `TODAY_APPS` is derived from the registry and the launcher on Home drops modules that are off; Bin off removes the Bin button from Home and from `AccountActions` even when an app passes `onBin`; the Today sections of modules that are off are neither requested nor shown; `hiddenModuleForApp` gates every route of a hidden module (Calendar event and month URLs, Tasks, Bin, Notifications, Notes) and never Home, whatever ids are stored.

Manual QA (desktop and 390×844, a throwaway account):

- [x] Settings → Modules lists eight switches, all on; turning Calendar off saves it on the server and removes it from the Home launcher and Today's Upcoming at once.
- [x] With Calendar off, a deep link to `/calendar/month/…` and Back into an earlier `/calendar` entry both land on Home with "Calendar is turned off. Turn it on in Settings → Modules.", and no Calendar view renders; **Turn on in Settings** opens Settings on Modules; turning it back on clears the hint, restores the tile, and `/calendar` opens again.
- [x] Browser Back with Settings open only closes Settings and keeps the URL, at 390 px and on desktop.
- [x] With Bin, Notifications, and Search off (saved from another client), Home has no Bin button, bell, or Leaving the Bin soon; Notes has no search box and no Bin in its footer; `/bin` goes Home with the hint; turning them back on restores them.
- [ ] A second browser signed in to the same account picks up the change when its tab becomes visible again.
- [ ] With Bin off, deleting a note still moves it to the Bin; with Notifications off, a reminder still arrives as a push on a device with push on; with Search off, Ctrl+K does nothing in Notes. The Bin button is also gone from the Tasks, Collections, and Files headers.
## Wave 13: shared dropdowns (13A)

`Select` and `Combobox` in `src/ui/` replace every native select (D91, D114; [WAVE_13_TASK_CARD_UX.md](WAVE_13_TASK_CARD_UX.md) §4.1–4.2). The tests render with `react-dom/server` and drive the pure reducers, so no DOM library is needed.

- [x] `tests/uiListNavigation.test.ts`: arrow keys, Home/End, and PageUp/PageDown skip disabled options and stop at the ends; type-ahead ignores case and accents, wraps, and cycles on a repeated letter; the select reducer opens, chooses on Enter, Space, Tab, and Alt+↑, and closes on Escape without choosing; the multi reducer adds, removes, keeps `maxSelected`, and Backspace in an empty input removes the last chip; filtering matches every word in labels and descriptions; auto search above 8 options; `popoverPosition` opens below, flips above, clamps to the viewport, and lands on target inside a transformed container; async options are debounced by 200 ms and a new request aborts the previous one.
- [x] `tests/uiSelect.test.tsx` and `tests/uiCombobox.test.tsx`: the combobox, listbox, option, and `aria-activedescendant` attributes; chips are "Remove <name>" buttons; `aria-multiselectable` only when several can be chosen; `maxSelected` disables the rest; `selectedOptions` label chips; the `onCreate` row; labels containing `<img onerror>` render as text (T98); the phone presentation is a bottom sheet dialog, and its guard closes only the sheet on Back (and undoes Forward) before the host dialog's guard is asked (D69).
- [x] `tests/noNativeSelect.test.ts`: no `<select` in `src/**/*.tsx` outside `src/ui/`; `src/tasks/CardDialog.tsx` is allowlisted until 13B moves its assignee picker to `Combobox`, and the allowlist fails once that file no longer has one.
- [x] `tests/historyDialogs.test.ts`: Back from the depth-0 sentinel that closes the inner of two stacked dialogs re-arms the sentinel for the outer one, so the next Back closes it in place.
- [x] `tests/calendarFeedUi.test.tsx` and `tests/collectionsApp.test.tsx`: the Calendar pickers (event calendar, Repeats, calendar colours), the sort and filter sheet, the field editor (a single type choice stays disabled), and collection cells render custom dropdowns and no native select.

Manual QA (headless Chrome at 1280×800 and 390×844 with touch):

- [x] Calendar: the new-event calendar picker opens under its trigger inside the event sheet; ↓, Home/End, type-ahead, and Enter choose; Escape closes only the popup and a second Escape closes the sheet; a press on the scrim closes only the popup; Repeats keeps its autofocus and the "Monthly (on day N)" label; a calendar's colour changes by keyboard and saves.
- [x] Collections: sort field, direction, filter field, condition, and option value by keyboard, and the filter applies; the option colour picker with swatches and type-ahead; a number field's type stays disabled; a table cell opens with Enter, starts with Clear, closes with Escape keeping focus on the cell, and saves a choice.
- [x] Phones: dropdowns open as bottom sheets with rows of at least 44 px and no horizontal scrolling; Back closes only the sheet (over the event sheet, the sort and filter sheet, and the row panel), and the next Back closes the sheet under it without leaving the page.

## Wave 14: Team (Team A)

Merged after Wave 13: `tests/migrations.test.ts`, `tests/api.test.ts`, and `tests/searchIndex.test.ts` pin migration ids 1–17. Team is a row in Settings → Modules (guests never see it; admins keep Settings → Manage team while it is off), and the role picker uses the shared 13A `Select`. Plan of record: [research/2026-09-26-team-module.md](research/2026-09-26-team-module.md) §10.

- [x] `tests/teamMigration.test.ts` (migration 017 on a v0.7.0-shaped database): 0 users (no admin, no event), 1 user (admin, one `bootstrap_admin` event with `via = 'migration'`), 3 users plus a pre-disabled older one (the oldest *enabled* account is admin, the rest members, the disabled one stays blocked with `blocked_by = NULL`); re-running is a no-op; the role CHECK and the 200-character reason cap; the last active admin cannot be demoted, blocked, or deleted with direct SQL, a blocked admin does not count; `team_events` UPDATE and DELETE abort, but deleting the actor sets `actor_id` to NULL and deleting the target cascades.
- [x] `tests/teamBootstrap.test.ts` (a subprocess on an empty data directory, `tests/support/teamBootstrapProbe.ts`): two racing first registrations with `ALLOW_REGISTRATION=false` let exactly one through, and it is the only admin with one `bootstrap` event; the host CLI lists accounts, refuses to demote the last admin (`LAST_ADMIN`, exit 1), promotes a member (one `via = 'cli'` event with no actor and one audit row), refuses viewer and guest (exit 2), unknown accounts, unblocking an active account (`NOT_BLOCKED`), and unknown commands.
- [x] `tests/team.test.ts` (API): admins get email and metadata, members see names and roles only (no `@` anywhere in the body), guests get 404 on every route, malformed and unknown ids are 404, no session is 401; members and viewers get 403 `ADMIN_ONLY` on every write and nothing changes; `role` is refused in register and login bodies; promote and demote need re-authentication (missing or wrong password → 401 `REAUTH_REQUIRED`), a stale `expectedRole` → 409 `ROLE_CHANGED` with `currentRole`, one event and one audit row with ids and roles only, the new role applies on the target's next request, a same-role change adds no event; viewer and guest → 400 `ROLE_NOT_ENABLED`, strict bodies; `LAST_ADMIN` from the service and the trigger, self-demotion with a second admin, and the demoted admin loses Team management at once; with TOTP on: a wrong or already-used code is refused, a fresh code or a recovery code works.
- [x] `tests/team.test.ts` (block): sessions deleted (next request 401), push subscriptions deleted, the MCP key refused (401) and resumed after unblock, `SELF_ACTION`, `ALREADY_BLOCKED`, `NOT_BLOCKED`; login with the right password → 403 `ACCOUNT_BLOCKED` without the reason, a wrong password → the generic 401; the share picker leaves the account out; the audit row carries no reason; after unblock old sessions stay dead and sign-in works; blocking an admin needs re-authentication; sign-out-everywhere without blocking; missing CSRF, a foreign Origin, and a form-encoded body are refused; an upload streaming into staging when the block lands is refused at commit (401) with no document, staged file, or object left; the reminders dispatcher skips a blocked account and fires after unblock; 30 Team writes a minute per admin, then 429.
- [x] `tests/teamMcp.test.ts`: `team:read` refused at key creation for a member (403 `SCOPE_NOT_ALLOWED`), allowed for an admin; `list_team_members` and `get_team_member` return names, roles, status, and dates but no emails or block reasons; unknown ids are `NOT_FOUND`; a demoted admin's key no longer lists the Team tools and a direct call gets `SCOPE_REQUIRED`, while its other scopes keep working; restoring admin brings the tools back.
- [x] `tests/mcpPermissions.test.ts`: Settings offers `team:read` to admins only, matching `mcpScopesForRole`.
- [x] `tests/teamClient.test.tsx`: the client role mirror matches `server/team/roles.ts`; list filters, search, chips, status labels ("Blocked (before Team)"), the 7-day New tag, the last-admin guard, activity copy, and the Back rule (history, then detail → list, then Home); the role picker's options (every role with its description, only this release's roles selectable) rendered by the shared 13A `Select` (a listbox trigger with descriptions and disabled rows, never a native `<select>`; its keyboard model is covered by `tests/uiListNavigation.test.ts`); the account row shows Team after Bin for all roles but guests and not on Team itself; the Team app renders for admins and members and tells guests it is unavailable.
- [x] `tests/router.test.ts` and `tests/appShellNavigation.test.ts`: `/team`, `/team/:userId` (uppercase ids lowercased), `/team/garbage` and extra segments → the list, `formatRoute` round trips; the `team` history section.

Manual QA (headless Chrome, desktop 1280×800 and 390×844, isolated data directory; done for Wave 14):

- [x] The first account registered becomes admin; a second one is a member. Home at 390 px shows Settings, Bin, Team, and Sign out; every app header fits 390 px with the Team button.
- [x] `/team` list and member page at 390 px (one pane at a time) and on desktop (two panes). The role picker opens as a bottom sheet on a phone and a popover on desktop; Escape closes it and returns focus to the button.
- [x] Promote with the password (a wrong password shows an error), demote, block with a reason, unblock; the Activity list records each change; Settings shows "Manage team" and the Read team permission for the admin only.
- [x] Back with the role sheet or a dialog open only closes it; Back then goes member → list → Home and Forward returns. A fresh load of `/team/:id` on a phone (depth 0): Back from a dialog stays on the member, and the in-app back replaces it with the list.
- [x] The login screen shows the blocked message for the blocked account's right password; after unblock it signs in.

## Wave 17C: task filter grammar, cross-board query, and views (server)

Plan of record: [research/2026-09-26-task-hierarchy-workflows.md](research/2026-09-26-task-hierarchy-workflows.md) §10–§11. Migration ids pin 1–16 and tolerate 017–019 (Team, hierarchy) being absent while 020 is present.

- [x] `tests/taskQueryGrammar.test.ts` (pure): parse and format round-trips and idempotence; the canonical key order, positive-before-negated, value dedupe and sort; quoting and escapes; bare words and quoted phrases as text, NFC; tag names deduped case-insensitively; error codes and character positions; reserved `parent:`/`level:`/`sprint:`/`has:subtasks` as `FILTER_UNSUPPORTED`; the length, term, and value caps; the `column:` scope rule; lenient mode; due windows across a year end; the URL codec (`?q=` written, other parameters kept, Wave 13 per-key parameters and `rel=` read).

- [x] `tests/taskQueryParity.test.ts`: 20 structured filters (assignees with `me`/`none`, tags, flags, due bounds and `none`, columns, text, and combinations) give the same cards through the board pipeline, the `list_cards` SQL, and the cross-board query with the canonical text plus `board:`; each survives `queryFromCardFilter` → `cardFilterFromQuery`; `has:relation`/`-has:relation`/`has:blocked` equal `relation_count > 0`/`= 0`/`open_blockers > 0` for the owner and a member, including after the other board is binned; queries the board pipeline cannot express map to `null`.
- [x] `tests/cardQuerySql.test.ts`: hostile text, tag names, and ids appear only as bound `$f<n>` parameters and every placeholder is bound; every key compiles to SQL SQLite accepts (`EXPLAIN`); negation is `NOT COALESCE(…, 0)`; the other-board predicate equals the readable predicate on alias `ob`.
- [x] `tests/tasksQuery.test.ts` (`POST /api/tasks/query`): a three-user matrix (owner, member of one shared board, a stranger with a private board) sees only readable cards whatever the filter names (T115); a forbidden board id in the filter returns nothing and `refs` marks it `restricted` with no name (T116); binned cards and boards drop out; unsharing ends access at once; assignee (`me`, `none`, ids), creator, and the derived state; `column:` with one board and `FILTER_SCOPE` without; `FILTER_INVALID` positions, `FILTER_UNSUPPORTED`, and body limits; tags by id and by name across boards, `tag:none`, flags and `-flag:none`; due windows in the caller's zone, negation keeping undated cards, timed cards overdue after their wall time; text over titles and excerpts with no wildcards; `has:relation` counting restricted relations and hiding readable binned ones; `has:blocked` only for open blockers; keyset pages cover every card once for every sort × group, with an insert between pages; `CURSOR_INVALID` for another sort, query, or a forged cursor; 30 per 10 s then 429 with `Retry-After`, per user; session and CSRF required.
- [x] `tests/migrations.test.ts` (020): on a 016-shaped database without 017–019: the state backfill (done, first → todo, the rest → doing, and a board whose first column is done), `(state = 'done') = (is_done = 1)`, the state CHECK and the `doing` default; `task_views` CHECKs (name length, query length, JSON object display ≤ 2048, visibility); member and owner cascades.
- [x] `tests/tasksViews.test.ts` (column state): default states on new boards and columns; `state` sets `is_done`; `isDone` on and off (first column todo, later doing); conflicting values 400; owner only (members 403, strangers 404); the pair stays consistent after create, patch, reorder, rename, and delete (T121); `state:` filters read the stored state.
- [x] `tests/tasksViews.test.ts` (views): canonical query and display on create; the share matrix, where the owner's view names a board only the owner can read: private (404 for others), `selected` (the member sees only the shared board's cards and the private board as `restricted`), `all_users` (a stranger sees zero cards), and after the member loses the board (T115, T116); `assignee:me` means the viewer; a disabled owner's views vanish; `FILTER_*` and display validation, control characters in names, the 50-view cap and positions; owner-only patch, share, sharing read, and delete (403 for readers, 404 for others); sharing validation; CAS `VIEW_CHANGED` with the current view, display merge, reorder; duplicate into a private copy that runs as its new owner; delete; view cards paging with the view's sort and parameter validation.
- [x] `tests/mcpTaskViews.test.ts` and `tests/mcpTasks.test.ts`: `list_views` and `query_cards` are listed only for task scopes and re-checked in the handler (`SCOPE_REQUIRED`); `query_cards` with a filter runs as the key's owner in the MCP card shape (names, excerpt, state, no description); a recipient naming the owner's private board gets none of its cards and a `restricted` ref with no name; grammar errors are `INVALID` with `reason` and `position`; exactly one of `viewId`/`filter`, `sort`/`group` only with `filter`, `limit` ≤ 50, `tz`, and `CURSOR_INVALID`; paging with `nextCursor`; `list_views` hides unshared views (`NOT_FOUND` for them and for missing ids) and lists shared ones; a shared view run through MCP shows the recipient only their readable cards (the T115 twin); reads are not audited and there are no view write tools.
- [x] `tests/tasksQueryPerf.test.ts`: 20 boards × 500 cards readable by the caller plus 2000 on a stranger's private boards; four query shapes and a second page stay under p95 150 ms and never return the stranger's cards. `MYNOTES_QUERY_PERF=large` runs the plan's 10 users × 50 boards × 1000 cards (500 000 readable cards) by hand and only reports: last run, My work 34 ms, everything by updated 759 ms, text + tag + overdue grouped by board 990 ms, negated flag grouped by due 1856 ms, second page 937 ms (p95 of 5).

## Manual QA (§M), required at the W4 and W5 gates

Run in desktop Chromium, desktop Firefox, a mobile viewport (DevTools device mode at 390×844), and at least one real phone browser over the LAN or Tailscale origin.

**Desktop**

- [ ] Home → Files → Home → Bin → Notes.
- [ ] Upload a single file with the button. Drag several OS files onto the list. Drop onto a non-owned folder view (refused with a clear message). Watch the progress bars. Cancel mid-upload. Retry after taking the network offline and bringing it back (no duplicate).
- [ ] Preview each kind: PNG/JPEG/GIF/WebP, PDF in a new tab, `.md`/`.txt` over 1 MiB (truncation notice), MP3, MP4 seek (Range). SVG, HTML, and DOCX → download only.
- [ ] Download keeps the Unicode filename.
- [ ] Rename (the dialog preselects the base name). Move by drag to a folder and through the menu. The toast shows the effective visibility.
- [ ] Share a document (inherit/private/selected/all). Log in as the recipient: it is visible and read-only, with no mutating actions.
- [ ] Delete → toast Undo works. Delete again → Bin shows it with the days remaining. Restore. Delete forever. Empty Bin.
- [ ] Keyboard-only: navigate the list, Enter to preview, F2 to rename, Delete to delete, focus return, Esc closes dialogs.

**Mobile**

- [ ] Panels folders → files → preview. The header Back button and the **browser/OS Back** match at each step, and Forward re-enters.
- [ ] Back from Files folders → Home. Back from Home leaves as expected.
- [ ] Action sheet, Move sheet (current folder disabled), Rename dialog. The browser Back button while a sheet is open closes it and stays on the panel.
- [ ] The upload picker supports multiple files. Queue bottom sheet. Touch targets ≥ 44 px. Safe-area insets on a notched device.
- [ ] Notes mobile navigation still behaves exactly as in Wave 1 (regression).

**Operations**

- [ ] `./scripts/backup.sh --force` with documents present. The archive contains `documents/objects` and no `.staging`. A restore into an empty directory boots and serves files.
- [ ] A container restart during an upload leaves no staging leftovers after boot. The sweeper logs counts only.
- [ ] `docker stats` RSS stays flat during a near-limit upload.
