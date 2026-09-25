# Nook Claude Code handoff

Use this file as the entry point for continuing development in Claude Code. The detailed architecture, security invariants, API contracts, and acceptance tests are already tracked in:

- [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) — source of truth for sequencing and design decisions
- [`docs/plan/API_CONTRACTS.md`](docs/plan/API_CONTRACTS.md) — HTTP contracts
- [`docs/plan/THREAT_MODEL.md`](docs/plan/THREAT_MODEL.md) — required security controls and review checklist
- [`docs/plan/TEST_PLAN.md`](docs/plan/TEST_PLAN.md) — automated and manual verification
- [`TODO.md`](TODO.md) — progress tracker and release gates

Do not reconstruct the plan from chat history. Read these files and inspect the repository before changing code.

## Repository state at handoff

Branch: `main`

Remote/deployed baseline:

- `origin/main`: `0efb975` (`fix: clean up empty notes during mobile back`)
- Last confirmed deployed release: v0.2.2
- Service port: 2026
- The running service must be rechecked before assuming its state.

Local commits ahead of `origin/main`, oldest first:

1. `cb59b6a` — `feat: add authenticated workspace home`
2. `db7f90e` — `docs: add Files, Bin, and Home development plan`
3. `7a8319d` — `fix: finalize the open note when leaving Notes for Home`
4. `611bf88` — `fix: add Settings and Sign out to Home and app placeholders`
5. `963f9aa` — `fix: lock the editor while leaving Notes`
6. `bd754d4` — `docs: record Wave 2 review outcomes`

Wave 2 was interrupted during its final release pass. Those six commits have not been pushed or deployed.

The working tree also contains an uncommitted v0.2.3 metadata bump in exactly these files:

- `Dockerfile`
- `README.md`
- `compose.yaml`
- `package.json`
- `server/config.ts`
- `site/index.html`
- `src/App.tsx`

These changes only replace v0.2.2 with v0.2.3. They were created by the interrupted release reviewer. Do not discard them blindly. Review and commit them only after the Wave 2 release gate passes.

## First Claude Code session: recover and finish Wave 2

Start with a fresh session in this repository. Do not use a worktree for this recovery because the relevant commits and uncommitted metadata changes are already on `main`.

Suggested prompt:

```text
Read CLAUDE_HANDOFF.md, DEVELOPMENT_PLAN.md, TODO.md, and the three docs under docs/plan/. Recover and finish only the interrupted Wave 2 review/release. Inspect git status and all commits from cb59b6a through HEAD before editing. Preserve completed work and do not reset the working tree.

Independently review the Home/app-shell implementation and the fixes in 7a8319d, 611bf88, and 963f9aa. Confirm that leaving Notes for Home finalizes a nonblank changed draft, removes a blank new note, prevents concurrent editor changes while finalization is running, and reports failure without silently losing work. Confirm Settings and Sign out are available from Home and placeholder screens. Verify desktop and 390px mobile history behavior: Home -> Notes -> folders -> list -> editor, then Back in the reverse order without loops or trapping the user.

Run typecheck, all Bun tests, Docker verify/build, git diff checks, a tracked-files secret/personal-data scan, and isolated browser QA. Never modify real user notes, the ignored .env, or the data directory. If every Wave 2 gate passes, commit the existing seven-file v0.2.3 metadata bump as a separate release commit. Then push main and deploy Docker Compose with APP_VERSION=0.2.3 and the final full GIT_SHA. Verify container health and /api/about. Do not create a GitHub release. If a gate fails, fix and commit it before release; if it cannot be proven, stop before pushing.
```

Expected evidence before Wave 2 is considered complete:

- clean working tree;
- all tests, typecheck, and Docker verification pass;
- isolated desktop and mobile QA pass;
- tracked files contain no credentials, private allowlist emails, tokens, personal hostnames, or ignored `.env` content;
- `origin/main` points to the reviewed final commit;
- the container is healthy on port 2026;
- `/api/about` reports v0.2.3 and the deployed commit SHA;
- `TODO.md` records the release result.

