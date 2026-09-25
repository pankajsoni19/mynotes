# MyNotes implementation tracker

## Workspace apps roadmap (Home, Files, shared Bin)

Implementation plan: [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) · [API contracts](docs/plan/API_CONTRACTS.md) · [Threat model](docs/plan/THREAT_MODEL.md) · [Test plan](docs/plan/TEST_PLAN.md)

### Wave 1 — Mobile notes navigation (released v0.2.2, deployed at `0efb975`)

- [x] Mobile browser Back/Forward between folders, note list, and editor
- [x] Clean up empty new notes during mobile Back
- [x] Version bump and deploy (running container reports `APP_VERSION=0.2.2`, `GIT_SHA=0efb975`)

### Wave 2 — Authenticated Home app selector (target v0.2.3)

- [x] Home with separate Notes and Files apps plus shared Bin cards; placeholders for Files/Bin (`cb59b6a`, local, not pushed)
- [ ] Independent review of `cb59b6a` against the DEVELOPMENT_PLAN §4 checklist (pending; items are review gates, not confirmed bugs)
  - [ ] G2.1 (blocking gate): draft finalization and blank-note cleanup when leaving Notes for Home — outcome: _not yet reviewed_
  - [ ] G2.2 (blocking gate): Settings and Sign out reachable from Home — outcome: _not yet reviewed_
- [ ] Fix confirmed findings (or record operator acceptance)
- [ ] Bump to 0.2.3 in every version location, run all gates, push and deploy with operator approval, smoke test

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
