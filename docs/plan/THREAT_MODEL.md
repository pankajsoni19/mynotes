# Threat model: Files and Bin

Companion to [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md). Reviewers in Waves 3–6 verify every mitigation marked **Required**.

## Context

MyNotes is self-hosted. One Bun container serves a small set of trusted accounts, and optionally restricts them with an email allowlist. It is reached over localhost, a LAN, or a Tailscale HTTPS origin. Users trust each other enough to share, but a shared recipient must never gain write access, and must never see anything that was not shared with them.

## Assets

1. Document bytes and metadata: names, sizes, and folder placement.
2. Notes, including items in the Bin, and their version history.
3. Sharing state: who can read what.
4. Sessions, CSRF tokens, and TOTP secrets. These are existing assets and must not be weakened.
5. Service availability and host disk space. The data volume also holds the SQLite DB and backups.
6. Backups on the host.

## Actors

- **Owner:** an authenticated user acting on their own items.
- **Recipient:** an authenticated user with read access through a folder, document, or note share.
- **Other authenticated user:** has an account but no share.
- **Unauthenticated network attacker:** on the LAN, the tailnet, or through a malicious web page the user visits (cross-site requests).
- **Malicious file content:** a crafted upload intended to exploit browsers or other users. A trusted account may be compromised or may upload something malicious by mistake.
- **Crash or operator error:** power loss mid-upload or mid-purge, disk full, or a restore from backup.

## Trust boundaries

1. Browser ⇄ HTTP API: cookies, the Origin check, and the CSRF header.
2. API ⇄ filesystem under the bind-mounted `/data`.
3. User-supplied bytes and names ⇄ browser rendering: preview and download.
4. The owner's ACL ⇄ recipients: folder or document shares.
5. Live state ⇄ Bin ⇄ purged.

## Threats and mitigations

| # | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| T1 | **Stored XSS** through an uploaded HTML, SVG, XML, or JS file opened on the app origin | Allowlist-only inline rendering (plan §7). Every other type is served as `application/octet-stream` with `attachment`. Route CSP `default-src 'none'; sandbox`. `nosniff`. Text is rendered only as React text nodes. | Required |
| T2 | **Content-type confusion or polyglots.** For example, a file that sniffs as PNG but contains HTML, or a misleading extension | Classification comes from server magic bytes, never from client MIME. Inline responses use the canonical sniffed type with `nosniff`, so the browser won't reinterpret it. The sandbox CSP neutralizes the document context. The extension alone never enables a preview, except text, which needs both a UTF-8 check and a no-NUL check. | Required |
| T3 | **Path traversal or overwrite** through the filename | Names never reach the filesystem. Paths are `documents/objects/<server UUID>`. UUID regex plus `withinDataRoot`. | Required |
| T4 | **Symlink or hardlink substitution** inside `/data` | `lstat`, `realpath` confinement, and `O_NOFOLLOW` on open. `fstat` size check. Staging is created with `O_EXCL`. Directories are `0700` and files `0600`. | Required |
| T5 | **IDOR:** reading, renaming, moving, deleting, or restoring another user's document or Bin item | Every query is scoped with `readableDocument` or `ownedDocument` (owner_id). Bin endpoints are owner-scoped. 404 for everything missing or forbidden. The parity test matrix covers notes and documents. | Required |
| T6 | **ACL widening by a non-owner.** Uploading or moving into someone else's shared folder | Upload and move targets must be folders **owned by the caller**, checked server-side. | Required |
| T7 | **Unintended exposure** when an owner moves an inheriting document into a shared folder, or a restore falls back to a shared Default folder | Accepted risk, for parity with notes. The UI shows the new effective visibility after every move and restore. The share icon appears on rows. | Accepted |
| T8 | **CSRF on upload.** A multipart form POST is a "simple" request that needs no preflight | The SameSite=Strict session cookie, the exact `Origin` allowlist, and a required `X-CSRF-Token` header (which a cross-site form cannot set). The multipart exception applies only to the exact path `POST /api/files`. | Required |
| T9 | **Cross-site reading or embedding** of content: `<img>`/`<video>` hotlinking, framing, XS-leaks | SameSite=Strict means cross-site subresource requests carry no cookie and get 401. `Cross-Origin-Resource-Policy: same-origin`. `frame-ancestors 'none'` and `X-Frame-Options: DENY`. PDF opens only as a top-level tab. | Required |
| T10 | **Memory exhaustion** from large bodies, including chunked JSON once Bun's global body limit is raised | Uploads are streamed with busboy limits. Bounded JSON and MCP body readers enforce 2.1 MB regardless of `Content-Length`. Bun's `maxRequestBodySize` = `max(MAX_UPLOAD_BYTES, 2_100_000)` + 1 MiB. The RSS check is verified. | Required |
| T11 | **Disk exhaustion** from many or large uploads, or abandoned staging files | Per-file cap, per-user quota (binned bytes count), 3 concurrent uploads per user, a `statfs` free-space floor, staging on `/data` (not the 64 MB `/tmp`), and a sweeper for stale staging files and orphaned objects. | Required |
| T12 | **Slow or never-finishing uploads** holding slots | Bun's socket idle timeout, and slots released in `finally` on abort or error. The sweeper removes stale `.part` files. | Required |
| T13 | **Range abuse:** many or overlapping ranges, amplification | Single range only. Multi-range falls back to a full 200. Invalid ranges are ignored. The response length is always bounded by the file size. | Required |
| T14 | **Header injection or response splitting** through the filename in `Content-Disposition` | ASCII fallback strips CR, LF, quotes, backslashes, and controls. `filename*` is percent-encoded UTF-8. Unit tests cover hostile names. | Required |
| T15 | **Bidi or invisible-character spoofing** in names, for example `invoice‮fdp.exe` | NFC normalization. Bidi and zero-width characters are stripped on upload and rename. The UI shows the full name in `title`. | Required |
| T16 | **Malware** shared between users | Out of scope for scanning. Non-allowlisted files are download-only. The browser applies its own download protections. The audit trail records uploads. | Accepted |
| T17 | **Data remains after purge.** For example, a crash mid-purge makes content readable or restorable | A tombstone (`purge_started_at`) makes the item unreadable and unrestorable before bytes are removed. Idempotent retries. The sweeper resumes. | Required |
| T18 | **Purged data survives in backups** | Documented: up to five weekly archives, about five weeks. Operators control backup retention. | Accepted (documented) |
| T19 | **Restore reintroduces stale access** because shares were retained | By design (D11). The restore confirmation copy mentions that sharing is restored. The owner can change sharing afterwards. | Accepted |
| T20 | **Bin items leak through other paths** (MCP, list endpoints, folder views) | Every read predicate requires `deleted_at IS NULL`. Tests cover list, read, content, versions, sharing, and MCP for binned items. | Required |
| T21 | **Information disclosure through logs or audit** | Logs record the error class and ids only. Audit metadata excludes filenames and content. | Required |
| T22 | **Cache leakage** on shared devices or proxies | `Cache-Control: private, no-store` on content. `no-store` on all of `/api`. | Required |
| T23 | **EXIF or embedded metadata** (GPS, author) in shared images or PDFs | Out of scope, because there is no server-side processing. Document it in the README so users can strip metadata before sharing. | Accepted (documented) |
| T24 | **Browser DoS** from decompression-bomb images or huge text previews | Text preview is capped at 1 MiB through Range. Images are rendered by the browser and contained in the preview pane. There is no server decode. | Accepted |
| T25 | **Idempotency-key misuse** to learn about another user's uploads | Keys are scoped per `owner_id`. A replay returns only the caller's own document. | Required |
| T26 | **Race conditions:** concurrent restore and purge, rename during delete, quota bypass with parallel uploads | Per-resource locks, compare-and-swap updates, a quota re-check inside the insert transaction, and in-memory reservations. | Required |
| T27 | **Existing protections regressed** (TOTP gate, CSP on the SPA, JSON-only mutations) | The middleware exception is path-exact, and tests prove multipart is rejected elsewhere. The global CSP on the SPA is unchanged. The TOTP gate covers the new routes (test). | Required |
| T28 | **Note images shown to the wrong audience.** Images embedded in a note are documents in the note's folder, so they follow the folder's sharing, not the note's override | No widening: a reader who can see the note but not the folder gets a broken image, never the bytes. Image sources other than this app's `/api/files/<id>/content` URLs are dropped when a note loads. Documented in the README. A proper fix belongs to a later note-attachments design. | Accepted (documented) |

