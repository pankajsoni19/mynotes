# MyNotes: new Home-screen modules (research pass 2)

*2026-09-25. Repo read-only. This pass proposes new apps only, not enhancements to Notes, Files, or Tasks. It assumes the existing constraints: one container, SQLite plus files on disk, allowlisted users, owner-only writes (D2), a shared folder tree (D1), the 30-day Bin (D11), no cloud or telemetry, MCP access, mobile-first design, and no server-side content processing (§14).*

## 1. What suites bundle

- **Nextcloud** ships Calendar, Contacts, Deck, Tables, Collectives, and Talk around Files [1].
- **Specialist apps:** Karakeep and Wallabag for bookmarks and read-later [2][3], Grocy, Mealie, and Tandoor for the kitchen [4], Actual Budget for money [5], Paperless-ngx for documents [6], Immich for photos [7], Radicale for CalDAV/CardDAV [8], Vikunja for tasks over CalDAV [9], Monica as a personal CRM [10], and Beaver for habits [11].
- **Object models:** Anytype builds on types, relations, and sets [12]. Notion databases now come with scheduled and event-triggered Custom Agents (2026) [13].
- **Journaling:** Apple Journal combines prompts, mood logging, and reminders [14].

Two patterns stand out. First, the "structured list" apps (inventory, recipes, contacts, habits, subscriptions) are thin CRUD apps over typed records. Second, the AI-native move in 2026 is **agents that run on a schedule and write into the workspace** [13].

## 2. Candidates

Effort: S = under one wave, M = one wave, L = more than one wave. "Stance" asks whether the module keeps the single-container, no-cloud stance.

| Candidate | Users / value | Links to Notes/Files/Tasks | Data model | Effort | Main risks | Stance / mobile |
|---|---|---|---|---|---|---|
| **Today dashboard** | Everyone: one screen for today (tasks due, journal, recent notes and files, reminders, agent inbox) | Read-only aggregation of every module; deep links (D21) | `dashboard_prefs(user, widgets JSON)`; no new content | S/M | Must reuse each module's ACL query to avoid leaks | Yes / ideal on mobile |
| **Journal** | Individuals: daily log with mood 1–5, tags, and a rotating prompt; private by default | Entries are versioned Markdown (reuses the note engine); `@note`/`@task` links; Bin; search; MCP `append_journal` as draft | `journal_entries(id, user, date UNIQUE, mood, prompt_id, note_id)`; body as a note file | S | Sensitive: never shared by default, excluded from MCP unless the key is scoped | Yes / yes |
| **Bookmarks and read-later** | Household and team: save URLs, read later, archived snapshot against link rot [2] | Snapshot saved as a Files document; "Clip to note"; tags; search; Bin | `bookmarks(id, owner, url, title, excerpt, status, snapshot_doc_id, folder_id)` | M | **SSRF** (Linkwarden CVE-2026-44313, CVSS 9.1 [15]); hostile HTML; storage growth | Opt-in outbound fetch; share target on mobile |
| **Agent inbox and routines** | Owner and trusted assistants: scheduled routines ("weekly review", "summarize new files") whose outputs land as **proposals** for a human to approve | Proposals are note drafts, task cards, or bookmarks; approving publishes; history records the key | `routines(id, owner, cron, prompt, key_id)`, `proposals(id, routine_id, kind, target_id, status)` | M | Prompt injection [16]; runaway writes (limit per run); no built-in LLM, so an external MCP client polls `get_due_routines` | Yes / quick approve and reject on mobile |
| **Calendar and reminders** | Household: events, shared family calendar, reminders | Task due dates appear on the calendar; events link notes (agendas) and files | `calendars`, `events(rrule, tz)`, `reminders`; `.ics` export feed | M (ICS read-only); L (full CalDAV) | Recurrence and time-zone bugs; delivery needs Web Push, which relays encrypted payloads via Apple, Google, or Mozilla [17] | Push is a small no-cloud exception; iOS push needs the PWA installed [17] |
| **Collections (generic typed tables)** | Everyone: inventory, recipes, subscriptions, expenses, contacts, habits, checklists | Record fields of type `note`/`file`/`task`/`person`; attachments via Files; backlinks | `collections(schema JSON)`, `records(collection_id, values JSON)`, `record_versions`; views (table, list, gallery, calendar) | L | Scope creep toward Notion; schema migration; query performance on JSON | Yes / card view on mobile |
| **Whiteboard** | Team and visual thinkers: diagrams, floor plans, sketches | `.excalidraw` JSON stored as a Files document [18]; versioned via Files re-upload or a new "canvas" kind; embed PNG in notes | Scene JSON as a file; `canvases(doc_id, thumb_doc_id)` | M | Heavy bundle (lazy-load); tldraw is no longer OSS [19], so Excalidraw (MIT) only; no real-time collaboration | Yes / weak on phones |
| Contacts / people (CardDAV) | Household | Collection template | Collection | M (as a template) / L (CardDAV) | DAV surface | Yes |
| Passwords vault | Household | None, deliberately | Ciphertext blobs | L | Crypto design; Vaultwarden and Passbolt are proven [20] | Yes |
| Receipts and expenses | Household | Record links a Files scan | Collection template | S (template) | Not a budget app [5] | Yes |
| Scanner and OCR inbox | Household | Files | OCR text | L | §14 bans processing; Tesseract size [6] | Heavy |
| Meeting notes and transcription | Team | Notes and Files | Audio file plus transcript | L | Whisper models are 75 MB–2.9 GB and CPU-heavy [21] | Heavy |
| Habit tracker | Individual | Journal and Collections | `habit_checks` | S | Overlaps with Journal | Yes |
| Snippets vault | Developers | Notes with code blocks | — | S | Duplicates Notes | Yes |
| Forms and checklists | Household | Collection | — | S (template) | — | Yes |
| RSS reader | Individual | Bookmarks | Feeds and items | M | Polling fetcher, SSRF, growth | Opt-in |
| Group chat | Small team | Links | Messages | L | Real-time, push, moderation | Poor fit |
| Photos gallery | Household | Files | Thumbnails | L | §14 bans thumbnails; Immich needs 6 GB RAM [7] | Heavy |
| Time tracking | Team | Tasks | `time_entries(task_id)` | S | A Tasks feature, not a module | Yes |

