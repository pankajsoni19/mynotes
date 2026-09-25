import { describe, expect, test } from "bun:test";
import { sanitizeDisplayName } from "../server/validation";

const bytes = (value: string) => Buffer.byteLength(value, "utf8");

describe("sanitizeDisplayName", () => {
  test("applies NFC normalization", () => {
    const decomposed = "Cafe\u0301.txt";
    expect(sanitizeDisplayName(decomposed, "upload")).toBe("Caf\u00e9.txt");
  });

  test("strips control, bidi, and zero-width characters", () => {
    expect(sanitizeDisplayName("invoice\u202Efdp.exe", "upload")).toBe("invoicefdp.exe");
    expect(sanitizeDisplayName("a\u0000b\u0007c\u007Fd\u0085e.txt", "upload")).toBe("abcde.txt");
    expect(sanitizeDisplayName("x\u200By\u200Cz\u200D\uFEFF.md", "upload")).toBe("xyz.md");
    expect(sanitizeDisplayName("\u2066a\u2069\u200E\u200Fb\u202A\u202B\u202C\u202D.pdf", "upload")).toBe("ab.pdf");
    expect(sanitizeDisplayName("line\r\nbreak.txt", "upload")).toBe("linebreak.txt");
  });

  test("replaces path separators and colons", () => {
    expect(sanitizeDisplayName("../../etc/passwd", "upload")).toBe("-..-etc-passwd");
    expect(sanitizeDisplayName("C:\\Windows\\win.ini", "upload")).toBe("C--Windows-win.ini");
  });

  test("collapses whitespace and trims whitespace and dots", () => {
    expect(sanitizeDisplayName("  my    report \t final.pdf  ", "upload")).toBe("my report final.pdf");
    expect(sanitizeDisplayName("...hidden.txt...", "upload")).toBe("hidden.txt");
  });

  test("rejects empty, dot, and dot-dot names", () => {
    for (const name of ["", "   ", ".", "..", "\u202E", " . . "]) {
      expect(sanitizeDisplayName(name, "rename")).toBeNull();
      expect(sanitizeDisplayName(name, "upload")).toBe("Untitled");
    }
  });

  test("truncates uploads to 255 UTF-8 bytes and keeps the extension", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const result = sanitizeDisplayName(long, "upload")!;
    expect(bytes(result)).toBeLessThanOrEqual(255);
    expect(result.endsWith(".pdf")).toBe(true);

    const multibyte = `${"\u00e9".repeat(200)}.txt`;
    const truncated = sanitizeDisplayName(multibyte, "upload")!;
    expect(bytes(truncated)).toBeLessThanOrEqual(255);
    expect(truncated.endsWith(".txt")).toBe(true);
    expect(truncated).not.toContain("\uFFFD");

    const noExtension = "\u{1F600}".repeat(100);
    const emoji = sanitizeDisplayName(noExtension, "upload")!;
    expect(bytes(emoji)).toBeLessThanOrEqual(255);
    expect([...emoji].every((char) => char === "\u{1F600}")).toBe(true);
  });

  test("rename rejects names longer than 255 bytes instead of truncating", () => {
    expect(sanitizeDisplayName(`${"a".repeat(252)}.pdf`, "rename")).toBeNull();
    expect(sanitizeDisplayName(`${"a".repeat(251)}.pdf`, "rename")).toBe(`${"a".repeat(251)}.pdf`);
  });

  test("preserves emoji and CJK names", () => {
    expect(sanitizeDisplayName("\u{1F4C4} \u4F1A\u8B70\u8B70\u4E8B\u9332.pdf", "upload")).toBe("\u{1F4C4} \u4F1A\u8B70\u8B70\u4E8B\u9332.pdf");
    expect(sanitizeDisplayName("\uD83Dnote.txt", "upload")).toBe("note.txt");
  });
});