## Notes on shipped behaviour (v0.3.0–v0.4.0)

Deliberate deviations and accepted low findings from the Wave 3–5 reviews. The mitigations above still hold.

- **T10:** a huge chunked body sent to a non-upload route is stopped by Bun's `maxRequestBodySize` with a bare 413 rather than the JSON error. Streamed content bodies are sent chunked without `Content-Length`.
- **T11/T12:** the 3 upload slots are per user, not global; several users can upload at once. Uploads without `Content-Length` reserve `MAX_UPLOAD_BYTES` against the quota and free-disk checks while streaming. busboy runs with `parts: 2` and `fileSize: MAX_UPLOAD_BYTES + 1` so that reaching a limit is detected (see API_CONTRACTS).
- **T15:** a few invisible characters beyond the listed bidi and zero-width set survive name sanitising. Names are always shown in full in `title`.
- **T17:** a purge the sweeper finishes after an interruption is audited with reason `resumed`. Failing purges are bounded per run (50 resumed plus 100 due per table), so they cannot starve expired items.
- **T22:** content responses set their own headers and omit the global HSTS and Permissions-Policy.

## Residual risks the operator accepts

T7, T16, T18, T19, T23, T24. Record any new acceptance here with a rationale and a date.

- 2026-09-25: T28 (note images follow folder sharing). It fails closed (broken image, no disclosure), and fixing it needs a note-attachments model. T18 and T23 are documented in the README.

## Review checklist (Waves 3, 4, 6)

- [ ] Every row marked Required has a test or a documented manual verification.
- [ ] The exact CSP on content responses is verified by a test (the Hono `secureHeaders` ordering).
- [ ] The RSS measurement during a near-limit upload is recorded.
- [ ] Inline PDF works in Chromium and Firefox with the chosen CSP, or the relaxation is recorded.
- [ ] No filenames or contents appear in logs or audit rows (grep the test DB `audit_log` after the suite).
- [ ] `git diff` contains no secrets, personal hostnames, or allowlisted addresses.