## Remaining development waves

Run one implementation session and one independent review session per wave. Keep the repository single-writer: do not run two editing sessions against the same checkout at once. Each implementation session must commit but must not push or deploy. Only its independent reviewer may release it after all gates pass.

### Wave 3 — secure Files backend foundation

Implement the migrations, document metadata, bounded streamed multipart upload, private UUID-addressed disk storage, MIME detection, access-control helpers, authenticated download/preview endpoint, strict single-range support, safe headers, configuration, Docker changes, and backup exclusions described in the plan.

Important boundaries:

- never derive a disk path from a user filename;
- do not use `request.formData()` for file bytes;
- enforce the limit while streaming, including chunked requests;
- stage uploads on the persistent data volume, not `/tmp`;
- never trust the submitted extension or `Content-Type`;
- allow inline preview only for the reviewed safe MIME allowlist;
- HTML, SVG, scripts, archives, office files, and unknown types are download-only;
- every content response requires authenticated ACL evaluation and `no-store`/`nosniff` protections;
- folder sharing grants inherited read access; only owners mutate documents in this version.

Follow the schema and endpoint contracts in the linked plan. Add negative tests for traversal, symlinks, spoofed MIME, oversized/chunked uploads, unauthorized access, malformed and multiple ranges, and unsafe inline content.

### Wave 4 — shared Bin and 30-day retention

Implement soft deletion, owner-only Bin listing, restore, permanent deletion, and failure-safe scheduled purge for notes and documents.

Required behavior:

- normal deletion moves notes/documents to Bin for 30 days;
- a blank never-published note created accidentally remains immediate cleanup and does not clutter Bin;
- drafts and version files survive soft deletion;
- restore uses the original owned folder when it still exists, otherwise the user's Default folder;
- deleted content is never exposed through folder shares;
- purge runs at startup and daily, is idempotent, and handles partial filesystem/database failure safely;
- permanent deletion requires explicit confirmation in the later UI;
- backups include recoverable Bin content and exclude temporary uploads.

### Wave 5 — Files and Bin user interfaces

Replace the Files/Bin placeholders with responsive workspaces while preserving the Notes experience.

Files must support:

- upload with per-file progress and clear errors;
- folder navigation, All files, and shared-folder content;
- image, audio, video, and PDF preview where the backend permits it;
- safe download for every type;
- rename, delete, and move to another owned folder;
- desktop drag-to-folder using a document-specific drag type;
- an explicit Move action on mobile because touch drag-and-drop is unreliable;
- read-only preview/download for inherited shared-folder access.

Bin must show notes and documents together with remaining retention time, Restore, and separately confirmed permanent deletion.

Mobile browser Back/swipe must unwind preview/editor -> item list -> folders -> app Home before leaving the site. Do not introduce history traps.

### Wave 6 — final audits, documentation, and release

Use separate review sessions for:

- authorization and storage security;
- upload parser/resource exhaustion and content-delivery headers;
- Bin retention/recovery correctness;
- responsive desktop/mobile UX and browser history;
- migration from the current database and backup/restore rehearsal.

Resolve every high/critical finding and document accepted lower-risk items. Update README, the GitHub Pages docs, screenshots if the UI materially changed, environment-variable reference, backup/restore instructions, version metadata, and TODO. Run the complete automated and manual matrix before push/deploy and create a release only after the deployed SHA is verified.

## Operating rules for every session

- Preserve user changes and never use destructive git commands.
- Never read, print, copy, or commit secrets from `.env`, the SQLite database, user notes, uploaded files, or backup archives.
- Do not use production notes for QA. Use isolated temporary data/accounts and remove them afterward.
- Run pending migrations automatically at boot; every schema change must have a migration.
- Commit one cohesive change at a time with an explanatory message.
- Implementation workers do not push or deploy.
- Independent reviewers inspect the diff and rerun verification before release.
- Stop before release if security, migration, data-loss, or recovery behavior is unproven.
- Keep `DEVELOPMENT_PLAN.md` and `TODO.md` current as decisions and gates change.

