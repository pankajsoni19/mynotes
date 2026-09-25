import { describe, expect, test } from "bun:test";
import { sniff } from "../server/mimeSniff";

const bytes = (...parts: Array<string | number[]>) => {
  const values: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") values.push(...new TextEncoder().encode(part));
    else values.push(...part);
  }
  return new Uint8Array(values);
};
const classify = (head: Uint8Array, name: string, size = head.length) => sniff(head, name, size);
const none = { mimeType: "application/octet-stream", previewKind: "none" };

describe("magic-byte sniffing", () => {
  test("maps each allowlisted signature", () => {
    expect(classify(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), "a.png")).toEqual({ mimeType: "image/png", previewKind: "image" });
    expect(classify(bytes([0xff, 0xd8, 0xff, 0xe0]), "a.jpg")).toEqual({ mimeType: "image/jpeg", previewKind: "image" });
    expect(classify(bytes("GIF87a", [1, 0]), "a.gif")).toEqual({ mimeType: "image/gif", previewKind: "image" });
    expect(classify(bytes("GIF89a", [1, 0]), "a.gif")).toEqual({ mimeType: "image/gif", previewKind: "image" });
    expect(classify(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "a.webp")).toEqual({ mimeType: "image/webp", previewKind: "image" });
    expect(classify(bytes("%PDF-1.7\n"), "a.pdf")).toEqual({ mimeType: "application/pdf", previewKind: "pdf" });
    expect(classify(bytes("ID3", [4, 0, 0]), "a.bin")).toEqual({ mimeType: "audio/mpeg", previewKind: "audio" });
    expect(classify(bytes([0xff, 0xfb, 0x90, 0x64]), "song.mp3")).toEqual({ mimeType: "audio/mpeg", previewKind: "audio" });
    expect(classify(bytes([0xff, 0xfb, 0x90, 0x64]), "song.bin")).toEqual(none);
    expect(classify(bytes("OggS", [0, 2]), "a.ogg")).toEqual({ mimeType: "audio/ogg", previewKind: "audio" });
    expect(classify(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "), "a.wav")).toEqual({ mimeType: "audio/wav", previewKind: "audio" });
    for (const brand of ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "dash"]) {
      expect(classify(bytes([0, 0, 0, 0x18], "ftyp", brand, [0, 0, 0, 0]), "a.mp4")).toEqual({ mimeType: "video/mp4", previewKind: "video" });
    }
    expect(classify(bytes([0, 0, 0, 0x18], "ftypM4A ", [0, 0, 0, 0]), "a.m4a")).toEqual({ mimeType: "audio/mp4", previewKind: "audio" });
    expect(classify(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm"), "a.webm")).toEqual({ mimeType: "video/webm", previewKind: "video" });
    expect(classify(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f], "matroska"), "a.mkv")).toEqual(none);
  });

  test("classifies active content, archives, executables, and unknown images as none", () => {
    expect(classify(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "a.svg")).toEqual(none);
    expect(classify(bytes("<!doctype html><script>alert(1)</script>"), "a.html")).toEqual(none);
    expect(classify(bytes('<?xml version="1.0"?><a/>'), "a.xml")).toEqual(none);
    expect(classify(bytes("alert(document.cookie)"), "a.js")).toEqual(none);
    expect(classify(bytes("PK", [3, 4, 20, 0]), "a.zip")).toEqual(none);
    expect(classify(bytes("PK", [3, 4, 20, 0]), "a.docx")).toEqual(none);
    expect(classify(bytes([0x7f], "ELF", [2, 1, 1]), "a.bin")).toEqual(none);
    expect(classify(bytes("MZ", [0x90, 0]), "a.exe")).toEqual(none);
    expect(classify(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0]), "a.heic")).toEqual(none);
    expect(classify(bytes([0x89, 0x50, 0x4e]), "a.png")).toEqual(none);
  });

  test("text needs an allowed extension, valid UTF-8, no NUL bytes, and content", () => {
    expect(classify(bytes("# Notes\nhello"), "a.md")).toEqual({ mimeType: "text/plain; charset=utf-8", previewKind: "text" });
    for (const name of ["a.txt", "a.markdown", "a.csv", "a.tsv", "a.log", "a.json", "A.TXT"]) {
      expect(classify(bytes("plain"), name).previewKind).toBe("text");
    }
    expect(classify(bytes("abc", [0], "def"), "a.txt")).toEqual(none);
    expect(classify(bytes("just ascii"), "a.exe")).toEqual(none);
    expect(classify(bytes("just ascii"), "txt")).toEqual(none);
    expect(classify(bytes([0xc3, 0x28]), "a.txt")).toEqual(none);
    expect(classify(new Uint8Array(0), "empty.txt", 0)).toEqual(none);
  });

  test("a multi-byte character cut at the sample boundary still counts as text", () => {
    const sample = new Uint8Array(4100).fill(0x61);
    sample.set([0xe2, 0x82], 4098);
    expect(classify(sample, "long.md", 10_000).previewKind).toBe("text");
    // The same bytes as a complete file are invalid UTF-8.
    expect(classify(sample, "long.md", 4100).previewKind).toBe("none");
  });

  test("bytes decide, not the name", () => {
    expect(classify(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "page.html")).toEqual({ mimeType: "image/png", previewKind: "image" });
    expect(classify(bytes("<html><body>hi</body></html>"), "image.png")).toEqual(none);
  });
});
