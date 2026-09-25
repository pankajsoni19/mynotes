# MyNotes implementation tracker

## Workspace apps roadmap (Home, Files, shared Bin)

Implementation plan: [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) · [API contracts](docs/plan/API_CONTRACTS.md) · [Threat model](docs/plan/THREAT_MODEL.md) · [Test plan](docs/plan/TEST_PLAN.md)

### Wave 1 — Mobile notes navigation (released v0.2.2, deployed at `0efb975`)

- [x] Mobile browser Back/Forward between folders, note list, and editor
- [x] Clean up empty new notes during mobile Back
- [x] Version bump and deploy (running container reports `APP_VERSION=0.2.2`, `GIT_SHA=0efb975`)

### Wave 2 — Authenticated Home app selector (released v0.2.3, deployed at `6bfe982`)

- [x] Home with separate Notes and Files apps plus shared Bin cards; placeholders for Files/Bin (`cb59b6a`)
- [x] Independent review of `cb59b6a` against the DEVELOPMENT_PLAN §4 checklist (2026-09-25)
  - [x] G2.1 (blocking gate) — **confirmed gap, fixed** in `7a8319d` and `963f9aa`. Before the fix, the brand button and mobile Back to Home did not publish a changed draft (only the 900 ms autosave ran, and its errors were invisible on Home) and left blank new notes behind. Leaving Notes now runs the shared `finalizeOpenNote` sequence also used by note/folder switches: remove a blank never-published note, otherwise save and publish the changed draft. The note stays selected and is reloaded after publishing (a deliberate deviation from `publish(false)`: without the reload, the stale draft revision made the next save or switch fail with 409). On failure, Notes stays open with a toast and the draft kept; on mobile, the Notes history entry is pushed back. The editor is read-only while leaving. Browser QA on isolated data passed on desktop and at 390 px.
  - [x] G2.2 (blocking gate) — **confirmed gap, fixed** in `611bf88`. Home and the Files/Bin placeholders now have an Account group (Settings, Sign out) that drives the single App-owned settings dialog, scrim, and toast. `TOTP_POLICY=required` users without a factor still bypass Home and get Settings forced open (verified against an isolated server).
  - [x] Popstate routing: history entries without an app-shell section now resolve to Notes. Back/Forward across Home ⇄ Notes (folders/list/editor) ⇄ Files/Bin works with no trap (verified at 390 px).
  - [x] Reload lands on Home; Notes still resumes its last folder and note — intended, no issue.
  - [x] Desktop pushes no history for app switches (D18) — confirmed, no issue.
  - [x] Accessibility: cards and account actions are buttons with accessible names and the global focus ring; mobile account actions are 40 px icon buttons with visually hidden labels; reduced motion is honored — no issue.
  - [x] "Coming next / Preview" copy accepted for v0.2.3.
  - [x] Tests added: `tests/noteFinalization.test.ts`, `tests/appShell.test.tsx`, legacy-entry cases in `tests/appShellNavigation.test.ts`.
  - Accepted low risks (not blocking): the settings scrim closes without the one-time MCP key confirmation (pre-existing in Notes, now also on Home); a Back/Forward pressed during an in-flight leave can leave history one entry out of step; clicking the brand button while a note switch is already running does nothing; Sign out from the Notes sidebar still cancels a pending autosave (pre-existing).
- [x] Fix confirmed findings (`7a8319d`, `611bf88`, `963f9aa`)
- [x] Second independent review of `cb59b6a..bd754d4` plus recovery QA (2026-09-25, fresh session)
  - [x] **Medium, fixed** in `921fe28`: Tiptap `setEditable` emits an update by default, so mounting or locking the editor reported normalised Markdown as a user change. Reproduced on an isolated instance: a note authored through the API with `* item` bullets gained a draft on open and an unwanted version on leaving for Home. Fixed with `emitUpdate=false`; re-verified (version 1 and no draft after open + leave; a typed edit still publishes version 2).
  - [x] **Medium/low, fixed** in `921fe28`: Publish, Discard, Delete, and the mobile actions menu are disabled while the leave finalization runs.
  - [x] Verified on isolated desktop QA: leaving Notes publishes a new note (v1), publishes an edit of a published note (v2), and removes a blank new note; Settings opens and closes from Home and the Files placeholder; Sign out is present on Home, Files, and Bin.
  - [x] Verified at 390 px: Home → Notes folders → list → editor, then Back unwinds editor → list → folders → Home (publishing the edit on the way, v3), Forward re-enters Notes, Back from Home leaves to the previous history entry; Files placeholder pushes one entry and Back returns Home. No loops.
  - Accepted low risks (not blocking, recorded by the reviewer): a failed reload after a successful publish shows a "could not save" toast; a lasting 409 blocks leaving Notes until reload (same as note switches); history can drift by one entry during a concurrent leave/restore.
  - Gates: `bun run typecheck`, `bun test` (25 pass), `git diff --check`, tracked-file secret/personal-data scan, `docker build --target verify`, `docker compose build` all pass at `921fe28`.
