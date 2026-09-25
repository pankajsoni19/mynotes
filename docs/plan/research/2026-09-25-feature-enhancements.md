# MyNotes: candidate modules after Bin, Files UI, and docs

*Research date: 2026-09-25. Repo read-only. Sources are listed at the end.*

## 1. Where MyNotes stands

MyNotes' differentiators are **immutable versions with draft/publish**, **allowlisted sharing**, **strict security**, and a **built-in MCP endpoint**. Few self-hosted peers ship all four. Outline is closest, with a built-in `/mcp` using per-user permissions [1]; Obsidian and Memos rely on third-party MCP servers [2][3].

Biggest gap in the code: **search is title-only.** The UI filter (`src/App.tsx`, `visibleNotes`) and MCP `list_notes` (`server/mcp.ts`, `notesForUser`, capped at 200 rows) both use `title.includes()`. Every peer treats full-text search as table stakes, and title-only search makes MCP `read_note` guesswork.

## 2. What the market values (condensed)

| Pattern | Who | Relevance |
| --- | --- | --- |
| Full-text search, often with highlighting | Paperless-ngx [4], Karakeep [5], Memos [6] | Essential |
| Wikilinks, backlinks, graph | Obsidian [7], Logseq [8], Trilium [9], Standard Notes @mentions [10] | High |
| Inline and nested `#tags` | Bear, Apple Notes [11], Memos [6], SilverBullet [12] | High, cheap |
| Journal-first capture | Logseq [8], Memos timeline [6] | High |
| Tasks gathered from every page | SilverBullet [12] | High |
| MCP read **and write** | Outline (create/update/publish) [1], Notion (Markdown pages) [13], Obsidian servers (frontmatter/tags) [2] | Very high, a growing expectation |
| Clipping / read-later | Joplin clipper [14], Wallabag [15], Karakeep (AI tags, archival, OCR) [5]; Omnivore shut down in 2024 [16] | Medium–high |
| Encrypted notes | Standard Notes E2EE [10], Trilium protected notes [9], Anytype [17] | Medium; fits "credentials" use |
| Install anywhere / PWA | SilverBullet PWA with offline support [12]; Memos users asking for share target [18] | Medium |
| Passkeys | About 5 billion in use; SimpleWebAuthn is the de facto JavaScript library [19] | Medium |

MCP security consensus: grant write tools only where needed; note content can carry prompt injection [20][21]. MyNotes' draft/publish model is a natural safety net: agents write drafts, humans publish.

## 3. Ranked proposal

Effort: **S** < one wave, **M** = one wave, **L** > one wave. "Stance" = effect on single-container/no-cloud.

### 1. Full-text search (SQLite FTS5) — S/M
- **What:** FTS5 index of published title and body; ranked results with snippets; MCP `search_notes`.
- **Value:** Find notes by content; lets AI clients answer questions without reading every note.
- **Builds on:** Publish updates the index in the same transaction; reuses the `notesForUser` ACL SQL; excludes Bin rows. Trigram tokenizer gives substring matching [22].
- **Risks:** Snippet leaks unless the ACL filter is in the query; migration-time rebuild.
- **Stance:** Unchanged; FTS5 is part of SQLite.

### 2. MCP write access, scoped keys, and assistant workflows — M
- **What:** Key scopes `read` / `read+draft`; `create_note`, `update_draft`, `append_to_note` write **drafts only** for a human to publish; plus `list_folders`, `get_versions`, `diff`, and MCP prompts ("summarize folder", "weekly review"). No built-in LLM.
- **Value:** Assistants file meeting notes, clip pages, keep logs, as Outline and Notion allow [1][13].
- **Builds on:** Drafts, versions, and diff/restore are the review and undo step; sharing rules apply; Bin covers any future delete.
- **Risks:** Prompt injection steering writes [20]. Owner-owned notes only, "written by key X" in history, rate limits, no delete/publish tools initially.
- **Stance:** Unchanged; cloud models already see content via the user's client on reads. Document it.

### 3. Tags (inline `#tag`, nested `#a/b`) and saved filters — S
- **What:** Parse tags from published Markdown into `note_tags`; tag rail, chips, MCP `list_tags` and filter.
- **Value:** Cross-cutting organization without duplicate folders (Bear-style).
- **Builds on:** Same index hook as search; Markdown stays the truth.
- **Risks:** Tags in code blocks; ACL-filter tag lists.
- **Stance:** Unchanged.

### 4. Wikilinks and backlinks (graph later) — M
- **What:** `[[Title]]` / `[[id|alias]]` with autocomplete; `note_links` table; Backlinks panel; MCP `get_backlinks`; optional graph later.
- **Value:** A connected knowledge base, the defining Obsidian/Logseq feature.
- **Builds on:** Wave 2b routes (`/notes/:id`), the index hook, published versions.
- **Risks:** Hide backlinks from unreadable notes; resolve by id across renames; graph scope creep.
- **Stance:** Unchanged.

