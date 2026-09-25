# MyNotes plan: Search (W7), MCP coverage (W8), Task Boards (W9)

Extends [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) under its rules. Baseline: migration 007.

## 0. Sequencing: 7 → 9 → 8

W8 needs W7 (`search_notes`) and W9 (task tools). Shipped last, it is a thin adapter over existing services, and scopes ship once.

| Order | Wave | Migration | Release |
| --- | --- | --- | --- |
| 1 | W7 | `008` | v0.5.0 |
| 2 | W9 | `009` | v0.6.0 |
| 3 | W8 | `010` | v0.7.0 |

Fallback if MCP writes are urgent: ship W8 without its task tools as migration `009`, and Task Boards as `010`. Scopes are stored as JSON, so adding task scopes later needs no migration.

## 1. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D30 | FTS5 table that stores its text: one row per `(note, kind∈{published,draft})` | `snippet()` needs the stored text. Verified on Bun 1.4.2 (SQLite 3.53). |
| D31 | Index version files and `draft.md` after checking checksums. Never index `current.md`. | The mirror can be stale. |
| D32 | Search returns what `GET /api/notes/:id` returns: the owner's draft if one exists, otherwise the published version. MCP gets published only. | Drafts never leak. |
| D33 | Tokenizer `unicode61 remove_diacritics 2`, `prefix='2 3'` | Folds case and accents. Smaller than trigram. |
| D34 | Write the index in the note change's transaction. Purge cascades to it through a trigger. Migration 008 only creates tables; boot `reconcileSearchIndex()` backfills. | No drift. Migrations stay filesystem-free. |
| D35 | User input never becomes FTS syntax. Highlights return as `{text, hit}` segments, never HTML. | Prevents injection. |
| D36 | Key scopes are fixed at creation: `notes:read`, `notes:write-draft`, `files:read`, `tasks:read`, `tasks:write`. Write implies read. Existing keys become `notes:read`. Tools are registered per scope and checked again in the handler. | Least privilege |
| D37 | MCP writes drafts only, on owned notes. There are no publish, delete, share, or move tools. `notes.draft_mcp_key_id` records which key wrote a draft. | A human publishes, and versions provide undo. |
| D38 | Members can edit, move, and bin any card, comment, manage their own comments, and attach their own files. Only the owner renames the board, manages columns, changes sharing, deletes, or purges. | A read-only kanban is useless, and columns are shared workflow. D2 is relaxed for boards only. |
| D39 | Non-readers get 404. Members calling owner-only actions get 403 `OWNER_ONLY`. | Members already know the board exists. |
| D40 | The server computes `position REAL` from `afterCardId`: the midpoint of the neighbours, or last + 1024. A column is renumbered when a gap drops below 1e-6. Changes run under the `board:<id>` lock. | One row per move, and clients never send floats. |
| D41 | The Bin gets `card` and `board` types with the same tombstone and CAS restore. A binned card is listed for the board owner and for the member who deleted it; either can restore it, but only the owner purges. | Bin parity, and members get Undo |
| D42 | An attachment is a document owned by the uploader, uploaded with `?purpose=task-attachment` into a private "Task attachments" folder and linked in `card_attachments`. Unlinking keeps the file. | Reuses uploads and quota |
| D43 | A document linked to a live card on a readable board is readable. This applies in `readableDocument*` only, never in lists. | Revocation is immediate, and attachments stay out of Files. |
| D44 | Card Markdown renders through read-only `NoteEditor`/`noteContentExtensions()`. | The notes renderer is schema-bound and never renders raw HTML. |

## 2. Wave 7: Full-text search

### 2.1 Migration `008_note_search`

```sql
CREATE TABLE note_search_rows (
  id INTEGER PRIMARY KEY,  -- = note_fts.rowid
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('published','draft')),
  source_checksum TEXT NOT NULL CHECK (length(source_checksum) = 64),
  indexed_at TEXT NOT NULL, UNIQUE (note_id, kind));
CREATE VIRTUAL TABLE note_fts USING fts5(title, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3');
CREATE TRIGGER note_search_rows_ad AFTER DELETE ON note_search_rows
  BEGIN DELETE FROM note_fts WHERE rowid = old.id; END;
```

