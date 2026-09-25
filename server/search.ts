/**
 * Pure helpers for note search (docs/plan/WAVES_7-9.md §2.2–§2.3, D35).
 * No database or filesystem access, so they are unit-testable in isolation.
 */

export const MAX_QUERY_LENGTH = 200;
const MAX_PHRASES = 4;
const MAX_TERMS = 8;
const MAX_PHRASE_WORDS = 8;
const MIN_TERM_LENGTH = 2;
const MAX_TERM_LENGTH = 64;

/**
 * Word characters: letters, numbers, and combining marks. The plan's
 * `[^\p{L}\p{N}]` split would cut Indic and other scripts apart at their
 * vowel signs (Mn/Mc), which unicode61 keeps inside a token.
 */
const separator = /[^\p{L}\p{N}\p{M}]+/u;

/**
 * C0/C1 controls (except tab and newline), bidi controls, and zero-width
 * characters. The highlight markers are C0 controls, so indexed text must
 * never contain them.
 */
const unsafeCharacters = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export const cleanIndexText = (value: string) => value.replace(unsafeCharacters, "");

const words = (text: string) => text.split(separator).filter(Boolean);

/**
 * Builds an FTS5 MATCH expression from user input. User text never becomes FTS
 * syntax: every term is emitted as a double-quoted string made only of word
 * characters, joined by spaces (implicit AND). Returns null when nothing
 * searchable remains or the input is out of bounds.
 */
export function buildFtsQuery(q: string): string | null {
  if (q.length < 1 || q.length > MAX_QUERY_LENGTH) return null;
  const text = q.normalize("NFKC").toLowerCase();

  const phrases: string[] = [];
  let rest = "";
  let cursor = 0;
  const quoted = /"([^"]*)"/g;
  for (let match = quoted.exec(text); match; match = quoted.exec(text)) {
    rest += `${text.slice(cursor, match.index)} `;
    cursor = match.index + match[0].length;
    const phraseWords = words(match[1]!).filter((word) => word.length <= MAX_TERM_LENGTH).slice(0, MAX_PHRASE_WORDS);
    if (phrases.length < MAX_PHRASES && phraseWords.length > 0) phrases.push(phraseWords.join(" "));
    // Phrases beyond the cap fall back to plain terms.
    else rest += `${match[1]!} `;
  }
  // Whatever follows the last closed quote, including an unterminated quote
  // (which is just a separator).
  const tail = text.slice(cursor);
  const candidates = words(rest + tail).filter((word) => word.length >= MIN_TERM_LENGTH && word.length <= MAX_TERM_LENGTH);
  const terms = candidates.slice(0, MAX_TERMS);
  if (phrases.length === 0 && terms.length === 0) return null;

  // The word being typed becomes a prefix query: only when the input ends in
  // that word (not in a space, punctuation, or a closing quote) and the word
  // survived the length filter and the term cap.
  const tailWords = words(tail);
  const lastTerm = terms[terms.length - 1];
  const prefix = lastTerm !== undefined
    && tailWords[tailWords.length - 1] === lastTerm
    && /[\p{L}\p{N}\p{M}]$/u.test(text)
    && candidates.length <= MAX_TERMS;

  const emitted = [
    ...phrases.map((phrase) => `"${phrase}"`),
    ...terms.map((term, index) => `"${term}"${prefix && index === terms.length - 1 ? "*" : ""}`)
  ];
  return emitted.join(" ");
}

/**
 * Plain searchable text from note Markdown: keeps headings, paragraph text,
 * image alt text, link text, and code; strips URLs, HTML tags, and Markdown
 * markup.
 */
export function searchText(markdown: string): string {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const sourceLine of cleanIndexText(markdown).split(/\r?\n/)) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(sourceLine);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length && sourceLine.trim() === fenceMatch[1]) {
        fence = null;
        continue;
      }
      lines.push(sourceLine.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim());
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!;
      continue;
    }
    // Reference-style link definitions carry only a URL.
    if (/^\s{0,3}\[[^\]]+\]:\s*\S+/.test(sourceLine)) continue;
    // Table separator rows and horizontal rules.
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(sourceLine)) continue;
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(sourceLine)) continue;
    if (/^\s{0,3}(=+|-+)\s*$/.test(sourceLine)) continue;

    const line = sourceLine
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/\s+#+\s*$/, "")
      .replace(/^(\s*>\s?)+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\s*\[[ xX]\]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ")
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, " $1 ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, " $1 ")
      .replace(/<(?:https?:\/\/|mailto:)[^>]*>/gi, " ")
      .replace(/<\/?[A-Za-z][^>]*>/g, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\\([\\`*_{}[\]()#+\-.!|~<>"])/g, "$1")
      .replace(/`+/g, "")
      .replace(/\|/g, " ")
      .replace(/(^|[^\p{L}\p{N}])[*_~]+/gu, "$1")
      .replace(/[*_~]+(?=[^\p{L}\p{N}]|$)/gu, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) lines.push(line);
  }
  return lines.filter(Boolean).join("\n");
}

export type Segment = { text: string; hit: boolean };

/** Markers passed to highlight()/snippet(). Indexed text never contains them (cleanIndexText). */
export const HIT_START = "\u0002";
export const HIT_END = "\u0003";

/**
 * Converts highlight()/snippet() output into `{text, hit}` segments, so no
 * HTML ever reaches the client (D35). Adjacent segments of the same kind are
 * merged and empty ones dropped.
 */
export function toSegments(marked: string): Segment[] {
  const segments: Segment[] = [];
  let hit = false;
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    const previous = segments[segments.length - 1];
    if (previous && previous.hit === hit) previous.text += buffer;
    else segments.push({ text: buffer, hit });
    buffer = "";
  };
  for (const character of marked) {
    if (character === HIT_START) {
      flush();
      hit = true;
    } else if (character === HIT_END) {
      flush();
      hit = false;
    } else {
      buffer += character;
    }
  }
  flush();
  return segments;
}
