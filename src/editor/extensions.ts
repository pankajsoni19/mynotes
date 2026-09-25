import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";

// Options for the marked lexer used by @tiptap/markdown. GFM enables pipe tables and task lists.
export const markdownOptions = { gfm: true, breaks: false };

// The extensions that define the note schema and its Markdown. Kept free of UI-only extensions
// (placeholder, slash menu, upload handlers) so tests can drive the serializer without a DOM.
export function noteContentExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ link: false }),
    Link.configure({ openOnClick: false, autolink: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Only same-origin file URLs survive the CSP (img-src 'self' data:); pasted HTML pointing
    // elsewhere would leave a broken image, so drop it instead of parsing it into a node.
    Image.extend({ parseHTML: () => [{ tag: 'img[src^="/api/files/"]' }] }).configure({ inline: false, allowBase64: false, HTMLAttributes: { class: "note-image", loading: "lazy" } }),
    // Column widths have no pipe-table syntax, so resizing is off; the wrapper scrolls on narrow screens.
    Table.configure({ resizable: false, renderWrapper: true, HTMLAttributes: { class: "note-table" } }),
    TableRow,
    TableHeader,
    TableCell
  ];
}
