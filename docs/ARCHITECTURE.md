# Architecture

## Runtime

One Bun process serves the built React SPA and the `/api` JSON API. SQLite uses WAL mode. All note content is read and written through a storage service that validates UUIDs, uses fixed derived paths, and performs atomic file replacement.

## Identity and authorization

Passwords use Bun's asynchronous Argon2id implementation. A random opaque session token is stored only as a SHA-256 hash in SQLite and sent in an `HttpOnly`, `SameSite=Strict` cookie. Mutations require a same-origin request, JSON content type, and an authenticated session.

Every note query checks one of:

1. caller owns the note;
2. note visibility is `all_users`; or
3. an ACL row grants the caller access.

Only owners may edit, publish, restore, move, delete, or change sharing. Shared users have read access in the initial release.

## Draft and version state machine

```text
published ── first edit ──> draft ── publish ──> published (new immutable version)
    ^                         │
    └──── discard draft ─────┘

historical version ── restore ──> draft (never rewrites history)
```

`current.md` mirrors the newest published version. `draft.md` exists only while a draft exists. Publishing uses a transaction-like sequence: write a temporary Markdown snapshot, atomically rename it, update `current.md`, then commit version metadata in SQLite. Recovery reconciles orphaned files without deleting history.

## API surface

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id`
- `GET/POST /api/notes`, `GET/PATCH/DELETE /api/notes/:id`
- `PUT/DELETE /api/notes/:id/draft`, `POST /api/notes/:id/publish`
- `GET /api/notes/:id/versions`, `GET /api/notes/:id/versions/:version`, `POST /api/notes/:id/versions/:version/restore`
- `GET/PUT /api/notes/:id/sharing`, `GET /api/users`

## UI

Desktop uses a collapsible folder rail, note list, and editor. Mobile turns navigation into a drawer and keeps the editor full-width. Tiptap provides an Outline-like block editor, Markdown serialization, keyboard shortcuts, a bubble toolbar, and `/` commands.

