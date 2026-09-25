# Operating Nook

This guide is for whoever runs a Nook server: installation, configuration, storage, backups, and upgrades. For using the apps, see [USING.md](USING.md). The same material is published at [pankajsoni19.github.io/nook](https://pankajsoni19.github.io/nook/).

Internal identifiers keep the original `mynotes` prefix for compatibility with existing deployments: the `mynotes.sqlite` database, the `mynotes_session` cookie, the `mynotes` container name, the `MYNOTES_DATA_DIR` variable and its `/srv/mynotes` default, and the `mynotes-*.tar.gz` backup archives.

## Install

1. Clone the repository and copy `.env.example` to `.env` if you need to override the defaults.
2. Ensure `/srv/mynotes` exists and is writable by UID 1000, or set `MYNOTES_DATA_DIR` to another host directory.
3. Run `APP_VERSION=0.4.1 GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build`.
4. Open `http://localhost:2026` and create the first account.

### Accounts

The first account can always be created from the login screen while the database is empty. Later registrations are disabled by default. Temporarily set `ALLOW_REGISTRATION=true` only while adding trusted local users, then turn it off again. Set `ALLOWED_EMAILS` to a comma-separated allowlist; when present, only those addresses may register, sign in, or keep an existing session. "Everyone here" sharing includes all current and future registered users on that allowlist.

### Two-factor authentication

Generate a server-side encryption key and keep it only in `.env`:

```sh
openssl rand -base64 32
```

Set the output as `TOTP_ENCRYPTION_KEY`. Set `TOTP_POLICY=optional` to let each user choose, or `TOTP_POLICY=required` to force enrollment before notes can be accessed. Users enroll under **Settings → Security** by scanning the locally generated QR code with Google Authenticator and verifying one six-digit code. Sign-in uses the current six-digit number or one complete, one-time recovery code. TOTP secrets and recovery codes are encrypted in SQLite with AES-256-GCM; changing or losing the encryption key makes existing enrollments unusable.

If a user loses their authenticator, the local machine administrator can reset that factor. This revokes every session and forces fresh enrollment on the next password sign-in:

```sh
docker compose exec app bun server/reset-totp.ts user@example.com
```

### LAN and Tailscale access

`APP_ORIGINS` is a comma-separated allowlist of exact browser origins. Keep localhost and add every trusted LAN or Tailscale HTTPS origin you use, including its port when non-standard:

```dotenv
APP_ORIGINS=http://localhost:2026,http://192.168.10.20:2026,https://your-device.your-tailnet.ts.net
```

Docker publishes port `2026` on all host interfaces for LAN access. Prefer Tailscale Serve or a TLS reverse proxy and keep `COOKIE_SECURE=true`. Direct plain-HTTP access such as `http://192.168.10.20:2026` requires `COOKIE_SECURE=false`; this is less safe for notes containing credentials, even on a trusted home network. Never use a wildcard origin.

## Configuration

Compose passes these variables from `.env` (see `.env.example`). Invalid values stop the server at startup with a message naming the variable.

| Variable | Default | Purpose and validation |
| --- | --- | --- |
| `MYNOTES_DATA_DIR` | `/srv/mynotes` | Host directory Compose mounts at `/data`. Must be writable by UID 1000. Used by Compose and `scripts/backup.sh`, not by the server. |
| `PORT` | `2026` | Port the server listens on inside the container. |
| `DATA_DIR` | `/data` | Data root inside the container. Leave unchanged under Compose. |
| `APP_ORIGIN` | `http://localhost:2026` | Primary browser origin; the fallback for `APP_ORIGINS`. |
| `APP_ORIGINS` | `APP_ORIGIN` | Comma-separated exact `http(s)` origins accepted for sign-in, mutations, and MCP host checks. Entries with a path, credentials, query, or fragment are rejected. |
| `COOKIE_SECURE` | `true` (Compose and production) | `true` or `false`. Plain-HTTP access needs `false`. |
| `ALLOW_REGISTRATION` | `false` | `true` allows additional accounts; the first account is always allowed on an empty database. |
| `ALLOWED_EMAILS` | empty | Comma-separated allowlist for registration, sign-in, and existing sessions. Empty allows any address. |
| `TOTP_POLICY` | `optional` | `optional` or `required`. |
| `TOTP_ENCRYPTION_KEY` | empty | Base64-encoded 32-byte key. Required when `TOTP_POLICY=required`. |
| `SESSION_DAYS` | `14` | Session lifetime in days, at least 1. |
| `MAX_MARKDOWN_BYTES` | `2000000` | Largest note body, at least 1024 bytes. |
| `MAX_UPLOAD_BYTES` | `104857600` (100 MiB) | Largest single file. Integer from `1048576` (1 MiB) to `2147483648` (2 GiB). Bun's request body cap is this (or 2.1 MB, whichever is larger) plus 1 MiB; JSON bodies stay limited to 2.1 MB. |
| `USER_STORAGE_QUOTA_BYTES` | `10737418240` (10 GiB) | Document bytes per user, including documents in the Bin. Integer ≥ 0; `0` means unlimited. |
| `MIN_FREE_DISK_BYTES` | `1073741824` (1 GiB) | Uploads are refused when they would leave less free space than this on the data volume. Integer ≥ 0. |
| `APP_VERSION` | `0.4.1` | Build metadata shown in Settings → About and reported by the MCP server. |
| `GIT_SHA` | `development` | Commit shown in Settings → About (first 40 characters). |

Fixed limits that are not configurable: 3 uploads in progress per user on the server (the app sends 2 at a time), 30-day Bin retention, 1 MiB text previews, 20 searches per 10 seconds per user, and an hourly sweeper.

## Storage

The container reads and writes `/data`, mapped by Compose to:

```text
/srv/mynotes
├── mynotes.sqlite (+ -wal, -shm)   metadata, accounts, sharing, version and search index
├── notes/<note-id>/
│   ├── current.md
│   ├── draft.md
│   └── versions/000001.md
├── documents/
│   ├── objects/<document-id>       uploaded file bytes, no extension
│   └── .staging/<document-id>.part uploads in progress (not backed up)
└── backup/                         weekly archives (host backup script only)
```

Markdown files and documents are never exposed as static files; authenticated API handlers enforce access before reading them. File names live only in SQLite and are never used as paths. Uploads are streamed to `.staging` on the data volume (never to the container's small `/tmp`), and a sweeper removes abandoned staging files and orphaned objects at boot and hourly. A refused upload reports which limit applied. Notes and files in the Bin stay in place on disk until they are deleted forever.

The data directory is forced to mode `0700`; SQLite, WAL/SHM, and Markdown files use `0600`. The service refuses symlinked note directories and files.

**Single instance.** Only one Nook instance may use a data directory at a time: upload slots, per-document locks, rate limits, and the sweeper live in the process. Do not run a second container or a development server against the same directory.

**EXIF and embedded metadata.** Nook stores uploaded files byte for byte and does not strip EXIF or other embedded metadata (for example GPS location or author) from images or PDFs. Tell users to remove it before uploading files they plan to share.

## Backup and restore

Run the host-side backup script once a week:

```sh
./scripts/backup.sh
```

It briefly stops a running app container so the SQLite database, Markdown files, and documents are captured at the same point in time, writes a verified gzip archive under `/srv/mynotes/backup` (or your configured data directory), keeps the newest five archives, and starts the app again. A second run within seven days is skipped; use `./scripts/backup.sh --force` only when you intentionally want an extra snapshot.

For unattended weekly execution, add this entry with `crontab -e` (Sunday at 03:00):

```cron
0 3 * * 0 cd /path/to/nook && ./scripts/backup.sh >> /srv/mynotes/backup/backup.log 2>&1
```

To restore, stop Nook, extract an archive into an empty data directory, point `MYNOTES_DATA_DIR` at that directory if it differs from the default, and start the service:

```sh
mkdir -p /srv/mynotes-restored
tar -xzf /srv/mynotes/backup/mynotes-YYYYMMDDTHHMMSSZ.tar.gz \
  -C /srv/mynotes-restored
MYNOTES_DATA_DIR=/srv/mynotes-restored docker compose up -d --build
```

The archive contains the data directory contents at its root, so no path rearrangement is required. Keep the same `.env` (in particular `TOTP_ENCRYPTION_KEY`) when starting the restored copy, and start only one instance per data directory.

- Archives include `documents/objects` but not `documents/.staging`. Archive size and the time the app is stopped grow with the stored files (gzip gains little on already-compressed media), and five archives multiply that disk use.
- Items in the Bin are included like live ones. A note or file deleted forever (or expired from the Bin) can survive in older archives for up to about five weeks, until those archives rotate out.
- The backup intentionally does not include `.env`. Store it securely alongside your backups, especially `TOTP_ENCRYPTION_KEY`, which is required to use restored TOTP enrollments.

## Upgrades

```sh
./scripts/backup.sh --force
git pull --ff-only
APP_VERSION=<release> GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
docker compose ps
curl http://localhost:2026/api/health
```

Every image carries immutable numbered migrations under `server/migrations`. They run transactionally and are recorded in SQLite's `schema_migrations` table before the HTTP server accepts requests. New schema changes are always added as a new migration; released migrations are never edited.

**Upgrading to 0.5.0:** migration 008 adds the search index tables, and the first boot fills them from the notes on disk before the server accepts requests, logging only counts (`Search index: N indexed, …`). Later boots only repair rows that are missing or stale. The index stores a plain-text copy of each note's published version and draft inside `mynotes.sqlite`, so it lives on the same disk and in the same backups as the notes themselves.

**Upgrading from 0.3.0 or earlier:** notes deleted before this version (which the old interface described as permanent) reappear in the Bin for 30 days after the upgrade, then are deleted automatically. Never-published notes deleted before the upgrade are removed on the first sweep. Empty the Bin, or delete those items forever, if you do not want to keep them for that window.

## Development

Development runs on the host with Bun (Compose only defines the production `app` service):

```sh
bun install
DATA_DIR=./data APP_ORIGIN=http://localhost:5173 COOKIE_SECURE=false ALLOW_REGISTRATION=true bun run dev
bun run dev:client
```

`bun run dev` serves the API on port `2026` (stop the Docker container first, since it uses the same port) and restarts on changes. `bun run dev:client` starts Vite at `http://localhost:5173` and proxies `/api` to it. `./data` is ignored by Git. Run `bun run typecheck` and `bun test` before committing.
