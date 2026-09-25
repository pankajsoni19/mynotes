# MyNotes

A private, multi-user note-taking app built with Bun, React, TypeScript, Tailwind CSS, Tiptap, and SQLite. Notes are stored as portable Markdown files with immutable version history.

Documentation: [pankajsoni19.github.io/mynotes](https://pankajsoni19.github.io/mynotes/)

<p align="center">
  <img src="docs/images/dashboard-dark.png" alt="MyNotes dark dashboard with folder navigation, note list, and Markdown editor" width="1200" />
</p>

## Features

MyNotes is a private, self-hosted home for the notes you cannot afford to lose: everyday ideas, runbooks, credentials, and configuration. It combines a calm, dark writing space with ownership, version history, and access controls that stay on your machine.

- **Write without friction.** A responsive, macOS Notes-inspired workspace pairs folders and note cards with an Outline-like editor, slash commands, Markdown formatting, checklists, links, quotes, and code blocks.
- **Keep every meaningful change.** Edits begin as drafts, save automatically, publish as immutable versions, and can be compared or restored when you need to understand how a note evolved.
- **Share deliberately.** Notes start private. Share an individual note or a folder with trusted accounts or everyone signed in, with note-level permissions taking precedence.
- **Recover mistakes.** Deleted notes and files wait in a shared Bin for 30 days, with their history and sharing intact, before they are removed for good.
- **Connect trusted AI clients.** An authenticated Streamable HTTP MCP server lets tools search and read your published notes through revocable, one-time-visible API keys. Drafts and write operations stay out of reach.
- **Own portable data.** Content remains readable Markdown on disk; SQLite holds the metadata, identities, sessions, folders, sharing rules, and version index.
- **Protect sensitive knowledge.** Argon2id passwords, cookie and CSRF protections, optional or required Google Authenticator-compatible two-factor authentication, encrypted TOTP data, and a hardened non-root Docker container provide a practical local security baseline.
- **Run and recover simply.** One Docker Compose service runs on port `2026`, migrates its database on boot, and includes verified weekly gzip backups with five-week retention.

## Quick start

1. Copy `.env.example` to `.env` if you need to override the defaults.
2. Ensure `/srv/mynotes` exists and is writable by Docker, or set `MYNOTES_DATA_DIR` to another host directory.
3. Run `APP_VERSION=0.3.1 GIT_SHA=$(git rev-parse --short HEAD) docker compose up --build`.
4. Open `http://localhost:2026`.

The first account can always be created from the login screen while the database is empty. Later registrations are disabled by default. Temporarily set `ALLOW_REGISTRATION=true` only while adding trusted local users, then turn it off again. Set `ALLOWED_EMAILS` to a comma-separated allowlist; when present, only those addresses may register, sign in, or keep an existing session. “Everyone here” sharing includes all current and future registered users on that allowlist.

### Two-factor authentication

Generate a server-side encryption key and keep it only in `.env`:

```sh
openssl rand -base64 32
```

Set the output as `TOTP_ENCRYPTION_KEY`. Set `TOTP_POLICY=optional` to let each user choose, or `TOTP_POLICY=required` to force enrollment before notes can be accessed. Click the clearly labelled Settings control in the left navigation, open **Security**, scan the locally generated QR code with Google Authenticator, and verify one six-digit code. The grouped setup key is entered only while adding MyNotes to an authenticator; copying it removes visual spaces. Sign-in uses the current six-digit authenticator number or one complete, one-time recovery code. TOTP secrets and the recoverable backup-code list are encrypted in SQLite with AES-256-GCM; changing or losing the encryption key makes existing authenticator enrollments unusable.

If a user loses their authenticator, the local machine administrator can reset that factor. This revokes every session and forces fresh enrollment on the next password sign-in:

```sh
docker compose exec app bun server/reset-totp.ts user@example.com
```

### MCP server

Open **Settings → MCP server** to create, review, or revoke API keys and copy a ready-to-paste Streamable HTTP client configuration. Each key is displayed in full only once; MyNotes stores its SHA-256 hash and a short identifying prefix, never the plaintext credential.

The MCP endpoint is `http://localhost:2026/mcp` for the default deployment. It currently provides `list_notes` and `read_note`, restricted to the latest published versions the key owner can already access through MyNotes sharing rules. Drafts and write operations are intentionally excluded. Treat API keys like passwords, use a separate key per client, and revoke keys you no longer need.

### LAN and Tailscale access

`APP_ORIGINS` is a comma-separated allowlist of exact browser origins. Keep localhost and add every trusted LAN or Tailscale HTTPS origin you use, including its port when non-standard:

```dotenv
APP_ORIGINS=http://localhost:2026,http://192.168.10.20:2026,https://your-device.your-tailnet.ts.net
```

Docker is published on port `2026` for LAN access. Prefer Tailscale Serve with HTTPS and keep `COOKIE_SECURE=true`. Direct plain-HTTP access such as `http://192.168.10.20:2026` requires `COOKIE_SECURE=false`; this is less safe for notes containing credentials, even on a trusted home network. Never use a wildcard origin.

## Development

Development runs on the host with Bun (Compose only defines the production `app` service):

```sh
bun install
DATA_DIR=./data APP_ORIGIN=http://localhost:5173 COOKIE_SECURE=false ALLOW_REGISTRATION=true bun run dev
bun run dev:client
```

`bun run dev` serves the API on port `2026` (stop the Docker container first, since it uses the same port) and restarts on changes. `bun run dev:client` starts Vite at `http://localhost:5173` and proxies `/api` to it. `./data` is ignored by Git. Run `bun run typecheck` and `bun test` before committing.

## Storage

The container reads and writes `/data`, mapped by Compose to:

```text
/srv/mynotes
├── mynotes.sqlite (+ -wal, -shm)
├── notes/<note-id>/
│   ├── current.md
│   ├── draft.md
│   └── versions/000001.md
├── documents/
│   ├── objects/<document-id>
│   └── .staging/<document-id>.part
└── backup/                        weekly archives (host backup script only)
```

Markdown files are never exposed as static files; authenticated API handlers enforce note access before reading them.

### Documents and upload limits

Uploaded documents are stored only under server-generated ids, next to the notes:

```text
/srv/mynotes/documents/
├── objects/<document-id>          file bytes, no extension
└── .staging/<document-id>.part    uploads in progress
```

File names live only in SQLite and are never used as paths. Uploads are streamed to `.staging` on the data volume (never to the container's small `/tmp`), and a sweeper removes abandoned staging files and orphaned objects at boot and hourly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_UPLOAD_BYTES` | `104857600` (100 MiB) | Largest single file, from 1 MiB to 2 GiB. Bun's request body cap is this (or 2.1 MB, whichever is larger) plus 1 MiB; JSON bodies stay limited to 2.1 MB. |
| `USER_STORAGE_QUOTA_BYTES` | `10737418240` (10 GiB) | Document bytes per user, including documents in the Bin. `0` means unlimited. |
| `MIN_FREE_DISK_BYTES` | `1073741824` (1 GiB) | Uploads are refused when they would leave less free space than this on the data volume. |

Only one MyNotes instance may use a data directory at a time: upload slots, per-document locks, and the sweeper live in the process.

## Bin

Deleting a note or a file moves it to the shared **Bin** (Home → Bin) for exactly **30 days**. The retention period is fixed and not configurable.

- **What is kept:** everything. A binned note keeps its draft, published versions, and files on disk; a binned file keeps its bytes. Sharing rows are kept too, so restoring an item gives its previous audience access again. While an item is in the Bin nobody can read it, including its owner outside the Bin and MCP clients.
- **Restore** puts an item back in its original folder, or in your Default folder if the original was deleted. The confirmation toast names the folder and says when the item is shared again (a Default folder shared with others widens its audience).
- **Blank notes** that were never published skip the Bin and are removed at once, so the Bin does not fill with empty drafts. Any note with content, published or not, goes to the Bin, including an unpublished note whose draft you discard.
- **Delete forever** and **Empty Bin** remove items permanently. After 30 days an hourly sweeper (which also runs at boot) deletes expired items for you, in batches of 100 per run. A purge first marks the item so it can never be read or restored again, then removes its files, then its database row; if the process stops half way, the next sweep finishes the job.
- Documents in the Bin still count towards `USER_STORAGE_QUOTA_BYTES` until they are deleted forever.

**Upgrading from 0.3.1 or earlier:** notes deleted before this version (which the old interface described as permanent) reappear in the Bin for 30 days after the upgrade, then are deleted automatically. Never-published notes deleted before the upgrade are removed on the first sweep. Empty the Bin, or delete those items forever, if you do not want to keep them for that window.

## Database migrations

Every image carries immutable numbered migrations under `server/migrations`. They run transactionally and are recorded in SQLite's `schema_migrations` table before the HTTP server accepts requests. Existing databases are upgraded automatically on container boot; new schema changes must be added as a new migration rather than editing an already released migration.

The data directory is forced to mode `0700`; SQLite, WAL/SHM, and Markdown files use `0600`. The service refuses symlinked note directories/files.

## Weekly backups

Run the host-side backup script once a week:

```sh
./scripts/backup.sh
```

It briefly stops a running app container so the SQLite database and Markdown files are captured at the same point in time, writes a verified gzip archive under `/srv/mynotes/backup` (or your configured data directory), keeps the newest five archives, and starts the app again. A second run within seven days is skipped; use `./scripts/backup.sh --force` only when you intentionally want an extra snapshot.

For unattended weekly execution, add this entry with `crontab -e` (Sunday at 03:00):

```cron
0 3 * * 0 cd /path/to/mynotes && ./scripts/backup.sh >> /srv/mynotes/backup/backup.log 2>&1
```

To restore, stop MyNotes, extract an archive into an empty data directory, point `MYNOTES_DATA_DIR` at that directory if it differs from the default, and run `docker compose up -d --build`:

```sh
mkdir -p /srv/mynotes-restored
tar -xzf /srv/mynotes/backup/mynotes-YYYYMMDDTHHMMSSZ.tar.gz \
  -C /srv/mynotes-restored
MYNOTES_DATA_DIR=/srv/mynotes-restored docker compose up -d --build
```

The archive contains the data directory contents at its root, so no path rearrangement is required.

Archives include `documents/objects` but not `documents/.staging`. With documents stored, archive size and the time the app is stopped grow with the stored files (gzip gains little on already-compressed media), and five archives multiply that disk use. Items in the Bin are included in backups like live ones, and a note or file you delete forever (or that expires from the Bin) can survive in older archives for up to about five weeks, until those archives rotate out.

The backup intentionally does not include `.env`. Store `.env` securely alongside your backup process—especially `TOTP_ENCRYPTION_KEY`, which is required to use restored TOTP enrollments.
