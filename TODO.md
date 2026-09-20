# MyNotes implementation tracker

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
- [x] API tests for authorization, CSRF, sharing, concurrency, permissions, recovery, and symlink safety

## Frontend

- [x] Minimal login / registration landing page
- [x] Responsive three-pane macOS Notes-inspired dashboard
- [x] Collapsible folder navigation and note list
- [x] Outline-like Tiptap editor with bubble toolbar and `/` commands
- [x] Debounced draft autosave and explicit publish/discard controls
- [x] Version history, content view, diff, and restore
- [x] User picker and private/selected/all-users sharing controls
- [x] Loading, empty, error, and conflict states

## Container and operations

- [x] Multi-stage non-root Dockerfile
- [x] Docker Compose bind mount to `/home/soni/Desktop/MacSSD/mynotes`
- [x] Health check and port `2026`
- [x] Production dependency/build verification
- [x] Deploy locally with Docker Compose

## Quality gates

- [x] Typecheck and production build
- [x] Desktop browser interaction QA
- [x] Mobile viewport responsiveness QA
- [x] Independent security audit A
- [x] Independent security audit B
- [x] Address all high/critical audit findings
- [x] Final smoke test against deployed service
- [x] Commit all completed milestones
