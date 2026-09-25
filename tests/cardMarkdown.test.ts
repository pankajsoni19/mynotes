import { expect, test } from "bun:test";
import { getSchema, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { markdownOptions, noteContentExtensions } from "../src/editor/extensions";

// Card descriptions render through the notes renderer read-only (D44). These fixtures prove the
// schema never turns hostile Markdown into markup: raw HTML stays text, only this app's file URLs
// become images, and unsafe link targets render with an empty href.
const manager = () => new MarkdownManager({ extensions: noteContentExtensions(), markedOptions: markdownOptions });
const schema = getSchema(noteContentExtensions());

function walk(node: JSONContent, visit: (node: JSONContent) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}
const nodesOf = (markdown: string) => {
  const found: JSONContent[] = [];
  walk(manager().parse(markdown), (node) => found.push(node));
  return found;
};

test("raw HTML in a description stays plain text", () => {
  for (const fixture of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", '<a href="javascript:alert(1)">x</a>', "<iframe src=//evil.example></iframe>", "<svg onload=alert(1)>"]) {
    const nodes = nodesOf(fixture);
    expect(nodes.map((node) => node.type).filter((type) => type !== "doc" && type !== "paragraph" && type !== "text")).toEqual([]);
    expect(nodes.some((node) => node.type === "text" && node.text?.includes("<"))).toBe(true);
  }
});

test("data:, external, and javascript: images are dropped; app file images are kept", () => {
  for (const fixture of ["![a](data:image/png;base64,AAAA)", "![a](https://evil.example/x.png)", "![a](javascript:alert(1))", "![a](//evil.example/x.png)", "![a](/api/files/not-a-uuid/content)"]) {
    expect(nodesOf(fixture).some((node) => node.type === "image")).toBe(false);
  }
  const src = "/api/files/0b7c1a52-3f5e-4d8e-9a51-0c6a7f2b9d11/content?disposition=inline";
  expect(nodesOf(`![ok](${src})`).find((node) => node.type === "image")?.attrs?.src).toBe(src);
});

test("javascript: and data: link targets render with an empty href", () => {
  const hrefFor = (markdown: string) => {
    const link = nodesOf(markdown).flatMap((node) => node.marks ?? []).find((mark) => mark.type === "link");
    if (!link) return null;
    const spec = schema.marks.link!.spec.toDOM!(schema.marks.link!.create(link.attrs), true) as [string, Record<string, string>];
    return spec[1].href;
  };
  expect(hrefFor("[x](javascript:alert(1))")).toBe("");
  expect(hrefFor("[x](JaVaScRiPt:alert(1))")).toBe("");
  expect(hrefFor("[x](data:text/html,<script>alert(1)</script>)")).toBe("");
  expect(hrefFor("[x](https://example.com)")).toBe("https://example.com");
});
