/**
 * Magic-byte classification for uploaded documents (DEVELOPMENT_PLAN §7.1).
 * Pure: no I/O. The client-declared Content-Type is never an input.
 */

export type PreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "none";
export type SniffResult = { mimeType: string; previewKind: PreviewKind };

/** Bytes of the upload kept in memory for classification. */
export const SNIFF_BYTES = 4100;

const OCTET_STREAM: SniffResult = { mimeType: "application/octet-stream", previewKind: "none" };
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".json"]);
const MP4_BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "M4A ", "dash"]);

function startsWith(head: Uint8Array, signature: ArrayLike<number>, offset = 0) {
  if (head.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (head[offset + index] !== signature[index]) return false;
  }
  return true;
}

const ascii = (value: string) => Array.from(value, (char) => char.charCodeAt(0));
const asciiAt = (head: Uint8Array, value: string, offset = 0) => startsWith(head, ascii(value), offset);

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function containsAscii(head: Uint8Array, value: string, limit: number) {
  const needle = ascii(value);
  const end = Math.min(head.length, limit) - needle.length;
  for (let offset = 0; offset <= end; offset += 1) if (startsWith(head, needle, offset)) return true;
  return false;
}

/** Drops a multi-byte UTF-8 sequence cut off at the end of the sample. */
function withoutTruncatedTail(bytes: Uint8Array) {
  let index = bytes.length - 1;
  let continuation = 0;
  while (index >= 0 && continuation < 3 && (bytes[index]! & 0xc0) === 0x80) {
    index -= 1;
    continuation += 1;
  }
  if (index < 0) return bytes;
  const lead = bytes[index]!;
  const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return needed > 1 && continuation + 1 < needed ? bytes.subarray(0, index) : bytes;
}

function isUtf8Text(head: Uint8Array, totalSize: number) {
  if (totalSize === 0 || head.length === 0) return false;
  if (head.includes(0)) return false;
  const sample = head.length < totalSize ? withoutTruncatedTail(head) : head;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

export function sniff(head: Uint8Array, name: string, totalSize: number): SniffResult {
  const extension = extensionOf(name);
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: "image/png", previewKind: "image" };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", previewKind: "image" };
  if (asciiAt(head, "GIF87a") || asciiAt(head, "GIF89a")) return { mimeType: "image/gif", previewKind: "image" };
  if (asciiAt(head, "RIFF") && asciiAt(head, "WEBP", 8)) return { mimeType: "image/webp", previewKind: "image" };
  if (asciiAt(head, "%PDF-")) return { mimeType: "application/pdf", previewKind: "pdf" };
  if (asciiAt(head, "ID3")) return { mimeType: "audio/mpeg", previewKind: "audio" };
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && extension === ".mp3") {
    return { mimeType: "audio/mpeg", previewKind: "audio" };
  }
  if (asciiAt(head, "OggS")) return { mimeType: "audio/ogg", previewKind: "audio" };
  if (asciiAt(head, "RIFF") && asciiAt(head, "WAVE", 8)) return { mimeType: "audio/wav", previewKind: "audio" };
  if (asciiAt(head, "ftyp", 4) && head.length >= 12) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (brand === "M4A ") return { mimeType: "audio/mp4", previewKind: "audio" };
    if (MP4_BRANDS.has(brand)) return { mimeType: "video/mp4", previewKind: "video" };
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]) && containsAscii(head, "webm", 64)) return { mimeType: "video/webm", previewKind: "video" };
  if (TEXT_EXTENSIONS.has(extension) && isUtf8Text(head, totalSize)) return { mimeType: "text/plain; charset=utf-8", previewKind: "text" };
  return OCTET_STREAM;
}
