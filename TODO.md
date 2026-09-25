# MyNotes implementation tracker

## Workspace apps roadmap (Home, Files, shared Bin)

Implementation plan: [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) · [API contracts](docs/plan/API_CONTRACTS.md) · [Threat model](docs/plan/THREAT_MODEL.md) · [Test plan](docs/plan/TEST_PLAN.md)

### Wave 1 — Mobile notes navigation (released v0.2.2, deployed at `0efb975`)

- [x] Mobile browser Back/Forward between folders, note list, and editor
- [x] Clean up empty new notes during mobile Back
- [x] Version bump and deploy (running container reports `APP_VERSION=0.2.2`, `GIT_SHA=0efb975`)

### Wave 2 — Authenticated Home app selector (target v0.2.3)

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
- [ ] Bump to 0.2.3 in every version location, push and deploy, smoke test

### Wave 2b — URL routing for every app, view, and item (target v0.2.4)

Operator request (2026-09-25): every module, page, note, file, and view gets its own URL instead of everything living at `/`. Ships before the Bin and Files UIs so they are built on real routes. See DEVELOPMENT_PLAN §4b.

- [ ] Route table and client router (`src/router.ts`): `/` Home, `/notes`, `/notes/folder/:folderId`, `/notes/shared`, `/notes/:noteId`, `/files`, `/files/folder/:folderId`, `/files/:documentId`, `/bin`; unknown paths fall back to Home
- [ ] Desktop and mobile both push real history entries; the mobile-only `mynotes.mobile-navigation` and `mynotes.app-shell` state layers become a panel hint on top of the URL
- [ ] Deep links resume the right note/folder; inaccessible ids fall back gracefully; login preserves the requested URL
- [ ] Leaving a note by URL change still runs `finalizeOpenNote`; failures keep the URL on the note
- [ ] Server: SPA fallback already serves `dist/index.html` for every non-API path in production; confirm `/api/*` 404s are unchanged and Vite dev fallback works
- [ ] Tests: router parse/format round trips, history helper compatibility, and a manual desktop + 390 px matrix; release v0.2.4

### Wave 3 — Secure documents backend (released with Wave 4 as v0.3.0)

- [ ] Bounded JSON and MCP request bodies independent of `Content-Length`
- [ ] Migration `006_documents` (documents, document_shares, bin columns, upload idempotency key)
- [ ] UUID-only private disk storage (`documents/objects`, `documents/.staging`) with confinement, locks, and sweeper
- [ ] Magic-byte MIME sniffing and safe preview allowlist
- [ ] Bounded streamed multipart uploads (busboy, per-file cap, quota, free-disk floor, concurrency, idempotency)
- [ ] List, metadata, rename, move, sharing (folder inheritance + document precedence), and soft-delete APIs
- [ ] Authenticated content responses with strict headers, single Range, If-Range, and HEAD
- [ ] Upload env vars, Compose pass-through, and backup staging exclusion
- [ ] Wave tests, RSS streaming check, and independent security review

### Wave 4 — Shared 30-day Bin (v0.3.0)

- [ ] Migration `007_bin` with legacy soft-deleted note backfill
- [ ] Notes and documents move to Bin; blank unpublished notes purge immediately
- [ ] Idempotent, crash-safe restore/purge and hourly retention sweeper
- [ ] Bin API and Bin app (desktop + mobile), Home Bin card live, updated delete copy
- [ ] Wave tests, security review, pre-deploy backup, release v0.3.0

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