- [x] Released v0.2.3: bump `6bfe982`, pushed to `origin/main`, deployed with Docker Compose; container healthy on port 2026 and `/api/about` reports `0.2.3` / `6bfe9827ae29e3c6707f9c0c413d95f591baea0d` (2026-09-25)

### Wave 2b — URL routing for every app, view, and item (released v0.2.4, deployed at `4b8bf3e`)

Operator request (2026-09-25): every module, page, note, file, and view gets its own URL instead of everything living at `/`. Shipped before the Bin and Files UIs so they are built on real routes. See DEVELOPMENT_PLAN §4b.

- [x] Route table and client router (`src/router.ts`, `dbdf321`): `/` Home, `/notes`, `/notes/folder/:folderId`, `/notes/shared`, `/notes/:noteId`, `/files`, `/files/folder/:folderId`, `/files/:documentId`, `/bin`; unknown paths fall back to Home; ids are validated and lowercased (`521e39e`)
- [x] Desktop and mobile both push real history entries (`aa7f5d5`); the mobile panel hint and app section ride along as history state with a `mynotes.depth` counter (`f0a84a3`) so in-app Back never leaves the site from a first entry
- [x] Deep links resume the right note/folder, including shared notes under Shared (`8d07456`); missing ids fall back to `/notes` with a toast; login keeps the requested URL in memory only
- [x] Leaving a note by any route change runs `finalizeOpenNote`; failures keep the URL on the note; the editor is locked during every switch (`d5cfe58`) and a failed note load recovers to the list (`b6200cf`)
- [x] A failed first workspace load retries on the next route change (`81c548c`)
- [x] Server unchanged: production SPA fallback covers every route (verified `/notes/<uuid>` → 200 while logged out; `/api/*` still 401/404 JSON)
- [x] Tests: `tests/router.test.ts`, `tests/notesRoute.test.ts`, depth and startup-state helpers in `tests/appShellNavigation.test.ts` (39 tests)
- [x] Two independent reviews (fresh sessions). Fixed: first-load failure freezing Back/Forward, keystrokes lost during history-driven switches, shared deep links, uppercase ids, and a failed note load leaving the editor locked. Accepted low risks: Back pressed mid-switch truncates the Forward stack; pre-upgrade tabs' history entries read as Home; the login page ignores Back/Forward; only ids (not `/NOTES`) are case-normalised; overlapping retries after a two-factor change settle harmlessly.
- [x] Director QA on isolated data, desktop and 390 px: Home ⇄ Notes ⇄ folder ⇄ note with Back/Forward; reload on `/files/folder/:id` and `/bin`; unknown path → `/`; logged-out deep link → login → note; blank new note removed on Back with no dead target; edits published on click and history switches with the editor locked meanwhile.
- [x] Released v0.2.4: bump `4b8bf3e`, pushed to `origin/main`, deployed with Docker Compose; container healthy on port 2026, `/api/about` reports `0.2.4` / `4b8bf3e98421e3f6d4cbecc062352dc1cfad69f0`, `/notes/<id>` and `/bin` serve the SPA, `/api/*` unchanged (2026-09-25)

### Hotfix v0.2.5 — Clear way back to Home (released, deployed at `1f86d83`)

- [x] Operator feedback (2026-09-25): the MyNotes wordmark was the only way back from Notes and the Home header read "MyNotes". Added a labelled Home row to the Notes folder nav (desktop + mobile), a wordmark tooltip, per-app header labels (MyNotes eyebrow over Home/Notes/Files/Bin), and route-aware browser tab titles (`ce58a40`, cherry-picked as `9c76d32` onto the v0.2.4 line so the unreviewed Wave 3 backend stayed out of the deploy)
- [x] Released from branch `release/0.2.5` (`1f86d83`), merged back into main (`f9aa328`); container healthy, `/api/about` reports `0.2.5` / `1f86d83053cb48ca8494b5e89792ee40a131d582`

### Wave 3 — Secure documents backend (released with Wave 4 as v0.3.0)