### 5. Daily notes and templates — S
- **What:** "Today" opens `Journal/YYYY-MM-DD`; templates are notes in a `Templates` folder with `{{date}}`/`{{title}}`; `/template` command; MCP `append_to_daily`.
- **Value:** Placeless quick capture (Logseq/Memos) and repeatable runbooks.
- **Builds on:** Folders, slash commands, drafts, MCP write.
- **Risks:** Minimal; use the user's local date.
- **Stance:** Unchanged.

### 6. Task aggregation — M
- **What:** Index `- [ ]` items with optional `@due(YYYY-MM-DD)` and tags; Tasks view (Overdue/Today/Upcoming/No date); ticking edits and publishes the source note; MCP `list_open_tasks`.
- **Value:** One to-do list across all notes, as in SilverBullet [12].
- **Builds on:** Editor checklists, versions (each tick is traceable), index hook, daily notes.
- **Risks:** Conflicts with open drafts; recipients stay read-only (D2).
- **Stance:** Unchanged; no push reminders.

### 7. Export and import — M
- **What:** Markdown zip export (folder or account, images included, relative links); import of Obsidian vault/Markdown zip, Notion and Joplin Markdown exports (Apple Notes via third-party exporters).
- **Value:** Proves "own your data" and eases switching.
- **Builds on:** Streamed, quota-checked uploads; Wave 3c image embedding; wikilinks.
- **Risks:** Zip bombs and path traversal: entry limits, UUID-only writes.
- **Stance:** Unchanged.

### 8. Passkeys (WebAuthn) — M
- **What:** Passkey as phishing-resistant second factor, later passwordless; recovery codes stay.
- **Value:** Faster, stronger phone sign-in for a credentials vault.
- **Builds on:** TOTP enrollment UI, session revocation, reset CLI.
- **Risks:** RP ID is per hostname, awkward with multiple `APP_ORIGINS`; needs HTTPS; one pinned dependency (SimpleWebAuthn) [19].
- **Stance:** Unchanged.

### 9. Installable PWA: offline reading and Android share target — M/L
- **What:** Manifest and service worker; offline read cache cleared on logout; `share_target` into a draft or the daily note.
- **Value:** Capture from any phone app; runbooks during outages.
- **Builds on:** Mobile-first UI, router, daily notes, upload queue.
- **Risks:** Sensitive cache on device; offline edits clash with CAS drafts (start read-only); share target is Android-only [18][23].
- **Stance:** Unchanged.

