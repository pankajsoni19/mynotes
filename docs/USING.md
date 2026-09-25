# Using Nook

This guide covers the apps a signed-in user sees. For installing, configuring, backing up, and upgrading a server, see [OPERATIONS.md](OPERATIONS.md). The same material is published at [pankajsoni19.github.io/nook](https://pankajsoni19.github.io/nook/).

## Home and URLs

Signing in lands on **Home**, which links to Notes, Files, Tasks, Collections, and the Bin; each app's Home control (the app name at the top of its sidebar) leads back. Each view has a real URL, and reloading or opening a link resumes that view (a signed-out visit shows the login screen first, then continues to the requested page):

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
| `/collections` | Collections: yours and those shared with you |
| `/collections/<collection-id>` | One collection's table (a card list on phones) |
| `/collections/<collection-id>/view/<view-id>` | A saved view of a collection |
| `/collections/<collection-id>/row/<row-id>` | One row (a side pane on desktop, a full screen on phones) |
| `/bin` | Bin |

Unknown paths open Home. A link to a note or file you cannot read (or that is missing or in the Bin) falls back to the list with a message. On phones, Back steps from the editor or preview to the list, then to the folders, then to Home, without leaving the site; with a dialog or sheet open, Back only closes it.

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

## Collections

Collections are typed tables for anything you track: a home inventory, subscriptions, expenses, recipes, contacts. Open them from Home → **Collections**.

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

## Bin

Deleting a note or a file moves it to the shared **Bin** (Home → Bin, or `/bin`) for exactly **30 days**. The retention period is fixed. The Bin lists only your own deleted items, newest first, with the days left for each; filter by notes, files, or collections (collections and their rows; see [Collections](#collections) for who sees a binned row).

- **What is kept:** everything. A binned note keeps its draft, published versions, and files on disk; a binned file keeps its bytes. Sharing is kept too, so restoring an item gives its previous audience access again. While an item is in the Bin nobody can read it, including its owner outside the Bin and MCP clients.
- **Restore** puts an item back in its original folder, or in your Default folder if the original was deleted. The toast names the folder and says when the item is shared again (a Default folder shared with others widens its audience).
- **Blank notes** that were never published skip the Bin and are removed at once. Any note with content, published or not, goes to the Bin, including an unpublished note whose draft you discard.
- **Delete forever** and **Empty Bin** remove items permanently. After 30 days an hourly sweeper (which also runs at boot) deletes expired items for you.
- Files in the Bin still count towards your storage quota until they are deleted forever.

## MCP server

Nook includes an authenticated [Model Context Protocol](https://modelcontextprotocol.io/) server over Streamable HTTP, so trusted AI clients can search and read your notes.

1. Open **Settings → MCP server** and create an API key. The key is shown in full only once; Nook stores its SHA-256 hash and a short identifying prefix, never the plaintext.
2. Copy the ready-to-paste client configuration. The endpoint is `<your origin>/mcp` (`http://localhost:2026/mcp` for the default deployment) and the key is sent as an `Authorization: Bearer` header.
3. Revoke keys you no longer need from the same screen.

Today the server is **read-only**: it provides `list_notes` and `read_note`, restricted to the latest published versions the key owner can already read. Drafts, files, and write operations are excluded. Per-key scopes, coverage of files and tasks, and draft-only writes are planned (see [plan/WAVES_7-9.md](plan/WAVES_7-9.md)). Treat API keys like passwords and use a separate key per client.
