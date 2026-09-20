# MyNotes implementation tracker

## Foundation

- [x] Initialize Git repository
- [x] Define architecture, disk layout, API, and security model
- [x] Scaffold Bun + React + TypeScript + Tailwind project
- [ ] Pin dependency versions and commit lockfile

## Backend

- [x] SQLite schema with WAL, foreign keys, and indexes
- [x] Safe atomic Markdown storage primitives
- [x] Argon2id password and opaque cookie-session foundation
- [ ] Authentication and registration API
- [ ] Folder API
- [ ] Notes, drafts, publish, version history, and restore API
- [ ] Sharing with selected users and all authenticated users
- [ ] Audit log and health endpoint
- [ ] API tests for authorization, CSRF, conflicts, and traversal

## Frontend

- [ ] Minimal login / registration landing page
- [ ] Responsive three-pane macOS Notes-inspired dashboard
- [ ] Collapsible folder navigation and note list
- [ ] Outline-like Tiptap editor with bubble toolbar and `/` commands
- [ ] Debounced draft autosave and explicit publish/discard controls
- [ ] Version history, content view, diff, and restore
- [ ] User picker and private/selected/all-users sharing controls
- [ ] Loading, empty, error, and conflict states

## Container and operations

- [ ] Multi-stage non-root Dockerfile
- [ ] Docker Compose bind mount to `/home/soni/Desktop/MacSSD/mynotes`
- [ ] Health check and port `2026`
- [ ] Production dependency/build verification
- [ ] Deploy locally with Docker Compose

## Quality gates

- [ ] Typecheck and production build
- [ ] Desktop browser interaction QA
- [ ] Mobile viewport responsiveness QA
- [ ] Independent security audit A
- [ ] Independent security audit B
- [ ] Address all high/critical audit findings
- [ ] Final smoke test against deployed service
- [ ] Commit all completed milestones

