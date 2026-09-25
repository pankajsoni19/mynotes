# Using Nook

This guide covers the apps a signed-in user sees. For installing, configuring, backing up, and upgrading a server, see [OPERATIONS.md](OPERATIONS.md). The same material is published at [pankajsoni19.github.io/nook](https://pankajsoni19.github.io/nook/).

## Home and URLs

Signing in lands on **Home**, which links to Notes, Files, and Tasks, with the Bin next to Settings and Sign out at the top (a small count shows when it holds items); each app's Home control (the app name at the top of its sidebar) leads back. Each view has a real URL, and reloading or opening a link resumes that view (a signed-out visit shows the login screen first, then continues to the requested page):

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

## Bin

Deleting a note or a file moves it to the shared **Bin** (the **Bin** button next to Settings on Home, or `/bin`) for exactly **30 days**. The retention period is fixed. The Bin lists only your own deleted items, newest first, with the days left for each; filter by notes or files.

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