Migration assertion `[1..8]`. A test proves that the cascade fires the trigger.

### 2.2 Index sync (`server/search.ts`)

The pure `searchText(md)` keeps alt text, link text, and code, and strips URLs and markup. `indexNote` and `unindexNote` run inside the caller's transaction.

| Event | Effect |
| --- | --- |
| `PUT /draft` | Index the draft, in the same transaction as the UPDATE. An empty draft is unindexed. |
| `POST /publish` | Index the published version and unindex the draft |
| Discard draft / restore version | Unindex / index the draft |
| Bin, purge | None / cascade + trigger |

At boot, `reconcileSearchIndex()` compares each `source_checksum` against the DB checksums. It reindexes rows that are missing or stale, deletes orphans, and then runs `optimize`.

### 2.3 `buildFtsQuery` (pure)

1. Apply NFKC and lowercase. `q` must be 1–200 characters.
2. Keep up to 4 `"phrases"`.
3. Split the remaining text on `/[^\p{L}\p{N}]+/u`.
4. Keep up to 8 terms of 2–64 characters.
5. Emit `"a" "b"*`, an implicit AND. The last term gets a prefix `*` unless `q` ends in a space.
6. If nothing remains, the result is empty.

### 2.4 `GET /api/search?q=&scope=notes&folder=all|shared|<uuid>&limit=20`

`note_fts MATCH` requires `n.deleted_at IS NULL` and one of:

- `kind='draft'` and the caller owns a drafted note
- `kind='published'` and `current_version>0`, the note is not the caller's own draft, and `readableNotePredicate` holds (extracted into `server/access.ts`)

Results are ordered by `bm25(note_fts, 8.0, 1.0), updated_at DESC`. Titles use `highlight()` and bodies use `snippet()`. `folder_id` is masked as in `GET /api/notes`.

| Status | Meaning |
| --- | --- |
| 200 | `{results: NoteSearchHit[], truncated}` (no scores) |
| 400 | Bad `scope`, `folder`, or `limit` (1–50), or `q` longer than 200 characters |
| 429 | `RATE_LIMITED`: more than 20 requests per 10 s per user |

`NoteSearchHit` = `{id, source: "published"|"draft", title: Segment[], snippet: Segment[], folder_id, owner_name, is_owner, visibility, updated_at}`, where `Segment` = `{text, hit}`.

### 2.5 UI (`src/search/`)

- **Behaviour.** Search starts at 2 characters, debounced 200 ms, and a new request aborts the previous one.
- **Rows.** Each row shows the marked title and snippet, plus folder, owner, Draft badge, and time.
- **Scope.** The current section, with a "Search all notes" chip.
- **Keyboard.**
  - Ctrl/⌘+K or `/` focuses search.
  - ↑/↓ move through results (`aria-activedescendant`), and Enter opens one via `selectNote`.
  - Esc clears the query.
  - `aria-live` announces the result count.
- **Mobile.** 44 px rows. Back returns to the results, and the query is kept.

### 2.6 Tests

- **Unit:** `searchText`, plus `buildFtsQuery` with operators, `title:x`, `NEAR()`, unterminated quotes, `***`, emoji, diacritics, and the caps.
- **API:**
  - Matching: accents, prefix, title weight.
  - Drafts: only the owner finds draft text, and the draft row is gone after publish.
  - Access: results ⊆ `GET /api/notes` across the share matrix, and unsharing takes effect at once.
  - Bin: binned notes are hidden, restored notes return, and purge removes FTS rows.
  - Version restore reindexes.
  - Boot backfill on a 007 fixture.
  - 429 and 400 responses.

### 2.7 Commits (M, two sessions)

1. `feat: add note search migration 008`
2. `feat: add search text projection and FTS query builder`
3. `feat: index notes transactionally with boot reconcile`
4. `feat: add ACL-safe search API`
5. `feat: make Notes search full-text`
6. `docs: document search`

## 3. Wave 9: Task Boards

### 3.1 Migration `009_task_boards`

`BIN` = `deleted_at`, `deleted_by`, `purge_after`, `purge_started_at`, and the paired CHECK, as used for documents.

