# Using Nook

This guide covers the apps a signed-in user sees. For installing, configuring, backing up, and upgrading a server, see [OPERATIONS.md](OPERATIONS.md). The same material is published at [pankajsoni19.github.io/nook](https://pankajsoni19.github.io/nook/).

## Home and URLs

Signing in lands on **Home**, which is also **Today** (below): a row of app links (Notes, Files, Tasks, Collections), with the Bin next to Settings and Sign out at the top (a small count shows when it holds items); each app's Home control (the app name at the top of its sidebar) leads back. Each view has a real URL, and reloading or opening a link resumes that view (a signed-out visit shows the login screen first, then continues to the requested page):

| URL | View |
| --- | --- |
| `/` | Home |
| `/notes` | Notes, all folders (resumes your last note when no folder or note is named) |
| `/notes/folder/<folder-id>` | Notes in one folder |
| `/notes/shared` | Notes shared with you |
| `/notes/<note-id>` | One note in the editor |
| `/files` | Files, all folders |
| `/files/folder/<folder-id>` | Files in one folder |
| `/files/shared` | Files shared with you |
| `/files/<file-id>` | One file's preview and details |
| `/tasks` | Tasks: your boards and boards shared with you |
| `/tasks/<board-id>` | One board |
| `/tasks/<board-id>/card/<card-id>` | One card, open over its board |
| `/collections` | Collections: yours and those shared with you |
| `/collections/<collection-id>` | One collection's table (a card list on phones) |
| `/collections/<collection-id>/view/<view-id>` | A saved view of a collection |
| `/collections/<collection-id>/row/<row-id>` | One row (a side pane on desktop, a full screen on phones) |
| `/bin` | Bin |

Unknown paths open Home. A link to a note or file you cannot read (or that is missing or in the Bin) falls back to the list with a message. On phones, Back steps from the editor or preview to the list, then to the folders, then to Home, without leaving the site; in Tasks it steps from a card to its board, to the board list, then to Home. With a dialog or sheet open, Back only closes it.

**Dropdowns.** Choices such as a calendar, a colour, a field type, or a sort field open a list under the control on desktop and a sheet from the bottom on phones. Type the first letters to jump to a choice, use the arrow keys, Home, and End to move, Enter or Space to choose, and Escape to close without choosing; long lists have a search box. On phones, Back closes the sheet and leaves the page and any dialog under it as they were.

## Today

Home shows what needs you today, in sections of up to ten items each. Every item is a link; Back from it returns to Today. **View all** opens the owning app.

| Section | Shows |
| --- | --- |
| Due soon | Cards due within seven days, or overdue, on boards you can open, except in done columns. A card with a due time shows it in your time zone ("Due today at 17:00") and counts as overdue once that time has passed |
| My tasks | Open cards assigned to you or added by you |
| Recent notes | Notes you can read, newest change first (someone else's note appears once it is published, with its published title) |
| Unpublished drafts | Your notes whose draft differs from what is published |
| Drafts from agents | Your notes with a draft written through an MCP key |
| Recent files | Files you can see in Files |
| Recently edited rows | Rows in collections you can open, most recently changed first (titles only) |
| Leaving the Bin soon | Your Bin items that are deleted forever within three days |
| Upcoming | Events on your calendars over the next seven days |
| Storage | How much of your storage quota is used, and how much of it is in the Bin |

**Refresh** reloads everything; coming back to the tab after a minute reloads too. If one section fails, it shows **Retry** and the others still load. **Customize** shows or hides sections; the choice is kept in this browser for your account only. On phones Today is a single column.

## Notes

Notes are Markdown documents organised in folders. Edits begin as drafts that save automatically; **Publish** records an immutable version that can be compared with others or restored. Notes start private; share a note or a whole folder with selected accounts or with everyone signed in. A note's own sharing takes precedence over its folder's.

### Editor

Type `/` for the command menu. Besides headings, lists, checklists, quotes, and code blocks:

- **`/image`**, or paste or drop an image into the editor, uploads it to the note's folder in Files and embeds it. Only PNG, JPEG, GIF, and WebP are accepted, and the server's own type check must agree. Removing an image from a note leaves the file in Files.
- **`/table`** inserts a 3×3 table with a header row. A floating toolbar adds or removes rows and columns and deletes the table; tables are saved as GitHub-flavoured Markdown pipe tables and scroll sideways on phones.
- **Download as PDF** (editor toolbar, or the actions menu on phones) opens the browser's print dialog with a print layout of the note; choose "Save as PDF".

**Limitation:** an embedded image follows the sharing of the **folder** it was uploaded to, not the note's own sharing. If you share a note more widely than its folder, those readers see the text but a broken image. Nothing leaks; share the folder (or the image file) too if they need the images.

### Search

The search box at the top of the note list searches the text of your notes, not just their titles. Press `Ctrl+K` (`⌘K` on a Mac) or `/` to jump to it, and `Esc` to clear it.

- **What matches.** Every word you type must appear in the note, in any order; case and accents are ignored, so `creme` finds "Crème". The last word matches as a prefix while you type (`brul` finds "brûlée"); end the query with a space to match whole words only. Put words in `"double quotes"` to match them as an exact phrase. Punctuation and operators such as `AND`, `OR`, `NOT`, `*`, or `title:` are treated as ordinary text, not search syntax. Link text, image descriptions, and code are searched; link addresses are not.
- **What you see.** Your own notes are searched as you last saved them, including unpublished drafts, which are marked **Draft**. Notes shared with you are searched as their latest published version; you never see someone else's draft. Notes in the Bin are not searched until restored. Matches in the title rank first, and each result shows a highlighted excerpt, its folder, its owner when it is not yours, and when it was last edited.
- **Scope.** Search covers the section you are in: All notes, Shared with me, or one folder. Choose **Search all notes** to widen it. Opening a result from outside the current section switches to All notes.
- **Keyboard and phone.** Use ↑ and ↓ to move through results and Enter to open one. On phones, Back from a note returns to the results with your query kept; Back again closes the search. The query is kept in the browser tab's history state, never in the URL.
- **Limits.** 20 searches per 10 seconds per user; the list falls back to title matches and says so if you go faster. Queries are limited to 200 characters. Files are not searched yet.

## Files

Files lists documents in the same folders as your notes. Each app shows only its own item type.

- **Upload** with the Upload button, by dropping files from your computer onto the list, or on phones from the upload sheet. Uploads run two at a time with a progress bar, and can be cancelled or retried. Each file may be up to `MAX_UPLOAD_BYTES` (100 MiB by default) and counts towards `USER_STORAGE_QUOTA_BYTES` (see [OPERATIONS.md](OPERATIONS.md#configuration)).
- **List and grid views.** The List / Grid toggle next to sort switches between rows and responsive tiles with image thumbnails and type icons. The choice is remembered per user in this browser. Sort by name, date, or size, and filter by name.
- **Preview.** On desktop the list takes the full width until a file is selected; the preview then opens as a pane on the right. Close (×) or `Esc` in the pane deselects the file. On phones the preview is its own screen.
- **Any file type is stored**, but only safe types are shown in the app. The server decides the type from the file's first bytes, not from its name or the browser's claim:

  | Type | Preview |
  | --- | --- |
  | PNG, JPEG, GIF, WebP | shown inline |
  | PDF | opens in a new browser tab |
  | UTF-8 text (`.txt`, `.md`, `.csv`, `.tsv`, `.log`, `.json`) | first 1 MiB shown as plain text, with a notice when truncated |
  | MP3, Ogg, WAV, M4A, MP4, WebM | audio or video player |
  | everything else (including SVG, HTML, Office files, archives) | download only |

- **Actions.** **Download**, **Rename**, **Move**, **Share**, and **Delete** are in each item's ⋯ menu (an action sheet on phones). Drag a file onto a folder to move it; the toast states the new effective sharing.
- **Keyboard.** ↑/↓ move the selection (←/→ too in the grid), Enter opens the preview, F2 renames, and Delete or Backspace deletes your own files.
- **Sharing** works like notes: a file inherits its folder's sharing unless you give it its own (private, selected people, or everyone signed in). People you share with can preview and download but not change anything.
- **Delete** moves the file to the Bin; the toast offers **Undo** for a few seconds.

Nook does **not** strip EXIF or other embedded metadata (for example GPS location or author) from uploaded images or PDFs. Remove it before uploading if you plan to share the file.

## Tasks

Tasks holds kanban boards. A new board starts with **To do**, **Doing**, and **Done**. Boards start private; share one with selected accounts or with everyone signed in.

- **Who can do what.** Everyone who can open a board can add, edit, move, and comment on cards, attach their own files, and move cards to the Bin. Only the board's owner renames it, adds, renames, reorders, or deletes columns, changes its sharing, deletes the board, and deletes items forever. Shared boards show their owner's name.
- **Cards.** Add a card with **Add a card** at the bottom of a column. Drag cards within or between columns on desktop. Every card's ⋯ button opens **Move to…**, which lists the columns and Top or Bottom; with a card focused, `Alt` plus an arrow key moves it up, down, or to the next column. If someone else changed the column meanwhile, the card jumps back and the board reloads.
- **The card view.** Click a card (or press Enter on it) to open it; it has its own URL, and Back closes it. The title saves when you leave the field. The description is Markdown, edited with **Edit** and saved with **Save**; if someone else saved first, choose **Reload** (take theirs) or **Copy my text**. Comments load 50 at a time; you can edit or delete your own, and the board owner can delete any.
- **Attachments.** **Attach** adds files to the card, and the comment box can attach files to a comment. Images pasted or dropped into the description become attachments and show inline. Attachments never appear in Files; they are readable by the people who can open the board, and only while the card and your access last. Removing an attachment from its last card moves it to your Bin.
- **Phones.** A board shows one column at a time: swipe sideways, or tap a column in the strip above it, which also shows how many cards each column holds. Back returns to the same column.
- **Due dates and assignees.** The card view has **Due** (a date; **Clear** removes it). After a date, **Add time** sets an optional time in your time zone (**Remove time** takes it off); moving the date keeps the time. Someone in another zone sees it as, for example, "17:00 Europe/Berlin (11:00 your time)", and on the board and in Today at their own local time. **Assignees** takes up to 20 people: type part of a name to search everyone who can open the board, and remove someone with the ✕ on their chip. People picked while the list is open are saved when it closes. Someone who has lost access to the board shows "(no access)" and can only be removed. Cards show a due chip (with the time when there is one): red when overdue, amber for today and the next days, and the first assignee with "+N" for the rest. The board owner can mark any column as a **done column** from its ⋯ menu (**Done** is one from the start); cards there count as finished and are left out of Today.
- **WIP limits.** The board owner can cap how many cards a column holds with **Set WIP limit…** in its ⋯ menu (1 to 1000; **Remove limit** takes it off). The column header then shows "3 / 5", amber when full and red when over (a limit can be set below the current count; the cards stay). A full column takes no new cards: adding one or moving one in from another column is refused with a message, a dragged card cannot be dropped there, and **Move to…** lists it as full. Reordering within the column and moving cards out always work, and a card restored from the Bin always returns. Everyone who can open the board sees the limit; only the owner changes it.
- **Views.** The icons at the top of a board switch between **Columns** (the lanes), **Table**, and **List**. The table sorts by any column header (click again for descending, a third time for the board order) and scrolls sideways on a phone with the title column kept in view. The list groups cards by column, assignee, tag, flag, or due date (**Group by**); a card with two assignees or tags appears in each group, marked "also in …", and each group folds away with its heading. The view, grouping, and sort are part of the page address, so a reload or a shared link opens the same view; Back returns to the previous view, and opening and closing a card keeps it. Drag and drop works in Columns; in the other views each card's ⋯ opens **Move to…**.
- **Filters.** Under the board's name, **+ Filter** adds a filter: pick a field (Assignee, Tag, Flag, Due, Column, or Relations), then one or more values; a card matches any value of a field and every field. Due takes Overdue, Today, the next 7 days, the 7 days after, No date, or a date with Before, On, or After. Each filter shows as a chip: click it to change it, or its ✕ to remove it; **Clear** removes them all. The **Filter cards** box matches the title and description preview, ignoring case and accents. Filters apply in every view and are part of the page address, so a reload or a link shows the same cards to anyone who can open the board. Changing a filter does not add a Back step. The board's lanes keep their full counts for WIP limits while filtered.
- **Limits.** 50 boards per owner, 20 columns and 1000 cards per board, 500 comments and 50 attachments per card, 10 attachments per comment.

## Collections

Collections are typed tables for anything you track: a home inventory, subscriptions, expenses, recipes, contacts. Open them from **Collections** in Today's launcher, or `/collections`.

- **New collection.** Start blank (a Name and a Notes field) or from a template: Home inventory, Subscriptions, Expenses, Recipes, or Contacts. A template is copied, so changing your collection never changes the template. **Create and import CSV** starts the import right away.
- **Fields.** The owner edits fields with **Fields**: up to 50, each a text, number (with decimals and a unit), date, checkbox, select, multi-select, link (`http` or `https`), note, or files field. The first field is the row's title everywhere and is always text. Fields can be renamed, reordered, made required, and given options with colours. A text field can become a link and back, and a select can become a multi-select; other type changes are refused. Removing a field hides its values at once; each row drops them the next time it changes.
- **Rows.** On desktop, edit cells in place: a change saves when you leave the cell (Enter saves, Escape reverts). Multi-line text, notes, and files open the row. On phones the list shows each row's title and up to three more values; tap a row for a full-screen editor. If someone else changed the row since you loaded it, your edit is not saved and the row offers **Reload**. Up to 10,000 rows per collection.
- **Undo.** Each row keeps its previous values. **⋯ → Undo last change** restores them once (fields removed since stay removed). The same menu has **Copy link** and **Move to Bin**.
- **Find, sort, and filter.** **Find rows** matches text and link fields. **Sort & filter** sorts by up to 3 fields (empty values last) and filters by up to 10 conditions that must all match, and chooses which fields are shown.
- **Saved views.** The owner can **Save as view** from the sort and filter sheet. Views appear as chips above the rows (up to 20), have their own URL, and can be updated, renamed, or deleted by the owner. Everyone with access can use them.
- **Sharing.** The owner shares a collection with selected people or everyone signed in, and chooses one role for all of them: **View only** (read and export) or **Can edit rows** (add, change, undo, and delete rows, attach files). Only the owner changes fields, views, and sharing, or deletes the collection. Viewers see "View only" and no editors.
- **Notes in rows.** A note field links a note you can read. Linking never shares the note: people who cannot read it see "Restricted note", never its title.
- **Attachments.** In a files field, **Attach files** uploads files for the row (up to 20 per row). They count towards your storage quota but never appear in Files; they are readable by everyone who can open the row, and nobody else. Removing a file from its last row moves it to the uploader's Bin; an upload that was never attached is binned after a day.
- **Search.** The search box on the Collections page finds rows in every collection you can open, by title, text, links, numbers, dates, and option labels (not note titles or file names). Back from a result returns to the results.
- **CSV import.** **Import CSV** takes a file up to 2 MB with a header row and up to 5000 rows of up to 50 columns. Columns are matched to fields by name, and you can remap or skip them. **Check** lists every problem first; the import adds all rows or none. Options match by label (several separated by `;`), and checkboxes accept yes/no, true/false, or 1/0.
- **CSV export.** **Export CSV** downloads the rows and fields of the current view as UTF-8 for spreadsheets. Text that a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, or a tab) is prefixed with `'`; importing the file again removes it.
- **Bin.** Deleted rows and collections go to the Bin for 30 days. A row is listed for the collection owner and for whoever deleted it; either can restore it while they can still edit the collection, but only the owner deletes it forever. A row whose collection is itself in the Bin can be restored only after the collection.

## Calendar feeds

A feed link lets a phone or desktop calendar app (Apple Calendar, Google Calendar, Outlook, Thunderbird) subscribe to one of your Nook calendars, read-only. In Calendar, open **Calendars** and choose the subscribe button (the feed icon) next to a calendar; you can do this for your own calendars and for any calendar shared with you.

1. Choose what the feed shows. **Busy only** sends just the times, each titled "Busy", and names the calendar "Busy". **Full details** sends titles, places, and descriptions. Repeats and skipped dates are included either way.
2. **Create link**, then **Copy link** and paste it into your calendar app's "subscribe by URL" or "add calendar from the internet" option. The link is shown **only once**; Nook keeps only a fingerprint of it. If you lose it, create another.
3. The dialog lists your links for that calendar with when each was last used. Revoke (the bin icon) stops a link at once; the subscribed app simply stops updating.

Things to know:

- **Anyone with the link can read the feed** until you revoke it, without signing in and without your two-factor code. Treat it like a password; prefer **Busy only** when you share it or are unsure.
- **Cloud calendars fetch the feed from their own servers.** Google, Outlook, and iCloud (on the web) cannot reach an address that only works on your tailnet or home network; use a calendar app on the device itself, or a public HTTPS address.
- A link follows your access: if the calendar is moved to the Bin, or the owner stops sharing it with you, the link stops working (and works again if that is undone). Links you create are yours alone; other people's links are not shown to you.
- Up to 5 links per calendar per person, each fetched at most 60 times an hour (calendar apps typically refresh every 15 minutes to a few hours). At most 5000 events are sent. Timed events carry their time zone; the app shows them in yours.

## Bin

Deleting a note, a file, a card, a board, a collection, or a row moves it to the shared **Bin** (the **Bin** button next to Settings on Home, the **Bin** entry in the Notes and Files sidebar footers, or `/bin`) for exactly **30 days**. The retention period is fixed. The Bin lists only your own deleted items, newest first, with the days left for each; filter by notes, files, tasks, or collections (collections and their rows; see [Collections](#collections) for who sees a binned row).

- **Cards and boards.** A deleted board is listed for its owner. A deleted card is listed for the board's owner and for the person who deleted it (while they can still open the board); either can restore it, but only the owner can delete it forever. A restored card returns to the bottom of its column, or of the first column if its column was deleted. A card on a deleted board can be restored only after the board. Deleting a card or a board from Tasks offers **Undo** in the toast.
- **Attachments.** When a card or board is deleted forever, or a file is removed from the last card that used it, the file moves to its uploader's Bin, labelled as a card attachment. Restoring it puts it in Files, in your Default folder.

- **What is kept:** everything. A binned note keeps its draft, published versions, and files on disk; a binned file keeps its bytes. Sharing is kept too, so restoring an item gives its previous audience access again. While an item is in the Bin nobody can read it, including its owner outside the Bin and MCP clients.
- **Restore** puts an item back in its original folder, or in your Default folder if the original was deleted. The toast names the folder and says when the item is shared again (a Default folder shared with others widens its audience).
- **Blank notes** that were never published skip the Bin and are removed at once. Any note with content, published or not, goes to the Bin, including an unpublished note whose draft you discard.
- **Delete forever** and **Empty Bin** remove items permanently. After 30 days an hourly sweeper (which also runs at boot) deletes expired items for you.
- Files in the Bin still count towards your storage quota until they are deleted forever.

## Settings → Modules

Open **Settings → Modules** to choose which parts of Nook you see. Each module has a switch, and every module is on until you turn it off. A change applies at once and is saved to your account, so it follows you to every device you sign in to (another open tab picks it up when you return to it). Home and Settings are always on.

| Module | Turning it off hides |
| --- | --- |
| Notes, Files, Tasks, Collections, Calendar | Its tile on Home and its Today sections (for Files, also Storage). Opening one of its URLs, from a bookmark, a link, Back, or a notification, goes to Home with a one-line hint and a **Turn on in Settings** button. |
| Search | The search box in Notes and <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>/</kbd>, and the **Filter cards** text box on Tasks boards (a text filter from a link still applies and shows as a chip you can remove). The note list and the other board filters stay. Pickers inside other apps keep working. |
| Bin | The **Bin** buttons and **Leaving the Bin soon**. Deleting still moves items to the Bin, and they are still deleted forever after 30 days; turn the Bin back on to restore something. |
| Notifications | The bell and `/notifications`. Reminders are still created, and push notifications still arrive on devices where you turned them on. |
| Team | The **Team** button and `/team`. Guests do not see this row. Admins keep **Settings → Manage team**, which still opens Team while the module is off. Roles and blocking apply as before. |

**A hidden module is not a security boundary.** Turning a module off only hides it in this app for you. Nothing is deleted, sharing is unchanged, people you share with still see what you share, MCP keys keep every permission they were given, and calendar feed links keep working. To stop an MCP client or a feed, revoke its key or link instead.

## Team

**Team** lists everyone with an account on this Nook and their **team role**. Open it with the **Team** button next to Bin in the account row (on Today and in each app's header), at `/team`, or, for admins, from **Settings → Manage team**. Each person has their own page at `/team/<id>`.

- **Roles.** An **Admin** can do everything a member can, and manages the team. A **Member** creates, edits, and shares notes, files, tasks, collections, and events, as before. The first account created on a new Nook is the admin; when an existing Nook upgrades, the oldest account becomes the admin and everyone else a member (the operator can change it, see [OPERATIONS.md](OPERATIONS.md#team-admins-and-blocking)). **Viewer** (reads, changes nothing) and **Guest** (reads only what is shared with them by name) are listed but arrive in a later release. The team role is separate from the "View only" and "Can edit rows" choices when you share a collection or calendar.
- **What you see.** Everyone sees names, team roles, and whether an account is blocked. Admins also see each account's email, when it was last seen, whether two-factor is on, how many MCP keys it has, how much storage it uses, and its activity. Admins never see anyone's private notes, files, or other content.
- **Search and filter.** Search by name (admins also by email) and filter with the chips: All, Admins, Members, and Blocked. Accounts created in the last 7 days carry a **New** tag for admins.
- **Changing a role** (admins). Pick the role on the person's page and confirm. Making someone an admin, or removing admin, asks for your password (and a fresh six-digit or recovery code when two-factor is on). Nook always keeps at least one admin: the last one cannot be demoted or blocked. If someone else changed the role meanwhile, Nook shows the current role instead of overwriting it. A change applies on the person's next click.
- **Blocking** (admins). **Block** signs the person out on every device at once and stops them from signing in; you can add a reason that only admins see. Their MCP keys and calendar links pause, and their content stays where it is, still shared as before. Blocking an admin asks for your password. A blocked person who signs in with the right password is told the account is blocked. **Unblock** lets them sign in again with their existing password and two-factor code; they need to turn push notifications on again on each device.
- **Sign out everywhere** (admins) ends every session of that account without blocking it.
- **Activity** (admins) lists the latest role changes, blocks, unblocks, and sign-outs for the person, who made them, and when, including changes made from the host command line.

On a phone, the list and a person's page are separate screens: Back closes an open picker or confirmation first, then returns from the page to the list, then to Today.

## MCP server

Nook includes an authenticated [Model Context Protocol](https://modelcontextprotocol.io/) server over Streamable HTTP, so trusted AI clients can search and read your notes and files, and write drafts for you to review.

1. Open **Settings → MCP server**, name the key, and choose its **Permissions**. The key is shown in full only once; Nook stores its SHA-256 hash and a short identifying prefix, never the plaintext.
2. Copy the ready-to-paste client configuration. The endpoint is `<your origin>/mcp` (`http://localhost:2026/mcp` for the default deployment) and the key is sent as an `Authorization: Bearer` header.
3. Revoke keys you no longer need from the same screen. The key list shows each key's permissions.

Permissions are fixed when the key is created; to change them, create a new key and revoke the old one. A client only ever sees notes and files you can already open, and nothing in the Bin.

| Permission | Scope | What the client can do |
| --- | --- | --- |
| Read notes | `notes:read` | List, read, and search published notes (`list_notes`, `read_note`, `search_notes`) and list folders. Drafts are never shown, not even yours. |
| Write drafts | `notes:write-draft` | Create notes and change the drafts of **your own** notes (`create_note`, `get_note_draft`, `update_note_draft`). It never publishes, never creates a version, and cannot delete, move, or share anything. Includes Read notes. |
| Read files | `files:read` | List files and folders, see file details, and read text files (such as `.txt`, `.md`, `.csv`, `.json`) up to 1 MiB. Images, PDFs, and other binary files cannot be read. |
| Read tasks | `tasks:read` | List the boards you can open, their columns, tags, and cards, and read a card with its comments and relations (`list_boards`, `list_cards`, `get_card`). `list_cards` can filter by column, assignee (`me`, `none`), tag, flag, due date, and text. Find cards by title across your boards with `search_cards`. List your saved task views with `list_views`, and find cards across every board you can open with `query_cards`, either by a view or by a filter such as `assignee:me state:todo,doing due:overdue,week`; a shared view only ever shows you cards from boards you can open. Descriptions come back as plain text and attachments as file names only; a related card on a board you cannot open shows only as restricted. |
| Write tasks | `tasks:write` | Create cards (with a due date and time, assignees, existing tags, and flags), update a card's title, due date, assignees, tags, and flags (never its description), move cards within a board, link two cards you can open (`link_cards`: relates to, depends on, needed by, duplicates), and comment on them as you (`create_card`, `update_card`, `move_card`, `link_cards`, `comment_on_card`), on any board you can use. It never deletes a card or removes a link, never creates tags, and cannot change columns, sharing, or boards. Includes Read tasks. |
| Read Today | `today:read` | Read the Today summary (`get_today`, titles only). Each section also needs the matching permission: notes sections need Read notes, Recent files needs Read files, task sections need Read tasks, Recently edited rows needs Read collections, and Upcoming needs Read calendar; Bin and storage need only Read Today, and list only the kinds of items the key's other permissions cover. |
| Read calendar | `calendar:read` | List your calendars and the events on them (`list_calendars`, `list_events` over up to 100 days, `get_event`). Links to notes, cards, and rows come back as titles, or as "restricted" when you cannot open them. |
| Read team | `team:read` | Admins only. List the accounts on this Nook with their names, team roles, and status (`list_team_members`), and read one account's latest team activity (`get_team_member`). Emails and block reasons are never returned, and there are no team write tools. If you stop being an admin, the key loses these tools on its next call. |
| Write calendar | `calendar:write` | Create and change events on calendars you own or may edit (`create_event`, `update_event`), and set reminders **for yourself** (`create_reminder`). It never deletes events, skips dates, shares calendars, or creates feed links. A change fails with `EVENT_CHANGED` if the event changed since the client read it. Includes Read calendar. |
| Read collections | `collections:read` | List your collections with their fields (`list_collections`), query rows with filters, sorting, and search (`query_rows`, up to 50 a page), and read one row (`get_row`). Rows come back keyed by field name; note links as titles or "restricted"; attachments as file names only. |
| Write collections | `collections:write` | Add rows and change values in collections you own or may edit (`create_row`, `update_row`, which keeps fields it does not name). It never deletes rows, changes fields, views, or sharing, attaches files, or imports. A change fails with `ROW_CHANGED` if the row changed since the client read it. Includes Read collections. |

There are ten permissions in all. Keys created before this release keep exactly what they could do before. Card changes made through a key appear on the board like your own and are recorded in the audit log with the key's id.

**Reviewing an agent's events and rows.** An event or row last changed through a key says **Changed by the MCP key <name>**. The event view's **Undo last change**, and the **Undo** button next to that note in a row, put the previous values back; your own next edit clears the note.

**Reviewing an agent's drafts.** A note whose draft was written through a key shows a **Draft by <key name>** badge in the note list and the editor header. Nothing reaches readers until you press **Publish version** (or **Discard** the draft). Leaving such a note never publishes it, even after you edit it; only the Publish button does. (Your own drafts are published automatically when you leave a note only if you edited them in the current session.) If the draft changed after you last saw it, Publish reloads it and asks you to review it first. If you and an agent edit the same draft at once, whoever saves second is told the draft changed instead of overwriting it.

**Limits.** Each key can make 120 tool calls and 30 writes a minute, and per day create 200 notes, make 500 task changes, 200 event changes, 100 reminders, and 500 row changes. All keys of one account together get 1000 calls and 60 writes a minute, and per day 400 new notes, 1000 task changes, 400 event changes, 200 reminders, and 1000 row changes. Beyond that the client gets `RATE_LIMITED`. Writes are recorded in the audit log with the key's id.

Treat API keys like passwords, use a separate key per client, and give each only the permissions it needs. The text of your notes and files is passed to the client as data. A client that follows instructions hidden in that text is the client's risk, which is why writing is opt-in and publishing always stays with you.
