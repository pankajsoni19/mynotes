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
- **Connect trusted AI clients.** An authenticated Streamable HTTP MCP server lets tools search and read your published notes through revocable, one-time-visible API keys. Drafts and write operations stay out of reach.
- **Own portable data.** Content remains readable Markdown on disk; SQLite holds the metadata, identities, sessions, folders, sharing rules, and version index.
- **Protect sensitive knowledge.** Argon2id passwords, cookie and CSRF protections, optional or required Google Authenticator-compatible two-factor authentication, encrypted TOTP data, and a hardened non-root Docker container provide a practical local security baseline.
- **Run and recover simply.** One Docker Compose service runs on port `2026`, migrates its database on boot, and includes verified weekly gzip backups with five-week retention.

## Quick start

1. Copy `.env.example` to `.env` if you need to override the defaults.
2. Ensure `/srv/mynotes` exists and is writable by Docker, or set `MYNOTES_DATA_DIR` to another host directory.
3. Run `APP_VERSION=0.2.1 GIT_SHA=$(git rev-parse --short HEAD) docker compose up --build`.
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

The host does not need Bun when using Docker:

```sh
docker compose --profile dev up app-dev
```

The dev server is available at `http://localhost:2026` and mounts the source tree.

## Storage

The container reads and writes `/data`, mapped by Compose to:

```text
/srv/mynotes
├── mynotes.sqlite
└── notes/<note-id>/
    ├── current.md
    ├── draft.md
    └── versions/000001.md
```

Markdown files are never exposed as static files; authenticated API handlers enforce note access before reading them.

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

The backup intentionally does not include `.env`. Store `.env` securely alongside your backup process—especially `TOTP_ENCRYPTION_KEY`, which is required to use restored TOTP enrollments.