## 3. Top 6 by value-to-effort

1. **Today dashboard (S/M).** It makes three modules feel like one product and is the natural mobile landing screen. It only reads data. Ship widgets for Tasks due, recent notes and files, and the Bin countdown, then add widgets as modules land.
2. **Journal (S).** Most of it is reuse: the note engine, versions, drafts, and Bin. The new parts are a date key, mood, prompts, and a streak. Habits can live here as optional daily checkboxes, the way Beaver keeps check-ins minimal [11]. Its MCP use ("what did I do last week?") is strong but must be opt-in per key.
3. **Agent inbox and routines (M).** This is MyNotes' answer to Notion Custom Agents [13] without a bundled model or cloud. MyNotes stores routines and exposes `get_due_routines`, `submit_proposal`, and `complete_run` over MCP. A trusted external client, such as a scheduled Claude or Ollama job, does the thinking. Humans approve from the inbox. It extends the existing "agents write drafts, humans publish" safety model to every module.
4. **Bookmarks and read-later (M).** High daily value and it fills the gap Omnivore left. Snapshots are stored as Files documents with the text/plain or download-only preview rules (D6, D7), and are never rendered as HTML. Put the fetcher behind `BOOKMARKS_FETCH=false` by default. It must resolve DNS first, block private, link-local, and metadata ranges, re-check every redirect, and cap size and time [15]. A "bookmark only" mode needs no fetch at all.
5. **Calendar and reminders (M, staged).** Stage 1: events and reminders in SQLite, task due dates overlaid, and a per-user secret-token `.ics` subscription feed so phones show events natively. Stage 2: optional Web Push for reminders [17]. Stage 3, only if demanded: CalDAV. Radicale shows it is possible, and Vikunja shows client compatibility is hard [8][9].
6. **Collections (L).** Highest ceiling. It subsumes contacts, inventory, recipes, subscriptions, receipts, checklists, and habits (see §5). It ranks sixth only because of effort and scope risk.

## 4. Rejected, one line each

- **Whiteboard:** worth doing next (Excalidraw MIT, scenes stored as Files), but it is niche on phones and bundle-heavy.
- **Passwords vault:** real crypto engineering where a flaw is catastrophic; recommend Vaultwarden alongside instead [20].
- **Contacts with CardDAV:** a DAV server is a second protocol stack; ship a People Collection template instead.
- **Receipts and expenses:** a Collection template with a Files link; real budgeting belongs to Actual [5].
- **Scanner and OCR inbox:** violates §14 (no server-side processing) and Tesseract is heavy; camera capture into Files covers intake.
- **Meeting audio and transcription:** Whisper-class models are too big for the image [21]; an MCP client can transcribe audio from Files.
- **Habit tracker:** folded into Journal and Collections.
- **Snippets vault:** Notes with code blocks and tags already do this.
- **Forms and checklists:** a Collection view with checkbox fields.
- **RSS reader:** a polling fetcher plus storage growth; revisit as a Bookmarks feed source.
- **Group chat:** real-time infrastructure and push, outside the product's identity.
- **Photos gallery:** needs thumbnails and EXIF work (banned by §14); Immich is far better [7].
- **Time tracking:** belongs inside Tasks as a feature.

