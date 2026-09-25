import type { JSONContent, MarkdownRendererHelpers, MarkdownToken } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";

// Pipe tables hold one line per cell, so the table's Markdown is written here rather than by the
// stock renderer: `|` is escaped, hard breaks and paragraph boundaries become `<br>`, and block
// content (lists, headings, code) is flattened to a single line of inline content.

const BR_HTML = /^<br\s*\/?>$/i;

// marked hands `<br>` inside a cell to us as a raw inline HTML token; make it a line break token
// so the hardBreak extension parses it, instead of keeping the tag as literal text.
function brTokensToBreaks(tokens: MarkdownToken[] | undefined): MarkdownToken[] | undefined {
  return tokens?.map((token) => {
    if (token.type === "html" && BR_HTML.test((token.raw ?? "").trim())) return { type: "br", raw: token.raw };
    return token.tokens ? { ...token, tokens: brTokensToBreaks(token.tokens) } : token;
  });
}

type CellToken = { tokens: MarkdownToken[] };

function withBreaks(token: MarkdownToken): MarkdownToken {
  const fixCell = (cell: CellToken) => ({ ...cell, tokens: brTokensToBreaks(cell.tokens) ?? [] });
  return {
    ...token,
    header: (token.header as CellToken[] | undefined)?.map(fixCell),
    rows: (token.rows as CellToken[][] | undefined)?.map((row) => row.map(fixCell))
  };
}

// Escape every `|` that is not already escaped (preceded by an odd number of backslashes).
export function escapeCellPipes(text: string): string {
  return text.replace(/(\\*)\|/g, (match, slashes: string) => (slashes.length % 2 === 1 ? match : `${slashes}\\|`));
}

function inlineLeaves(node: JSONContent): JSONContent[] {
  if (node.type === "text" || node.type === "hardBreak" || node.type === "image") return [node];
  const blocks = node.content ?? [];
  const parts = blocks.map(inlineLeaves).filter((leaves) => leaves.length > 0);
  // Separate the text of sibling blocks (list items, nested paragraphs) with a space.
  return parts.flatMap((leaves, index) => (index === 0 ? leaves : [{ type: "text", text: " " }, ...leaves]));
}

function renderCell(cell: JSONContent, h: MarkdownRendererHelpers): string {
  const lines = (cell.content ?? []).map((block) => {
    const inline = block.type === "paragraph" ? block.content ?? [] : inlineLeaves(block);
    return h.renderChildren(inline).replace(/[ \t]*\\?\r?\n[ \t]*/g, "<br>");
  });
  return escapeCellPipes(lines.join("<br>").replace(/\s+/g, " ").trim());
}

type Align = "left" | "right" | "center" | null;

function cellAlign(cell: JSONContent): Align {
  const align = cell.attrs?.align;
  return align === "left" || align === "right" || align === "center" ? align : null;
}

export function renderTableMarkdown(node: JSONContent, h: MarkdownRendererHelpers): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({ text: renderCell(cell, h), isHeader: cell.type === "tableHeader", align: cellAlign(cell) }))
  );
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columns === 0) return "";
  const widths = Array.from({ length: columns }, (_, i) => Math.max(3, ...rows.map((row) => row[i]?.text.length ?? 0)));
  const aligns = Array.from({ length: columns }, (_, i) => rows.find((row) => row[i]?.align)?.[i]?.align ?? null);
  const hasHeader = rows[0].some((cell) => cell.isHeader);
  const line = (texts: string[]) => `| ${texts.map((text, i) => text.padEnd(widths[i])).join(" | ")} |\n`;
  const texts = (row: typeof rows[number]) => Array.from({ length: columns }, (_, i) => row[i]?.text ?? "");
  const separator = widths.map((width, i) => {
    const dashes = "-".repeat(width);
    return aligns[i] === "left" ? `:${dashes}` : aligns[i] === "right" ? `${dashes}:` : aligns[i] === "center" ? `:${dashes}:` : dashes;
  });
  const header = hasHeader ? texts(rows[0]) : Array.from({ length: columns }, () => "");
  const body = hasHeader ? rows.slice(1) : rows;
  return `\n${line(header)}| ${separator.join(" | ")} |\n${body.map((row) => line(texts(row))).join("")}`;
}

const stockParse = Table.config.parseMarkdown;

export const NoteTable = Table.extend({
  parseMarkdown(token, h) {
    return stockParse!.call(this, withBreaks(token), h);
  },
  renderMarkdown(node, h) {
    return renderTableMarkdown(node, h);
  }
});
