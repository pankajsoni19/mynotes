# MyNotes

A private, multi-user note-taking app built with Bun, React, TypeScript, Tailwind CSS, Tiptap, and SQLite. Notes are stored as portable Markdown files with immutable version history.

## Product shape

- Dark, responsive workspace inspired by macOS Notes: folders, note list, editor.
- Private notes by default; share with selected users or every registered user.
- Draft-first editing, autosave, explicit version publishing, history, and restore.
- Markdown on disk; SQLite for identity, sessions, metadata, folders, sharing, and version indexes.
- Local Docker deployment on port `2026`.

## Quick start

1. Copy `.env.example` to `.env` if you need to override the defaults.
2. Ensure `/home/soni/Desktop/MacSSD/mynotes` exists and is writable by Docker.
3. Run `docker compose up --build`.
4. Open `http://localhost:2026`.

The first account can always be created from the login screen while the database is empty. Later registrations are disabled by default. Temporarily set `ALLOW_REGISTRATION=true` only while adding trusted local users, then turn it off again. “Everyone here” sharing includes all current and future registered users.

## Development

The host does not need Bun when using Docker:

```sh
docker compose --profile dev up app-dev
```

The dev server is available at `http://localhost:2026` and mounts the source tree.

## Storage

The container reads and writes `/data`, mapped by Compose to:

```text
/home/soni/Desktop/MacSSD/mynotes
├── mynotes.sqlite
└── notes/<note-id>/
    ├── current.md
    ├── draft.md
    └── versions/000001.md
```

Markdown files are never exposed as static files; authenticated API handlers enforce note access before reading them.

The data directory is forced to mode `0700`; SQLite, WAL/SHM, and Markdown files use `0600`. The service refuses symlinked note directories/files.