Operator direction (2026-09-25): build backend and frontend together so each stage is visible. Wave 3 therefore also ships a **minimal Files slice** in the Files app (upload with progress, list, preview/download, routed through `/files` and `/files/folder/:id`). Rename, move, share, and delete UI wait for Wave 5 so nothing can be deleted before the Bin exists (D19).

- [ ] Bounded JSON and MCP request bodies independent of `Content-Length`
- [ ] Migration `006_documents` (documents, document_shares, bin columns, upload idempotency key)
- [ ] UUID-only private disk storage (`documents/objects`, `documents/.staging`) with confinement, locks, and sweeper
- [ ] Magic-byte MIME sniffing and safe preview allowlist
- [ ] Bounded streamed multipart uploads (busboy, per-file cap, quota, free-disk floor, concurrency, idempotency)
- [ ] List, metadata, rename, move, sharing (folder inheritance + document precedence), and soft-delete APIs
- [ ] Authenticated content responses with strict headers, single Range, If-Range, and HEAD
- [ ] Upload env vars, Compose pass-through, and backup staging exclusion
- [x] Wave tests (118 across 16 files), independent security review (no high/critical; three race tests, a teardown guard, and a contract row added in `cbf73f5`, `2397a78`, `3c9db1e`)
- [x] Container base image moved to Bun 1.4.2 (`4e040c3`): Bun 1.2.22 buffered an 800 MiB upload to 1.67 GB RSS. In-container check on the production image (2026-09-25): 600 MB upload at 150 MB/s, RSS baseline 64 MB → peak 89 MB, staging empty afterwards, `Range` 206 and the exact content headers confirmed.
- Accepted low findings: content responses omit HSTS/Permissions-Policy (contract-conformant); streamed 200/206 bodies are chunked without Content-Length (Bun); huge chunked non-file bodies get Bun's bare 413; upload slots are per user only; a few invisible characters beyond the plan's list survive name sanitising.

### Wave 3c — Note editor: inline images, tables, PDF export (operator request 2026-09-25, ships with v0.3.0 or the next release)

- [x] `/image` slash command plus paste and drop (`a4100cc`): uploads through `POST /api/files` into the note's folder and embeds `![alt](/api/files/<id>/content?disposition=inline)`; only PNG/JPEG/GIF/WebP, verified again against the server's sniffed kind; a mismatch deletes the upload and toasts. Limitation: image visibility follows the folder share, not the note override; removed images stay in Files.
- [x] `/table` with Tiptap table extensions pinned at 3.31.3 (`9c399e4`): 3×3 with header row, seven row/column/table actions in a floating toolbar, GFM pipe-table round trip (`tests/noteMarkdown.test.ts`), horizontal scroll on phones
- [x] "Download as PDF" in the editor toolbar and mobile actions menu via `@media print` rules and `window.print()` (`66c65c8`); the tab title carries the note title during printing and is restored after
- [x] Merged in `a98f427` (+ `b0ad1c3` duplicate-export fix). Director QA on the isolated instance: pasted PNG uploaded and embedded, saved in the draft Markdown; `/table` from the menu and from Enter, toolbar actions present, pipe table saved; PDF action calls print and restores the title.
- [ ] Independent review verdict, then release with v0.3.0

### Wave 4 — Shared 30-day Bin (v0.3.0)

- [ ] Migration `007_bin` with legacy soft-deleted note backfill
- [ ] Notes and documents move to Bin; blank unpublished notes purge immediately
- [ ] Idempotent, crash-safe restore/purge and hourly retention sweeper
- [ ] Bin API and Bin app (desktop + mobile), Home Bin card live, updated delete copy
- [ ] Wave tests, security review, pre-deploy backup, release v0.3.0

### Wave 3b — Minimal Files app (ships in v0.3.0)

- [x] Files API client with XHR upload progress, error mapping (413 limit, 507 quota/disk, 429, 409 key reuse), and a pure upload queue with concurrency 2, cancel, retry with the same key (`c8c2d8c`)
- [x] Files workspace on `/files`, `/files/shared`, `/files/folder/:id`, `/files/:id`: folder rail, list with type/size/time/owner/share badges, upload queue panel with progress bars and live summary, preview pane per §7.2 (image inline, PDF in a new tab, text via 1 MiB Range with truncation notice, audio/video, everything else download-only), details, Download link; phone panels folders → files → preview with history hint `mynotes.files-navigation` (`f4320fb`, `ff694b8`)
- [x] Director QA on the isolated instance (Bun 1.4.2 backend): five uploads via the app's file input (PNG, 1.2 MB text, PDF, random binary, HTML) all reached 100 % with correct sizes; previews matched each kind; HEAD on every inline URL returned the contract headers (HTML/binary forced to `application/octet-stream; attachment`, PDF with `frame-ancestors 'none'`, others with `sandbox`); deep link to `/files` survived login; 390 px panels and Back work
- Deferred to Wave 5: rename, move, share, delete with Undo, New folder, OS drag-and-drop, sort/filter, keyboard shortcuts, mobile upload bottom sheet