## 5. Roadmap options

**Value-first:** Today dashboard → Journal → Bookmarks → Agent inbox and routines → Calendar (ICS) → Collections → Whiteboard.
The quickest visible wins come first, and each module can ship on its own.

**Cohesion-first:** Today dashboard (defines the widget and cross-link contract) → Agent inbox (defines the "proposal" primitive for every module) → Collections (people, recipes, inventory, receipts, habits as templates) → Journal (a Collection-like dated view on the note engine) → Calendar (views over any date field: tasks, events, records) → Bookmarks (a Collection of typed "link" records with a fetcher).
This builds shared primitives first, so later modules become thin views over them.

## 6. "Collections" as a subsuming module

One generic module stores records against a user-defined schema: text, number, money, date, select, checkbox, rating, URL, and relations to a note, file, task, person, or another record. It offers table, list, card, and calendar views. Templates (People, Inventory, Recipes, Subscriptions, Receipts, Habits, Checklist) replace six or seven mini-apps.

It inherits folders, sharing (D3), Bin, search (index the rendered values), and MCP for free through generic `list_records`, `get_record`, and `propose_record` tools. Agents gain one uniform write surface. Records are rows in SQLite, and attachments stay in Files, so backups stay simple.

The downsides are real:
- Generic UIs are worse than purpose-built ones (a recipe view with servings scaling, or recurring subscription renewal reminders).
- Schema edits need migration rules for existing values.
- Querying JSON columns needs generated columns or indexes to stay fast on mobile.
- Per-type logic (a birthday reminder, an expiry date, a habit streak) creeps back in as "field behaviors".
- It is the fastest path to becoming a mediocre Notion.

Mitigations:
- Keep the field types fixed, with no formulas or rollups in v1.
- Allow template-specific display components.
- Route behaviors through the Calendar/Reminders and Agent inbox primitives instead of per-collection code.

## Sources

1. https://nextcloud.com/blog/nextcloud-hub25-autumn/ ; https://nextcloud.com/groupware/
2. https://github.com/karakeep-app/karakeep ; https://docs.karakeep.app/
3. https://wallabag.org/ ; https://selfh.st/alternatives/read-later/
4. https://sumguy.com/mealie-vs-tandoor-vs-grocy/
5. https://github.com/actualbudget/actual
6. https://docs.paperless-ngx.com/usage/
7. https://docs.immich.app/FAQ/ ; https://miget.com/blog/immich-docker-compose
8. https://github.com/Kozea/Radicale
9. https://xylentis.com/blog/advanced-self-hosted-vikunja-integrating-caldav-for-seamless-task-synchronization-with-apple-reminders-and-google-calendar
10. https://github.com/monicahq/monica ; https://getdex.com/blog/monica-review/
11. https://github.com/daya0576/beaverhabits
12. https://doc.anytype.io/anytype-docs/basics/sets-and-collections/sets
13. https://techcrunch.com/2026/05/13/notion-just-turned-its-workspace-into-a-hub-for-ai-agents/ ; https://www.eesel.ai/blog/notion-ai-review
14. https://www.apple.com/newsroom/2023/12/apple-launches-journal-app-a-new-app-for-reflecting-on-everyday-moments/ ; https://developer.apple.com/videos/play/wwdc2024/10209/
15. https://www.thehackerwire.com/critical-ssrf-in-linkwarden-cve-2026-44313/
16. See pass 1, sources [20][21] (MCP prompt-injection guidance).
17. https://blog.codercops.com/blog/web-push-notifications-implementation-guide-2026 ; https://monogram.io/blog/notifications-from-ios-and-ipados-pwas
18. https://github.com/excalidraw/excalidraw/discussions/9111
19. https://instapods.com/apps/excalidraw/vs/tldraw/
20. https://blog.elest.io/vaultwarden-vs-passbolt-which-self-hosted-password-manager-for-your-team/
21. https://openwhispr.com/blog/whisper-model-sizes-explained
