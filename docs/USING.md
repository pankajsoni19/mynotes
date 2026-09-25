# Using Nook

This guide covers the apps a signed-in user sees. For installing, configuring, backing up, and upgrading a server, see [OPERATIONS.md](OPERATIONS.md). The same material is published at [pankajsoni19.github.io/nook](https://pankajsoni19.github.io/nook/).

## Home and URLs

Signing in lands on **Home**, which is also **Today** (below): a row of app links (Notes, Files, Tasks), with the Bin next to Settings and Sign out at the top (a small count shows when it holds items); each app's Home control (the app name at the top of its sidebar) leads back. Each view has a real URL, and reloading or opening a link resumes that view (a signed-out visit shows the login screen first, then continues to the requested page):

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
| `/bin` | Bin |

Unknown paths open Home. A link to a note or file you cannot read (or that is missing or in the Bin) falls back to the list with a message. On phones, Back steps from the editor or preview to the list, then to the folders, then to Home, without leaving the site; in Tasks it steps from a card to its board, to the board list, then to Home. With a dialog or sheet open, Back only closes it.

## Today

Home shows what needs you today, in sections of up to ten items each. Every item is a link; Back from it returns to Today. **View all** opens the owning app.

| Section | Shows |
| --- | --- |
| Due soon | Cards due within seven days, or overdue, on boards you can open, except in done columns |
| My tasks | Open cards assigned to you or added by you |
| Recent notes | Notes you can read, newest change first (someone else's note appears once it is published, with its published title) |
| Unpublished drafts | Your notes whose draft differs from what is published |
| Drafts from agents | Your notes with a draft written through an MCP key |
| Recent files | Files you can see in Files |
| Leaving the Bin soon | Your Bin items that are deleted forever within three days |
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
- **Due dates and assignees.** The card view has **Due** (a date; **Clear** removes it) and **Assignee** (anyone who can open the board). Cards show a due chip: red when overdue, amber for today and the next days. The board owner can mark any column as a **done column** from its ⋯ menu (**Done** is one from the start); cards there count as finished and are left out of Today.
- **Limits.** 50 boards per owner, 20 columns and 1000 cards per board, 500 comments and 50 attachments per card, 10 attachments per comment.

## Bin

Deleting a note, a file, a card, or a board moves it to the shared **Bin** (the **Bin** button next to Settings on Home, the **Bin** entry in the Notes and Files sidebar footers, or `/bin`) for exactly **30 days**. The retention period is fixed. The Bin lists only your own deleted items, newest first, with the days left for each; filter by notes, files, or tasks.

- **Cards and boards.** A deleted board is listed for its owner. A deleted card is listed for the board's owner and for the person who deleted it (while they can still open the board); either can restore it, but only the owner can delete it forever. A restored card returns to the bottom of its column, or of the first column if its column was deleted. A card on a deleted board can be restored only after the board. Deleting a card or a board from Tasks offers **Undo** in the toast.
- **Attachments.** When a card or board is deleted forever, or a file is removed from the last card that used it, the file moves to its uploader's Bin, labelled as a card attachment. Restoring it puts it in Files, in your Default folder.

- **What is kept:** everything. A binned note keeps its draft, published versions, and files on disk; a binned file keeps its bytes. Sharing is kept too, so restoring an item gives its previous audience access again. While an item is in the Bin nobody can read it, including its owner outside the Bin and MCP clients.
- **Restore** puts an item back in its original folder, or in your Default folder if the original was deleted. The toast names the folder and says when the item is shared again (a Default folder shared with others widens its audience).
- **Blank notes** that were never published skip the Bin and are removed at once. Any note with content, published or not, goes to the Bin, including an unpublished note whose draft you discard.
- **Delete forever** and **Empty Bin** remove items permanently. After 30 days an hourly sweeper (which also runs at boot) deletes expired items for you.
- Files in the Bin still count towards your storage quota until they are deleted forever.

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
| Read tasks | `tasks:read` | List the boards you can open, their columns and cards, and read a card with its comments (`list_boards`, `list_cards`, `get_card`). Descriptions come back as plain text and attachments as file names only. |
| Write tasks | `tasks:write` | Create cards (optionally with a due date), move them within a board, and comment on them as you (`create_card`, `move_card`, `comment_on_card`), on any board you can use. It never edits or deletes a card and cannot change columns, sharing, or boards. Includes Read tasks. |
| Read Today | `today:read` | Read the Today summary (`get_today`, titles only). Each section also needs the matching permission above: notes sections need Read notes, Recent files needs Read files, and task sections need Read tasks; Bin and storage need only Read Today. |

Keys created before this release keep exactly what they could do before: Read notes. Card changes made through a key appear on the board like your own and are recorded in the audit log with the key's id.

**Reviewing an agent's drafts.** A note whose draft was written through a key shows a **Draft by <key name>** badge in the note list and the editor header. Nothing reaches readers until you press **Publish version** (or **Discard** the draft). Leaving such a note never publishes it, even after you edit it; only the Publish button does. (Your own drafts are published automatically when you leave a note only if you edited them in the current session.) If the draft changed after you last saw it, Publish reloads it and asks you to review it first. If you and an agent edit the same draft at once, whoever saves second is told the draft changed instead of overwriting it.

**Limits.** Each key can make 120 tool calls and 30 writes a minute and create 200 notes and make 500 task changes a day, and all keys of one account together get 1000 calls and 60 writes a minute, 400 new notes, and 1000 task changes a day; beyond that the client gets `RATE_LIMITED`. Writes are recorded in the audit log with the key's id.

Treat API keys like passwords, use a separate key per client, and give each only the permissions it needs. The text of your notes and files is passed to the client as data. A client that follows instructions hidden in that text is the client's risk, which is why writing is opt-in and publishing always stays with you.
