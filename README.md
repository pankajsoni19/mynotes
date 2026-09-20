# MyNotes

A private, multi-user note-taking app built with Bun, React, TypeScript, Tailwind CSS, Tiptap, and SQLite. Notes are stored as portable Markdown files with immutable version history.

<p align="center">
  <img src="docs/images/dashboard-dark.png" alt="MyNotes dark dashboard with folder navigation, note list, and Markdown editor" width="1200" />
</p>

## Product shape

- Dark, responsive workspace inspired by macOS Notes: folders, note list, editor.
- Every user receives a protected Default folder; notes created outside a selected folder go there automatically.
- Private notes by default; share with selected users or every registered user.
- Optional or required Google Authenticator-compatible TOTP two-factor authentication.
- Draft-first editing, autosave, explicit version publishing, history, and restore.
- Markdown on disk; SQLite for identity, sessions, metadata, folders, sharing, and version indexes.
- Local Docker deployment on port `2026`.

## Quick start

1. Copy `.env.example` to `.env` if you need to override the defaults.
2. Ensure `/home/soni/Desktop/MacSSD/mynotes` exists and is writable by Docker.
3. Run `APP_VERSION=0.1.2 GIT_SHA=$(git rev-parse --short HEAD) docker compose up --build`.
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

## Database migrations

Every image carries immutable numbered migrations under `server/migrations`. They run transactionally and are recorded in SQLite's `schema_migrations` table before the HTTP server accepts requests. Existing databases are upgraded automatically on container boot; new schema changes must be added as a new migration rather than editing an already released migration.

The data directory is forced to mode `0700`; SQLite, WAL/SHM, and Markdown files use `0600`. The service refuses symlinked note directories/files.

## Weekly backups

Run the host-side backup script once a week:

```sh
./scripts/backup.sh
```

It briefly stops a running app container so the SQLite database and Markdown files are captured at the same point in time, writes a verified gzip archive under `/home/soni/Desktop/MacSSD/mynotes/backup`, keeps the newest five archives, and starts the app again. A second run within seven days is skipped; use `./scripts/backup.sh --force` only when you intentionally want an extra snapshot.

For unattended weekly execution, add this entry with `crontab -e` (Sunday at 03:00):

```cron
0 3 * * 0 cd /home/soni/Desktop/apps/mynotes && ./scripts/backup.sh >> /home/soni/Desktop/MacSSD/mynotes/backup/backup.log 2>&1
```

To restore, stop MyNotes, extract an archive into an empty data directory, point `MYNOTES_DATA_DIR` at that directory if it differs from the default, and run `docker compose up -d --build`:

```sh
mkdir -p /home/soni/Desktop/MacSSD/mynotes-restored
tar -xzf /home/soni/Desktop/MacSSD/mynotes/backup/mynotes-YYYYMMDDTHHMMSSZ.tar.gz \
  -C /home/soni/Desktop/MacSSD/mynotes-restored
MYNOTES_DATA_DIR=/home/soni/Desktop/MacSSD/mynotes-restored docker compose up -d --build
```

The archive contains the data directory contents at its root, so no path rearrangement is required.

The backup intentionally does not include `.env`. Store `.env` securely alongside your backup process—especially `TOTP_ENCRYPTION_KEY`, which is required to use restored TOTP enrollments.