### Wave 5 — Files UI (v0.4.0)

- [ ] Files API client and upload queue with progress, cancel, and retry
- [ ] Desktop Files workspace: folders, list, preview/details, rename, download, move, share, delete with Undo
- [ ] Drag and drop upload from OS and drag-to-folder move
- [ ] Mobile panels, action sheet, Move sheet, and browser history
- [ ] Home Files card live; desktop/mobile manual QA and accessibility check; release v0.4.0

### Wave 6 — Documentation and final audit

- [ ] README, ARCHITECTURE, and site docs for Files/Bin, env vars, backup sizing; fix `app-dev` profile reference
- [ ] Final independent security audit across Waves 3–5

## Foundation

- [x] Initialize Git repository
- [x] Define architecture, disk layout, API, and security model
- [x] Scaffold Bun + React + TypeScript + Tailwind project
- [x] Pin dependency versions and commit lockfile

## Backend

- [x] SQLite schema with WAL, foreign keys, and indexes
- [x] Safe atomic Markdown storage primitives
- [x] Argon2id password and opaque cookie-session foundation
- [x] Authentication and registration API
- [x] Folder API
- [x] Notes, drafts, publish, version history, and restore API
- [x] Sharing with selected users and all authenticated users
- [x] Audit log and health endpoint
- [x] Authenticated read-only Streamable HTTP MCP server with revocable API keys
- [x] API tests for authorization, CSRF, sharing, concurrency, permissions, recovery, and symlink safety

## Frontend

- [x] Minimal login / registration landing page
- [x] Wide account settings dialog with responsive security navigation
- [x] Google Authenticator-compatible encrypted TOTP enrollment and login challenge
- [x] Encrypted, one-time TOTP recovery codes with secure reveal and regeneration
- [x] Clear distinction between setup keys, six-digit codes, and recovery codes
- [x] Responsive three-pane macOS Notes-inspired dashboard
- [x] Collapsible folder navigation and note list
- [x] Clear Settings control, Security/About navigation, version, and Git build metadata
- [x] Delete controls, six-way note sorting, and all-notes default/resume behavior
- [x] Outline-like Tiptap editor with bubble toolbar and `/` commands
- [x] Visible ordered/bullet markers, underlined links, and aligned checklist rows
- [x] Debounced draft autosave and explicit publish/discard controls
- [x] Auto-publish changed drafts when switching notes
- [x] Remove never-published blank notes when switching away
- [x] Hide publish controls when draft content matches the published version
- [x] Derive note titles from the first Markdown line
- [x] Default folder assignment and drag-to-folder organization
- [x] Folder sharing with note-level permission precedence
- [x] Version history, content view, diff, and restore
- [x] User picker and private/selected/all-users sharing controls
- [x] Loading, empty, error, and conflict states
- [x] Open Graph/Twitter landing metadata and reusable 1280×640 social preview image
- [x] Responsive MCP settings, API-key management, and copyable client configuration
- [x] Obvious collapsed-sidebar reopen control with keyboard/touch support
- [x] Mobile browser Back/Forward navigation between folders, note list, and editor

## Container and operations

- [x] Multi-stage non-root Dockerfile
- [x] Docker Compose bind mount configurable via `MYNOTES_DATA_DIR` (portable default: `/srv/mynotes`)
- [x] Health check and port `2026`
- [x] Production dependency/build verification
- [x] Deploy locally with Docker Compose
- [x] Weekly full-data gzip backup with five-snapshot retention and direct restore layout
- [x] Numbered transactional SQLite migrations that run automatically at server boot
- [x] Public GitHub Pages documentation with search, responsive navigation, and complete self-hosting reference

## Quality gates

- [x] Typecheck and production build
- [x] Desktop browser interaction QA
- [x] Mobile viewport responsiveness QA
- [x] Independent security audit A
- [x] Independent security audit B
- [x] Address all high/critical audit findings
- [x] Final smoke test against deployed service
- [x] Commit all completed milestones
