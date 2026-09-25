# Nook

Nook is a private, self-hosted workspace for a household or a small trusted team. It runs as one Docker container on your own machine and brings notes, files, and search together behind one sign-in. Notes are stored as portable Markdown files with immutable version history, uploaded files sit next to them in the same folders, and everything stays private unless you deliberately share it. It is built with Bun, React, TypeScript, Tailwind CSS, Tiptap, and SQLite.

Documentation: [pankajsoni19.github.io/nook](https://pankajsoni19.github.io/nook/)

<p align="center">
  <img src="docs/images/dashboard-dark.png" alt="Nook dark workspace with folder navigation, note list, and Markdown editor" width="1200" />
</p>

## Apps

After sign-in, **Home** opens the apps. Every app, folder, note, and file has its own URL.

| App | What it does |
| --- | --- |
| **Notes** | Markdown notes in folders with slash commands, checklists, code, images, tables, and PDF export. Drafts save automatically; published versions can be compared and restored. Share a note or folder with chosen accounts. |
| **Files** | Upload, preview, download, rename, move, and share documents in the same folders as your notes, in list or thumbnail grid view. Types are detected from the file's bytes and only safe types preview inline. |
| **Bin** | Deleted notes and files wait 30 days with their history and sharing, then are removed for good. Restore or delete forever at any time. |
| **Search** | Full-text search across note titles and bodies, accent- and case-insensitive, with prefix and phrase matching. Results respect sharing exactly. |
| **MCP server** | An authenticated Streamable HTTP endpoint that lets trusted AI clients list and read your published notes with revocable API keys. Read-only today. |

Planned: **Task Boards** (shared boards with draggable cards), **Collections**, and **Calendar** with reminders. See [TODO.md](TODO.md) for status.

## Quick start

You need Git, Docker Engine, and Docker Compose.

1. Clone the repository: `git clone https://github.com/pankajsoni19/nook.git && cd nook`.
2. Copy `.env.example` to `.env` and adjust it if needed (for example `ALLOWED_EMAILS`, `TOTP_POLICY`, `APP_ORIGINS`).
3. Create `/srv/mynotes` writable by UID 1000, or set `MYNOTES_DATA_DIR` to another host directory.
4. Build and start: `APP_VERSION=0.4.1 GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build`.
5. Open `http://localhost:2026` and create the first account; later registrations stay disabled unless you enable them.

Internal identifiers such as the `mynotes.sqlite` database, the `mynotes_session` cookie, the `mynotes` container, `MYNOTES_DATA_DIR`, and the `mynotes-*` backup archives keep the original `mynotes` prefix for compatibility with existing installs.

## Security posture

- Argon2id passwords, opaque HttpOnly SameSite session cookies, CSRF tokens, a strict Content Security Policy, and an exact browser-origin allowlist.
- Optional or required Google Authenticator-compatible two-factor authentication, with secrets and recovery codes encrypted by AES-256-GCM.
- Private by default: every note and file read is authorised by the server, and search, previews, and MCP see only what the user may open.
- Uploaded files are typed from their bytes; unsafe types (including SVG and HTML) are download-only.
- A hardened container: non-root user, read-only root filesystem, dropped capabilities, `no-new-privileges`.
- Verified weekly gzip backups with five-archive retention via `scripts/backup.sh`.
- Designed for a single host on a trusted network; prefer HTTPS through Tailscale Serve or a reverse proxy.

## Documentation

- [Documentation site](https://pankajsoni19.github.io/nook/): the full guide to every app, configuration, storage, backups, and upgrades.
- [docs/USING.md](docs/USING.md): Home and URLs, the Notes editor, search syntax, Files, the Bin, and MCP keys.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): configuration reference, storage layout, backup and restore, upgrades, and development setup.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the server, storage, and client fit together.
- [docs/plan/](docs/plan/) and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md): development plan, API contracts, threat model, and test plan.
- [TODO.md](TODO.md): the implementation tracker and backlog.

Built by [Pankaj Soni](https://github.com/pankajsoni19).