### 10. Web clipper and read-later (bookmarks merged in) — M/L
- **What:** Bookmarklet/share target posts a URL; server extracts readable content into a `Clips` note with `source:` frontmatter; "bookmark only" mode; or the assistant fetches and writes via MCP (#2) with no server fetch.
- **Value:** Research next to your notes, filling Omnivore's gap [16].
- **Builds on:** Tags, search, MCP write, Files.
- **Risks:** **SSRF** (block private/metadata ranges, re-check redirects, caps); sanitizing; §14 bans content processing, so operator approval needed.
- **Stance:** Adds outbound fetches; opt-in, `CLIPPER_ENABLED=false` by default.

### 11. Searching documents and OCR — L (operator decision)
- **What:** PDF/text extraction into FTS; optional Tesseract OCR, as in Paperless-ngx [4].
- **Value:** Scans become findable; MCP can read document text.
- **Risks:** Out of scope today (§14, D17); parser attack surface, CPU, image size.
- **Stance:** Heavy in-container dependencies; offer as an optional image variant.

### 12. Vault notes (client-side encrypted per note) — L
- **What:** Browser-side encryption (Argon2id WASM + AES-GCM); server stores ciphertext versions; excluded from search, MCP, sharing.
- **Value:** Protects the credentials the README targets even if the disk leaks, like Trilium protected notes [9].
- **Risks:** Lost passphrase = lost data; no diffs; hard UX.
- **Stance:** Unchanged, but a second class of notes.

## 4. Rejected, or deferred indefinitely

- **Public or expiring share links.** Contradicts the trusted-allowlist identity and §14. If ever needed, add authenticated read links for allowlisted users instead.
- **Full end-to-end encryption of every note** (Standard Notes, Anytype). It would break server-side search, MCP, diffs, and sharing, which are the core value. Vault notes (#12) cover the need.
- **A built-in AI assistant with bundled models.** Heavy, and it duplicates what MCP clients already do. At most, allow an optional Ollama URL later.
- **Calendar and reminders.** They need push or email delivery and scheduling, which is scope creep. Due dates in Tasks (#6) cover about 80% of the need.
- **Audio memos with transcription.** Whisper-class models are large and CPU-heavy. Audio already uploads to Files, and an assistant can transcribe through MCP later.
- **Contacts/people, flashcards, kanban.** Niche or CRM-like, and templates plus tags plus tasks cover most of it. A kanban grouping of tasks could come back as a Tasks view option.
- **Real-time co-editing (HedgeDoc) and plugins/scripting (Trilium, SilverBullet).** They conflict with D2 (owner-only writes) and with the security posture.
- **Graph view as its own module.** Keep it as an optional add-on to backlinks.

## 5. Suggested next three waves (after Bin, Files UI, and docs)

1. **Wave 7, "Find and connect" (v0.5):** FTS5 search plus MCP `search_notes`, tags, and wikilinks/backlinks, sharing one indexing hook and one set of ACL-safe queries. Highest value per unit of effort.
2. **Wave 8, "Capture and act" (v0.6):** daily notes and templates, task aggregation, scoped MCP draft-write tools, and Markdown zip export (import can follow). Make "AI writes drafts, you publish" the headline.
3. **Wave 9, "Anywhere, safely" (v0.7):** passkeys, an installable PWA with offline reading and an Android share target, and the opt-in web clipper with SSRF guards. Then an operator decision on document text search/OCR and on vault notes.

## 6. Refreshed value proposition

MyNotes is a private second brain that you run in one container on hardware you own. Every note is plain Markdown on your disk with a full, restorable version history. You can find anything by content, link and tag ideas, collect tasks and daily notes into one view, and store supporting files and images next to the notes. Share them only with people you trust, behind strong passwords, two-factor authentication, and passkeys. Your own AI assistants connect through scoped MCP keys: they can search, read, and propose changes as drafts, but nothing is published without your approval. There is no cloud and no telemetry, and backups are just files.

## Sources

1. Outline MCP docs: https://docs.getoutline.com/s/guide/doc/mcp-6j9jtENNKL ; https://github.com/Vortiago/mcp-outline
2. Obsidian MCP servers: https://github.com/cyanheads/obsidian-mcp-server ; https://www.morphllm.com/obsidian-mcp-server
3. Memos MCP: https://github.com/Red5d/memos_mcp
4. Paperless-ngx: https://docs.paperless-ngx.com/
5. Karakeep: https://github.com/karakeep-app/karakeep ; https://docs.karakeep.app/
6. Memos: https://github.com/usememos/memos ; https://usememos.com/
7. Obsidian pricing/features: https://www.lindy.ai/blog/obsidian-pricing ; https://www.techrepublic.com/article/obsidian-review/
8. Logseq: https://docs.logseq.com/ ; https://fabric.so/comparison/obsidian-vs-logseq
9. Trilium protected notes and note map: https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes ; https://github.com/TriliumNext/Trilium/wiki/Note-map
10. Standard Notes: https://standardnotes.com/features ; https://standardnotes.com/blog/introducing-super-notes-moments-and-offline-file-access
11. Bear vs Apple Notes: https://fabric.so/comparison/bear-vs-apple-notes
12. SilverBullet: https://silverbullet.md/ ; https://lwn.net/Articles/1030941/
13. Notion MCP: https://github.com/makenotion/notion-mcp-server ; https://www.notion.com/releases/2026-04-14
14. Joplin: https://joplinapp.org/ ; https://github.com/laurent22/joplin
15. Wallabag and read-later alternatives: https://selfh.st/alternatives/read-later/
16. Omnivore shutdown: https://myownsys.com/2024/11/10/omnivore-shuts-down-best-alternatives-for-readers/
17. Anytype privacy: https://doc.anytype.io/anytype/data/privacy-and-encryption
18. Memos share-target request: https://github.com/usememos/memos/issues/5837
19. Passkeys and SimpleWebAuthn: https://www.hirenodejs.com/blog/nodejs-passkeys-webauthn-2026 ; https://dev.to/pockit_tools/passkeys-and-webauthn-the-complete-guide-to-killing-passwords-in-your-web-app-22f1
20. MCP prompt injection: https://www.aptible.com/mcp-security/mcp-prompt-injection ; https://owasp.org/www-community/attacks/MCP_Tool_Poisoning
21. MCP risks: https://checkmarx.com/learn/mcp-security-risks-real-world-incidents-and-security-controls/
22. SQLite FTS5: https://sqlite.org/fts5.html
23. MDN share_target: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
24. HedgeDoc/Nextcloud Notes context: https://www.xda-developers.com/self-hosted-markdown-editors-that-sync-without-the-cloud/
