# Test plan: Home, Files, Bin, Search, and MCP scopes

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

## Wave 8: MCP scopes

Unit tests (no server):

- [x] `tests/mcpScopes.test.ts`: normalizing adds implied reads, dedupes, and orders; write implies read and never the reverse; stored JSON reads leniently (null, bad JSON, objects, unknown values) and never grants more than is stored.
- [x] `tests/mcpPermissions.test.ts`: the Settings list mirrors the server scopes and implications; the Write drafts help says "never publishes"; checking a write scope checks and locks its read scope; unchecking it unlocks but keeps the read; only the notes and files scopes are offered until the task tools land.
- [x] `tests/noteFinalization.test.ts`: leaving a note auto-publishes only a draft edited in this session; a waiting draft (MCP or another session) is not published; the Publish button is offered for any owner delta; the "Draft by <key>" label.

`tests/migrations.test.ts`:

- [x] Migration 010 applies to an 008-shaped database without 009's tables; an existing key reads `["notes:read"]`; `scopes` must be valid JSON; `draft_mcp_key_id` references a key and becomes NULL when the key row is deleted. Migration id assertions read the registered list and pin 1–8 and 10.

`tests/mcp.test.ts`:

- [x] Keys: an API-created key defaults to `notes:read`; chosen scopes are stored with implied reads, listed, and audited in `mcp.key_created`; empty, duplicate, unknown, too many, and non-array scopes are 400.
- [x] Scopes: `tools/list` per scope (`files:read` sees only the document tools and `list_folders`; `notes:read` no write or document tools; `notes:write-draft` also the read tools); calling an unregistered tool fails; a direct handler call without the scope returns `SCOPE_REQUIRED`; a revoked key gets 401 and `SCOPE_REQUIRED`.
- [x] `search_notes`: published text only (the owner's newer draft is neither searched nor used for the title), plain snippets, reader and stranger access, unsharing applies at once, folder filter, `limit` over 20 fails, FTS operators are plain words, binned notes vanish. `list_folders` equals `GET /api/folders`.
- [x] Draft writes: `create_note` makes a draft-only note (no version) in Default or an owned folder, never a folder shared by someone else; the draft is indexed for the owner's search but not for MCP search; `draftMcpKeyName`/`draft_mcp_key_name` show the key and `draft_mcp_key_id` is never returned; publish and discard clear it. `update_note_draft` appends and replaces, keeps the version count, audits `mcp.note_draft_update`, and returns `DRAFT_CHANGED` with `currentRevision` for a stale revision and after a human autosave. Shared (readable but not owned), binned, and missing notes return the same `NOT_FOUND`.
- [x] Documents: text is read as strict UTF-8; PDFs, binaries, a bad UTF-8 tail past the sniffed prefix (`NOT_TEXT`), and files over 1 MiB (`TOO_LARGE`) are refused; metadata carries no hash, path, or upload key; sharing, the Bin, and `purpose <> 'file'` documents follow the Files list predicate.
- [x] Limits: 120 calls a minute, then `RATE_LIMITED` with `retryAfterSeconds`, per key; 30 writes a minute (refused CAS attempts count); a refused call charges no bucket; the daily `create_note` bucket resets after a day.
- [ ] Tasks: the W9 role matrix for the task tools (lands with `feat: add MCP task tools`).

Manual QA:

- [ ] Settings → MCP server at desktop and 390×844: Permissions rows are at least 44 px, checking Write drafts checks and locks Read notes, the key list shows scope chips, and the copied config still works.
- [ ] With a `notes:write-draft` key, call `create_note`, then open Nook: the list and editor show "Draft by <key>"; switching notes without typing leaves it unpublished; Publish version removes the badge.
- [ ] A notes-only client (for example the MCP Inspector) lists only the read tools.

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