```sql
CREATE TABLE boards (id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','selected','all_users')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, BIN);
CREATE TABLE board_members (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_id));
CREATE TABLE board_columns (id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE cards (id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id TEXT REFERENCES board_columns(id) ON DELETE SET NULL,
  position REAL NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(CAST(description AS BLOB)) <= 65536),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, BIN,
  CHECK (deleted_at IS NOT NULL OR column_id IS NOT NULL));
CREATE TABLE card_comments (id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) >= 1 AND length(CAST(body AS BLOB)) <= 16384),
  created_at TEXT NOT NULL, edited_at TEXT);
CREATE TABLE card_attachments (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES card_comments(id) ON DELETE CASCADE,
  linked_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (card_id, document_id));
CREATE INDEX idx_boards_owner ON boards(owner_id, deleted_at);
CREATE INDEX idx_cards_board ON cards(board_id, deleted_at);
CREATE INDEX idx_board_members_user ON board_members(user_id, board_id);
CREATE INDEX idx_columns_board ON board_columns(board_id, position);
CREATE INDEX idx_cards_column ON cards(column_id, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_card ON card_comments(card_id, created_at);
CREATE INDEX idx_card_attachments_document ON card_attachments(document_id);
-- addColumn(folders, system_role, "TEXT CHECK (system_role IN ('task_attachments'))")
CREATE UNIQUE INDEX idx_folders_system_role ON folders(owner_id, system_role) WHERE system_role IS NOT NULL;
```

New boards start with To do, Doing, and Done at positions 1024, 2048, and 3072.

**Caps** (409 `LIMIT_REACHED`): 50 boards per owner, 1–20 columns and 1000 live cards per board, 500 comments and 50 attachments per card, 10 attachments per comment.

### 3.2 Authorization (`server/tasks/access.ts`)

```sql
-- readableBoard(b, :user)
b.deleted_at IS NULL AND (b.owner_id = :user OR b.visibility = 'all_users'
  OR (b.visibility = 'selected' AND EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = :user)))
-- OR-ed into readableDocument / readableDocumentSummary only
EXISTS (SELECT 1 FROM card_attachments ca JOIN cards c ON c.id = ca.card_id AND c.deleted_at IS NULL
  JOIN boards b ON b.id = c.board_id WHERE ca.document_id = d.id AND <readableBoard(b, $userId)>)
```

- **Path ids.** Every id is joined to a readable board.
- **Moves.** A move stays on the same board, and `afterCardId` must be a live card in the target column. Otherwise the response is 409 `STALE_POSITION` with the current order.
- **Linking.** Needs a readable board and a live document the caller owns. If a comment is given, it must be the caller's own comment on that card.

### 3.3 API (`/api/tasks`, JSON)

| Endpoint | Who | Success | Errors |
| --- | --- | --- | --- |
| `GET /boards` / `POST /boards {name}` | any | 200 `{boards}` / 201 `{board, columns}` | 400, 409 |
| `GET /boards/:b` | reader | 200 `{board, columns, cards}` | 404 |
| `PATCH /boards/:b {name}`, `DELETE /boards/:b` (to the Bin) | owner | 200 | 403, 404 |
| `GET` or `PUT /boards/:b/sharing {visibility, userIds≤100}` | owner | 200 | 400, 403, 404 |
| `POST /boards/:b/columns`, `PATCH /columns/:c {name?, afterColumnId?}` | owner | 201 / 200 | 403, 404, 409 |
| `DELETE /columns/:c` | owner | 200 | 409 `COLUMN_NOT_EMPTY` or `LAST_COLUMN` |
| `POST /boards/:b/cards {columnId, title, description?, afterCardId?}` | reader | 201 | 400, 404, 409 |
| `GET /cards/:k` / `PATCH /cards/:k {title?, description?, revision}` | reader | 200 `{card, comments, attachments}` / 200 | 404, 409 `CARD_CHANGED` |
| `POST /cards/:k/move {columnId, afterCardId}` | reader | 200 `{card, renormalized?}` | 404, 409 `STALE_POSITION` |
| `DELETE /cards/:k` (to the Bin) | reader | 200 `{ok, purgeAfter}` | 404 |
| `POST /cards/:k/comments {body, attachmentIds?}` | reader | 201 | 400, 404, 409 |
| `PATCH`, `DELETE /comments/:m` | author (delete: also owner) | 200 | 403, 404 |
| `POST /cards/:k/attachments {documentId, commentId?}` | reader | 201, or 200 if already linked | 404, 409 |
| `DELETE /cards/:k/attachments/:d` (unlink) | linker or owner | 200 | 403, 404 |

