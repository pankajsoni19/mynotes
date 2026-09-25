import { expect, test } from "bun:test";
import { MarkdownManager } from "@tiptap/markdown";
import { markdownOptions, noteContentExtensions } from "../src/editor/extensions";
import { imageAltText, imageContentUrl, isInsertableImageType } from "../src/editor/imageUpload";

// Uses the editor's own schema extensions and marked options; MarkdownManager needs no DOM.
const manager = () => new MarkdownManager({ extensions: noteContentExtensions(), markedOptions: markdownOptions });
const roundTrip = (markdown: string) => {
  const md = manager();
  return md.serialize(md.parse(markdown)).trim();
};

test("an uploaded image round-trips as a same-origin Markdown image", () => {
  const src = imageContentUrl("0b7c1a52-3f5e-4d8e-9a51-0c6a7f2b9d11");
  const markdown = `# Trip\n\n![beach photo.png](${src})\n\nAfter the image.`;
  const json = manager().parse(markdown);
  const image = json.content?.find((node) => node.type === "image");
  expect(image?.attrs).toMatchObject({ src, alt: "beach photo.png" });
  expect(roundTrip(markdown)).toBe(markdown);
});

test("image alt text is safe to serialise", () => {
  expect(imageAltText("shot [final]\n.png")).toBe("shot final .png");
  expect(imageAltText("  ")).toBe("image");
  expect(roundTrip(`![${imageAltText("a]b.png")}](${imageContentUrl("x")})`)).toBe("![a b.png](/api/files/x/content?disposition=inline)");
});

test("only image kinds the server previews inline are insertable", () => {
  for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp", "IMAGE/PNG"]) expect(isInsertableImageType(type)).toBe(true);
  for (const type of ["image/svg+xml", "image/heic", "application/pdf", ""]) expect(isInsertableImageType(type)).toBe(false);
});

test("tables round-trip as GitHub-flavoured pipe tables", () => {
  const markdown = "Before\n\n| Name | Qty |\n| --- | --- |\n| Tea | **2** |\n| Rice | `1kg` |\n\nAfter";
  const md = manager();
  const json = md.parse(markdown);
  const table = json.content?.find((node) => node.type === "table");
  expect(table?.content?.map((row) => row.content?.map((cell) => cell.type))).toEqual([
    ["tableHeader", "tableHeader"], ["tableCell", "tableCell"], ["tableCell", "tableCell"]
  ]);
  const once = md.serialize(json);
  expect(once).toMatch(/^\| Name +\| Qty +\|$/m);
  expect(once).toMatch(/^\| -+ \| -+ \|$/m);
  expect(once).toContain("**2**");
  // Serialising the re-parsed output is stable, so autosave does not churn the note.
  expect(roundTrip(once)).toBe(once.trim());
});

test("an empty inserted table stays a 3 x 3 table after a save and reload", () => {
  const md = manager();
  const cell = (type: string) => ({ type, content: [{ type: "paragraph" }] });
  const row = (type: string) => ({ type: "tableRow", content: [cell(type), cell(type), cell(type)] });
  const doc = { type: "doc", content: [{ type: "table", content: [row("tableHeader"), row("tableCell"), row("tableCell")] }] };
  const table = md.parse(md.serialize(doc)).content?.find((node) => node.type === "table");
  expect(table?.content).toHaveLength(3);
  expect(table?.content?.every((tableRow) => tableRow.content?.length === 3)).toBe(true);
});
