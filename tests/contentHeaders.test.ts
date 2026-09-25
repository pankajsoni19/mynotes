import { describe, expect, test } from "bun:test";
import { contentDisposition, parseRange } from "../server/contentHeaders";

describe("contentDisposition", () => {
  test("encodes ASCII names", () => {
    expect(contentDisposition("attachment", "report.pdf")).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
    expect(contentDisposition("inline", "my file (1).txt")).toBe(`inline; filename="my file (1).txt"; filename*=UTF-8''my%20file%20%281%29.txt`);
  });

  test("encodes Unicode names with an ASCII fallback", () => {
    expect(contentDisposition("attachment", "résumé.pdf")).toBe(`attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`);
    expect(contentDisposition("attachment", "\u{1F4C4}.txt")).toBe(`attachment; filename="_.txt"; filename*=UTF-8''%F0%9F%93%84.txt`);
    expect(contentDisposition("attachment", "Café.txt")).toContain("filename*=UTF-8''Caf%C3%A9.txt");
  });

  test("strips quotes, backslashes, and control characters from the fallback", () => {
    const value = contentDisposition("attachment", 'a"b\\c\r\nd\te\u0000f.txt');
    expect(value).toStartWith(`attachment; filename="abcdef.txt"; filename*=UTF-8''`);
    expect(value).not.toMatch(/[\r\n]/);
    expect(value).toContain("%22");
    expect(value).toContain("%0D%0A");
    expect(value.split('"').length).toBe(3);
  });

  test("falls back to download when nothing printable remains", () => {
    expect(contentDisposition("attachment", '"\r\n"')).toStartWith(`attachment; filename="download"; `);
    expect(contentDisposition("attachment", "")).toBe(`attachment; filename="download"; filename*=UTF-8''`);
  });

  test("never emits a raw CR or LF for hostile names", () => {
    for (const name of ["x\r\nSet-Cookie: a=b", "\u2028\u2029.txt", "\uD800bad.txt", "a;b=c.txt", "'quote'.txt"]) {
      const value = contentDisposition("inline", name);
      expect(value).not.toMatch(/[\r\n\u2028\u2029]/);
      expect(() => new Headers({ "Content-Disposition": value })).not.toThrow();
    }
  });
});

describe("parseRange", () => {
  test("parses single satisfiable ranges", () => {
    expect(parseRange("bytes=0-0", 10)).toEqual({ kind: "range", start: 0, end: 0 });
    expect(parseRange("bytes=0-", 10)).toEqual({ kind: "range", start: 0, end: 9 });
    expect(parseRange("bytes=4-", 10)).toEqual({ kind: "range", start: 4, end: 9 });
    expect(parseRange("bytes=-1", 10)).toEqual({ kind: "range", start: 9, end: 9 });
    expect(parseRange("bytes=-100", 10)).toEqual({ kind: "range", start: 0, end: 9 });
    expect(parseRange("bytes=2-5", 10)).toEqual({ kind: "range", start: 2, end: 5 });
    expect(parseRange("BYTES = 2 - 5", 10)).toEqual({ kind: "range", start: 2, end: 5 });
  });

  test("clamps an end past the size", () => {
    expect(parseRange("bytes=5-999", 10)).toEqual({ kind: "range", start: 5, end: 9 });
    expect(parseRange("bytes=0-99999999999999999999999", 10)).toEqual({ kind: "range", start: 0, end: 9 });
  });

  test("reports unsatisfiable ranges", () => {
    expect(parseRange("bytes=-0", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=10-", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=10-20", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-5", 0)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });

  test("ignores malformed, multi-range, and non-byte ranges", () => {
    for (const header of [null, "", "bytes=5-2", "bytes=0-1,3-4", "bytes=0-1, 5-", "items=0-1", "bytes=", "bytes=-", "bytes=a-b", "bytes=1.5-2", "bytes=--1", "0-1"]) {
      expect(parseRange(header, 10)).toEqual({ kind: "none" });
    }
  });
});