- **Bin.** `bin.ts` gets per-type adapters. A card whose column was deleted restores to the first column. Restoring a card on a binned board returns 409 `BOARD_IN_BIN`.
- **Audit.** Each `task.{board,column,card,comment,attachment}_*` event records ids only.

### 3.4 UI (`src/tasks/`)

- **Routes.** `{app:"tasks", boardId, cardId}` covers `/tasks`, `/tasks/:boardId`, and `/tasks/:boardId/card/:cardId`. Home gets a Tasks card, and the Bin gets a Tasks filter.
- **Modules.**
  - `BoardView`, `CardDialog`, and `MoveCardSheet`.
  - `BoardSettings`: rename, columns, share, delete.
  - Pure `boardOrder.ts`.
  - `NoteEditor` gets an `uploadImage` prop.
- **Desktop.**
  - 280 px columns.
  - Drag and drop with `application/x-mynotes-card`. A 409 rolls back and shows a toast.
  - ⋯ → "Move to…", and Alt+Arrow for keyboard moves.
  - The owner reorders columns with ←/→.
- **Card dialog.**
  - The title saves on blur.
  - The description has an explicit Save. `CARD_CHANGED` offers Reload or Copy my text.
  - Comments load 50 at a time.
  - Pasted images become attachments.
- **Mobile (≤760 px).**
  - One column at a time, on an x-mandatory scroll-snap track synced to a sticky tab strip with counts. The column index is kept via `replaceState`.
  - The "Move to…" sheet lists the columns, plus Top and Bottom.
  - Targets are at least 44 px.
  - Back steps from card to board to list to Home.

### 3.5 Tests

- **Unit:** `boardOrder` and renormalizing, the routes, and XSS fixtures (`<script>`, `<img onerror>`, `javascript:`, and `data:` or external images are dropped).
- **API:**
  - Owner-only routes return 403 to a member and 404 to a stranger.
  - IDOR: board A ids are rejected through board B.
  - Moves: top, middle, bottom, cross-column, stale anchor, and renormalization.
  - CAS, caps, column-delete guards, and comment rules.
  - Attachments:
    - 404 as soon as the member is removed, the card is binned, or the comment is deleted
    - linking a document you don't own → 404
    - never listed in `/api/files`
  - Bin: listing for the owner and the deleter, `BOARD_IN_BIN`, cascade, and sweeper.
- **Manual:** drag and drop, 390 px layout, Back/Forward, two users.

### 3.6 Commits (L, 4–5 sessions; each stage runs on its own)

Stage A, boards:

1. `feat: add task boards migration 009`
2. `feat: add board, sharing, and column APIs`
3. `feat: add card APIs with server-computed ordering`
4. `feat: add Tasks routes, Home card, and board list`
5. `feat: add desktop board view with drag and drop`
6. `feat: add mobile board layout and Move sheet`

Stage B, comments:

7. `feat: add card comments API`
8. `feat: add card dialog with description and comments`

Stage C, attachments:

9. `feat: add card attachments with board-membership document access`
10. `feat: attach images and files in cards`

Stage D, Bin:

11. `feat: add cards and boards to the shared Bin`
12. `feat: show Tasks items in the Bin app`
13. `docs: document Task Boards`

Run `/security-review` after stages C and D.

## 4. Wave 8: MCP coverage

### 4.1 Migration `010_mcp_key_scopes`

```text
addColumn(mcp_api_keys, scopes, "TEXT NOT NULL DEFAULT '[\"notes:read\"]' CHECK (json_valid(scopes))")
addColumn(notes, draft_mcp_key_id, "TEXT REFERENCES mcp_api_keys(id) ON DELETE SET NULL")
```

- `draft_mcp_key_id` powers a "Draft by <key>" badge and is cleared on publish or discard.
- `authInfo` carries the key's scopes and `keyId`.
- The transport, key format, Host checks, and limits are unchanged.

