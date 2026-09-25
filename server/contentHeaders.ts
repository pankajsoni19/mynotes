/**
 * Pure helpers for document content responses: Content-Disposition encoding
 * (RFC 6266 / RFC 5987) and single byte-range parsing (RFC 9110).
 */

/** Builds a Content-Disposition value that can never contain CR, LF, or an unescaped quote. */
export function contentDisposition(disposition: "inline" | "attachment", name: string) {
  const normalized = name.replace(/\p{Cs}/gu, "").normalize("NFC");
  const fallback = Array.from(normalized, (char) => (char.codePointAt(0)! > 0x7e ? "_" : char))
    .join("")
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    .trim() || "download";
  const encoded = encodeURIComponent(normalized).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export type RangeResult =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Parses a Range header for a representation of `size` bytes. Only a single
 * `bytes` range is honored; multiple ranges, other units, and malformed values
 * are ignored (the caller sends the full body). Any range on an empty file,
 * a start at or past the end, and a zero-length suffix are unsatisfiable.
 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return { kind: "none" };
  const match = /^\s*bytes\s*=\s*(.*?)\s*$/i.exec(header);
  if (!match) return { kind: "none" };
  const spec = match[1]!;
  if (spec.includes(",")) return { kind: "none" };
  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!parts) return { kind: "none" };
  const [, first, last] = parts as unknown as [string, string, string];
  if (first === "" && last === "") return { kind: "none" };
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? Number.POSITIVE_INFINITY : Number(last);
  if (end < start) return { kind: "none" };
  if (size === 0 || start >= size) return { kind: "unsatisfiable" };
  return { kind: "range", start, end: Math.min(end, size - 1) };
}