### 4.2 Tools

Tools run the HTTP services as the key owner. Errors come back as `isError` with `{error, code}`, and not-found, forbidden, and binned look the same.

| Tool | Scope | Behaviour |
| --- | --- | --- |
| `list_notes`, `read_note` | notes:read | Unchanged |
| `search_notes` | notes:read | `{query, folderId?, limit≤20}`. Searches published text only; snippets are plain text. |
| `list_folders` | notes:read or files:read | `GET /api/folders` rules |
| `create_note` | notes:write-draft | `{markdown, folderId?}`. The folder must be owned (default: Default). Creates a draft-only note and returns `{noteId, revision, url}`. |
| `get_note_draft` | notes:write-draft | Owned note only. Returns `{revision, markdown, publishedVersion}`. |
| `update_note_draft` | notes:write-draft | `{noteId, markdown, baseRevision, mode: replace\|append}`. CAS on the revision, else `DRAFT_CHANGED`. Never creates a version. |
| `list_documents`, `get_document_metadata` | files:read | List predicate only (no attachment path) |
| `read_document_text` | files:read | Text files (`preview_kind='text'`) up to 1 MiB, strict UTF-8. Anything else returns `NOT_TEXT` or `TOO_LARGE`. |
| `list_boards`, `list_cards`, `get_card` | tasks:read | Attachments are returned as names only |
| `create_card`, `move_card`, `comment_on_card` | tasks:write | Use the W9 services |

**Per-key limits** (in memory): 120 calls and 30 writes per minute, plus 200 `create_note` calls and 500 task writes per day. Exceeding any limit returns `RATE_LIMITED`.

**Audit:** `mcp.note_create`, `mcp.note_draft_update`, and task events with `{via:"mcp", keyId}`. Reads are not logged.

### 4.3 Keys API and Settings

- **API.** `POST /api/mcp/keys` accepts `scopes`: 1–5 unique values, defaulting to `["notes:read"]`. A write scope adds its read scope. `GET` returns the scopes, and `mcp.key_created` records them in the audit log.
- **Settings.**
  - A "Permissions" checkbox group, with one line of help per scope. The line for "Write drafts" reads: "never publishes".
  - Checking a write scope also checks its read scope and locks it.
  - The key list shows each key's scopes as chips.

### 4.4 Tests

- **Scopes:** each tool is hidden from, and rejects, keys without its scope. After migration 010, existing keys have `notes:read`.
- **Draft writes:**
  - no version is created
  - shared and binned notes are reported as not found
  - CAS conflicts and append mode work
  - the search index is updated
  - the badge clears on publish
- **Documents:** `read_document_text` refuses PDFs, binaries, and files over 1 MiB.
- **Tasks:** W9 role matrix.
- **Keys:** rate limits, revoked key.

### 4.5 Commits (M, two sessions)

1. `feat: add MCP key scopes migration 010`
2. `feat: register MCP tools per scope; add search_notes and list_folders`
3. `feat: add draft-only MCP note writes`
4. `feat: add MCP document tools`
5. `feat: add MCP task tools`
6. `feat: choose key scopes in Settings`
7. `docs: document MCP scopes`

## 5. Threat rows (append to THREAT_MODEL.md; numbered T29–T44 because THREAT_MODEL.md already had a T28 when Wave 7 shipped)

| # | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| T29 | A snippet leaks an unreadable note or draft | ACL applied before `LIMIT`; parity test | Required |
| T30 | FTS injection or expensive queries | Quoted-term builder, caps, rate limit | Required |
| T31 | The index outlives an unshare, edit, or purge | Live ACL, same-transaction writes, cascade test | Required |
| T32 | Note text is duplicated in SQLite; bm25 statistics span all users | Same disk and backups; scores never returned | Accepted |
| T33 | MCP scope escalation | Per-scope registration, handler checks, immutable scopes | Required |
| T34 | MCP publishes or destroys content | Drafts on owned notes only, CAS, no destructive tools | Required |
| T35 | Prompt injection via stored content | **Out of scope for the server.** Clients must treat tool output as data. Mitigated by opt-in write scopes, a human publishing, and audit. | Accepted (documented) |
| T36 | A stolen key floods writes | Per-key limits, concurrency cap, bounded bodies, revocation | Required |
| T37 | Binary exfiltration | Text only, up to 1 MiB | Required |
| T38 | An MCP draft overwrites a human's autosave | Revision CAS | Required |
| T39 | IDOR across boards | Path ids joined to their board; same-board move targets | Required |
| T40 | An attachment stays reachable after a membership change | Live predicate, no copies, `no-store` | Required |
| T41 | Linking someone else's document | Only the owner can link | Required |
| T42 | XSS through card Markdown | D44 renderer, `src` allowlist, CSP, test fixtures | Required |
| T43 | Vandalism on an `all_users` board | Allowlist, audit, Bin restore, owner-only purge | Accepted |
| T44 | Resource exhaustion or comment spoofing | Caps, server-computed positions, session author | Required |

## 6. Out of scope

- **Search:** documents, cards, OCR, CJK, fuzzy matching, the query in the URL, in-editor highlights, and saved searches.
- **MCP:** publish, delete, share, and move tools, plus resources, prompts, and attachment upload.
- **Boards:**
  - Activity: history, realtime updates, and notifications.
  - Card fields: due dates, labels, and assignees.
  - Layout: WIP limits, swimlanes, templates, and column drag.
  - Scope: cross-board moves, card search, bulk actions, roles, and public boards.
  - Touch drag and cleanup of unused attachments.

## 7. Director review (2026-09-25)

Reviewed against DEVELOPMENT_PLAN.md rules, the threat model, and the current code. Verdict: adopt the plan with the changes below. Open decisions are marked **operator**.

**Accepted as proposed:** order 7 → 9 → 8; FTS5 with stored text and same-transaction index writes (D30–D35); drafts-only MCP writes with CAS and per-key scopes (D36–D37); member/owner split for boards (D38–D39); server-computed REAL positions (D40); Bin parity for cards and boards (D41); notes renderer for card Markdown (D44); all Required threat rows T29–T44.

**Changes required before implementation:**

1. **No system folder for attachments (revise D42, drop `folders.system_role`).** A hidden folder can be listed, shared, or deleted by its owner; sharing it would leak every attachment. Instead add `documents.purpose TEXT NOT NULL DEFAULT 'file' CHECK (purpose IN ('file','task_attachment'))` in migration 009, store attachments with `folder_id = NULL`, and exclude `purpose <> 'file'` from every Files list, folder count, and the Files Bin filter. Quota still counts them. The uploader sees attachments only on the card.
2. **Attachment lifecycle (extend D42/D43).** When a card or board is purged, or an attachment is unlinked and no other card links it, the document is moved to the Bin (owner = uploader, `deleted_by` = actor) so it clears in 30 days instead of accumulating against quota with no UI. Bin rows for such documents show "Attachment of <card title>" while the card exists.
3. **Search state on mobile (§2.5).** "Back returns to the results" needs a history entry; D18/D21 forbid entries for dialogs but this is a view. Keep the query in component state, push one `replaceState`-updated hint like the Files panel hint, and never put the query in the URL. Say so explicitly in the wave's commit 5.
4. **Contract updates in the same commits:** API_CONTRACTS.md gains `GET /api/search`, the `/api/tasks` table, `BinItem.type` extended with `card | board`, and the MCP `scopes` field on keys; THREAT_MODEL.md gains T29–T44; TEST_PLAN.md gains the rows in §2.6, §3.5, §4.4. Migration ids stay 008/009/010 in the chosen order.

**Operator decisions (defaults apply if not overridden):**

- **Order 7 → 9 → 8** — default: accept.
- **Note text duplicated into SQLite for search (T32)** — default: accept; it stays on the same disk and in the same backups.
- **Boards visible to `all_users` allow every allowlisted user to edit cards (D38/T43)** — default: accept, relying on the allowlist, audit, Bin restore, and owner-only purge.

**Effort and releases:** W7 medium (v0.5.0), W9 large in four runnable stages (v0.6.0, each stage may deploy as a patch release after review), W8 medium (v0.7.0). Every stage keeps the single-container, no-cloud stance.
