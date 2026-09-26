/**
 * The task filter grammar (docs/plan/research/2026-09-26-task-hierarchy-workflows.md
 * §10.3, D137, D140–D145). One pure, dependency-free module shared by the server
 * (the `POST /api/tasks/query` compiler, saved views, MCP `query_cards`) and the
 * client (the Wave 13 board filter bar, the Tasks home, URL round-trips).
 *
 * A query is a list of terms separated by spaces. Terms AND together; the
 * values of one term OR together; a leading `-` negates a term.
 *
 *   assignee:me state:todo,doing due:overdue,week
 *   board:<uuid> -state:done tag:"Needs design" "invoice"
 *
 * - `key:value[,value…]` filters one field. Values may be quoted (`"a b"`, with
 *   `\"` and `\\` escapes).
 * - A quoted phrase, or a bare word that is not `key:…`, is a text term: the
 *   card title or description excerpt contains it (case-insensitive, no
 *   wildcards).
 * - Keys and keyword values are case-insensitive; ids are UUIDs.
 *
 * `format` writes the canonical form: terms in a fixed key order (positive
 * before negated), values deduplicated and sorted, text always quoted. The
 * canonical form is what URLs (`?q=`), `task_views.query`, and MCP carry.
 *
 * Nothing here touches the network, the DOM, or the database.
 */

export const TASK_QUERY_LIMITS = {
  /** Characters in a query string. */
  length: 2000,
  /** Terms in one query. */
  terms: 20,
  /** Values in one term. */
  values: 20,
  /** Characters in one text term. */
  text: 100,
  /** Characters in a tag name value (board tags are 1–40, WAVE_13 D109). */
  tagName: 40
} as const;

/** Keys in canonical order. */
export const FILTER_KEYS = ["board", "state", "column", "assignee", "creator", "tag", "flag", "due", "has", "text"] as const;
export type FilterKey = typeof FILTER_KEYS[number];

/**
 * Keys that arrive with the hierarchy and sprint sub-waves (17A, 17B, D137).
 * They parse as `FILTER_UNSUPPORTED` until then, so a query that uses them is
 * refused rather than silently widened.
 */
export const RESERVED_FILTER_KEYS = ["parent", "level", "sprint"] as const;

export const TASK_STATES = ["todo", "doing", "done"] as const;
export type TaskState = typeof TASK_STATES[number];
/** The fixed card flag set (WAVE_13 D110), in display order. */
export const TASK_FLAGS = ["urgent", "blocked", "needs_review", "on_hold"] as const;
export type TaskFlag = typeof TASK_FLAGS[number];
/** `has:` values. `relation`: any visible relation; `blocked`: an open `depends_on` blocker. `subtasks` is reserved (17A). */
export const HAS_VALUES = ["relation", "blocked"] as const;
const RESERVED_HAS_VALUES = ["subtasks"] as const;
/** Relative due keywords. `week` is today and the next six days; `next-week` the seven days after that. */
export const DUE_KEYWORDS = ["overdue", "today", "week", "next-week", "none"] as const;

export type FilterTerm = { key: FilterKey; negate: boolean; values: string[] };
export type TaskQuery = { terms: FilterTerm[] };

export type TaskQueryErrorCode = "FILTER_INVALID" | "FILTER_UNSUPPORTED" | "FILTER_SCOPE";
export type TaskQueryError = { code: TaskQueryErrorCode; message: string; position: number };
export type ParseResult = { ok: true; query: TaskQuery } | { ok: false; error: TaskQueryError };

export type ParseOptions = {
  /**
   * The query runs inside one board (the board page), so `column:` is valid on
   * its own. Otherwise `column:` needs exactly one positive `board:` value.
   */
  boardScoped?: boolean;
  /**
   * Skip invalid terms and values instead of failing (URL decoding: unknown
   * keys and bad values are dropped, WAVE_13 §4.6). Limits still apply by
   * truncation. Scope errors drop the `column:` terms.
   */
  lenient?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

// C0/C1 controls and bidi overrides never belong in a value (as for board and tag names).
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

/** A real calendar date `YYYY-MM-DD` between 1900 and 2999 (the card due date rule, T71). */
export function isQueryDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `date` (YYYY-MM-DD) plus `days`, as YYYY-MM-DD. */
export function addQueryDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

class Fail extends Error {
  constructor(readonly code: TaskQueryErrorCode, message: string, readonly position: number) {
    super(message);
  }
}

/** The canonical value for `key`, or a Fail. `raw` is already unquoted. */
function normalizeValue(key: FilterKey, raw: string, position: number): string {
  const lower = raw.toLowerCase();
  const bad = (message: string) => new Fail("FILTER_INVALID", message, position);
  if (!raw) throw bad(`Give a value for ${key}:`);
  if (CONTROL.test(raw)) throw bad("Filters cannot contain control characters");
  switch (key) {
    case "board":
    case "column":
      if (!isUuid(raw)) throw bad(`${key}: takes an id`);
      return lower;
    case "assignee":
      if (lower === "me" || lower === "none") return lower;
      if (!isUuid(raw)) throw bad("assignee: takes me, none, or a user id");
      return lower;
    case "creator":
      if (lower === "me") return lower;
      if (!isUuid(raw)) throw bad("creator: takes me or a user id");
      return lower;
    case "state":
      if (!(TASK_STATES as readonly string[]).includes(lower)) throw bad("state: takes todo, doing, or done");
      return lower;
    case "flag":
      if (lower === "none" || (TASK_FLAGS as readonly string[]).includes(lower)) return lower;
      throw bad(`flag: takes ${TASK_FLAGS.join(", ")}, or none`);
    case "tag": {
      if (lower === "none") return lower;
      if (isUuid(raw)) return lower;
      const name = raw.trim();
      if (!name || name.length > TASK_QUERY_LIMITS.tagName) throw bad(`Tag names are 1 to ${TASK_QUERY_LIMITS.tagName} characters`);
      return name;
    }
    case "due": {
      if ((DUE_KEYWORDS as readonly string[]).includes(lower)) return lower;
      // Wave 13 URL spellings: before:D and after:D.
      const alias = /^(before|after):(.*)$/.exec(lower);
      const comparison = alias ? `${alias[1] === "before" ? "<" : ">"}${alias[2]}` : lower;
      const date = comparison.replace(/^[<>]/, "");
      if (!isQueryDate(date)) throw bad("due: takes overdue, today, week, next-week, none, or a date as YYYY-MM-DD, <YYYY-MM-DD, or >YYYY-MM-DD");
      return comparison;
    }
    case "has":
      if ((HAS_VALUES as readonly string[]).includes(lower)) return lower;
      if ((RESERVED_HAS_VALUES as readonly string[]).includes(lower)) throw new Fail("FILTER_UNSUPPORTED", `has:${lower} is not available yet`, position);
      throw bad(`has: takes ${HAS_VALUES.join(" or ")}`);
    case "text": {
      const text = raw.normalize("NFC").trim();
      if (!text) throw bad("Give some text to match");
      if (text.length > TASK_QUERY_LIMITS.text) throw bad(`Text filters are at most ${TASK_QUERY_LIMITS.text} characters`);
      return text;
    }
  }
}

/** Sort rank of a value within its key: keywords in declared order, then everything else. */
const KEYWORD_ORDER: Partial<Record<FilterKey, readonly string[]>> = {
  assignee: ["me", "none"],
  creator: ["me"],
  state: TASK_STATES,
  flag: [...TASK_FLAGS, "none"],
  tag: ["none"],
  due: DUE_KEYWORDS,
  has: HAS_VALUES
};

function compareValues(key: FilterKey, a: string, b: string) {
  const order = KEYWORD_ORDER[key] ?? [];
  const rank = (value: string) => {
    const index = order.indexOf(value);
    return index < 0 ? order.length : index;
  };
  const byRank = rank(a) - rank(b);
  if (byRank) return byRank;
  // Dates sort by date, then exact before < before >.
  if (key === "due") {
    const date = (value: string) => value.replace(/^[<>]/, "");
    const op = (value: string) => (value[0] === "<" ? 1 : value[0] === ">" ? 2 : 0);
    if (date(a) !== date(b)) return date(a) < date(b) ? -1 : 1;
    return op(a) - op(b);
  }
  const fold = (value: string) => value.toLowerCase();
  return fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/** Dedupes values (tag names case-insensitively) and sorts them canonically. */
function canonicalValues(key: FilterKey, values: readonly string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const identity = key === "tag" || key === "text" ? value.toLowerCase() : value;
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(value);
  }
  return unique.sort((a, b) => compareValues(key, a, b));
}

const termOrder = (term: FilterTerm) => FILTER_KEYS.indexOf(term.key) * 2 + (term.negate ? 1 : 0);
const termText = (term: FilterTerm) => formatTerm(term);

/** Terms in canonical order, with exact duplicates removed. Values are canonical already. */
function canonicalTerms(terms: readonly FilterTerm[]) {
  const sorted = [...terms].sort((a, b) => termOrder(a) - termOrder(b) || (termText(a) < termText(b) ? -1 : termText(a) > termText(b) ? 1 : 0));
  const seen = new Set<string>();
  return sorted.filter((term) => {
    const text = termText(term);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

const needsQuotes = (value: string) => value === "" || /[\s,"\\]/.test(value);
const quote = (value: string) => `"${value.replace(/[\\"]/g, (character) => `\\${character}`)}"`;

function formatTerm(term: FilterTerm) {
  const sign = term.negate ? "-" : "";
  if (term.key === "text") return `${sign}${quote(term.values[0] ?? "")}`;
  return `${sign}${term.key}:${term.values.map((value) => (needsQuotes(value) ? quote(value) : value)).join(",")}`;
}

/** The canonical string for a query. `parse(format(q))` gives back `q` in canonical form. */
export function format(query: TaskQuery): string {
  return canonicalTerms(query.terms.map((term) => ({ ...term, values: term.key === "text" ? term.values.slice(0, 1) : canonicalValues(term.key, term.values) })))
    .map(formatTerm).join(" ");
}

type RawTerm = { term: FilterTerm; position: number };

const isSpace = (character: string | undefined) => character !== undefined && /\s/.test(character);

/**
 * Parses a query string. Strict by default: the first problem returns
 * `{ok: false, error: {code, message, position}}`, where `position` is the
 * character offset of the problem.
 */
export function parse(input: string, options: ParseOptions = {}): ParseResult {
  const lenient = options.lenient === true;
  let source = input;
  if (source.length > TASK_QUERY_LIMITS.length) {
    if (!lenient) return { ok: false, error: { code: "FILTER_INVALID", message: `Filters are at most ${TASK_QUERY_LIMITS.length} characters`, position: TASK_QUERY_LIMITS.length } };
    source = source.slice(0, TASK_QUERY_LIMITS.length);
  }
  const terms: RawTerm[] = [];
  let index = 0;

  const readQuoted = () => {
    // At an opening quote; returns the unescaped text and moves past the closing quote.
    const start = index;
    index += 1;
    let text = "";
    while (index < source.length) {
      const character = source[index]!;
      if (character === "\\" && index + 1 < source.length) {
        text += source[index + 1];
        index += 2;
        continue;
      }
      if (character === '"') {
        index += 1;
        return text;
      }
      text += character;
      index += 1;
    }
    throw new Fail("FILTER_INVALID", "Close the quote", start);
  };

  const skipTerm = () => {
    // Lenient recovery: jump to the next whitespace outside quotes.
    let quoted = false;
    while (index < source.length && (quoted || !isSpace(source[index]))) {
      if (source[index] === "\\" && quoted) index += 1;
      else if (source[index] === '"') quoted = !quoted;
      index += 1;
    }
  };

  while (index < source.length) {
    if (isSpace(source[index])) {
      index += 1;
      continue;
    }
    const start = index;
    try {
      let negate = false;
      if (source[index] === "-" && index + 1 < source.length && !isSpace(source[index + 1])) {
        negate = true;
        index += 1;
      }
      let term: FilterTerm;
      if (source[index] === '"') {
        const valueStart = index;
        const text = readQuoted();
        if (index < source.length && !isSpace(source[index])) throw new Fail("FILTER_INVALID", "Put a space after the quote", index);
        term = { key: "text", negate, values: [normalizeValue("text", text, valueStart)] };
      } else {
        const keyMatch = /^([A-Za-z][A-Za-z_-]*):/.exec(source.slice(index));
        if (!keyMatch) {
          // A bare word is text.
          const wordStart = index;
          while (index < source.length && !isSpace(source[index])) {
            if (source[index] === '"') throw new Fail("FILTER_INVALID", "Quote the whole phrase", index);
            index += 1;
          }
          term = { key: "text", negate, values: [normalizeValue("text", source.slice(wordStart, index), wordStart)] };
        } else {
          const keyName = keyMatch[1]!.toLowerCase();
          if ((RESERVED_FILTER_KEYS as readonly string[]).includes(keyName)) throw new Fail("FILTER_UNSUPPORTED", `${keyName}: is not available yet`, index);
          if (!(FILTER_KEYS as readonly string[]).includes(keyName) || keyName === "text") throw new Fail("FILTER_INVALID", `Unknown filter ${keyName}:`, index);
          const key = keyName as FilterKey;
          index += keyMatch[0].length;
          const values: string[] = [];
          for (;;) {
            const valueStart = index;
            let raw: string;
            if (source[index] === '"') raw = readQuoted();
            else {
              while (index < source.length && !isSpace(source[index]) && source[index] !== ",") {
                if (source[index] === '"') throw new Fail("FILTER_INVALID", "Quote the whole value", index);
                index += 1;
              }
              raw = source.slice(valueStart, index);
            }
            try {
              values.push(normalizeValue(key, raw, valueStart));
            } catch (error) {
              if (!lenient || !(error instanceof Fail)) throw error;
            }
            if (values.length > TASK_QUERY_LIMITS.values) {
              if (!lenient) throw new Fail("FILTER_INVALID", `A filter takes at most ${TASK_QUERY_LIMITS.values} values`, valueStart);
              values.length = TASK_QUERY_LIMITS.values;
            }
            if (source[index] === ",") {
              index += 1;
              continue;
            }
            if (index < source.length && !isSpace(source[index])) throw new Fail("FILTER_INVALID", "Separate values with commas", index);
            break;
          }
          if (!values.length) throw new Fail("FILTER_INVALID", `Give a value for ${key}:`, start);
          term = { key, negate, values: canonicalValues(key, values) };
        }
      }
      if (terms.length >= TASK_QUERY_LIMITS.terms) {
        if (!lenient) throw new Fail("FILTER_INVALID", `Use at most ${TASK_QUERY_LIMITS.terms} filters`, start);
        break;
      }
      terms.push({ term, position: start });
    } catch (error) {
      if (!(error instanceof Fail)) throw error;
      if (!lenient) return { ok: false, error: { code: error.code, message: error.message, position: error.position } };
      index = Math.max(index, start + 1);
      skipTerm();
    }
  }

  const scope = scopeProblem(terms, options.boardScoped === true);
  if (scope) {
    if (!lenient) return { ok: false, error: scope };
    return { ok: true, query: { terms: canonicalTerms(terms.filter((raw) => raw.term.key !== "column").map((raw) => raw.term)) } };
  }
  return { ok: true, query: { terms: canonicalTerms(terms.map((raw) => raw.term)) } };
}

/** `column:` needs one board: the board page, or exactly one positive `board:` value (§10.3 scope rules). */
function scopeProblem(terms: readonly RawTerm[], boardScoped: boolean): TaskQueryError | null {
  const column = terms.find((raw) => raw.term.key === "column");
  if (!column || boardScoped) return null;
  const boards = terms.filter((raw) => raw.term.key === "board" && !raw.term.negate);
  if (boards.length === 1 && boards[0]!.term.values.length === 1) return null;
  return { code: "FILTER_SCOPE", message: "Filter by one board to filter by column", position: column.position };
}

/** The single board a query is scoped to (exactly one positive `board:` value), or null. */
export function scopedBoardId(query: TaskQuery): string | null {
  const boards = query.terms.filter((term) => term.key === "board" && !term.negate);
  return boards.length === 1 && boards[0]!.values.length === 1 ? boards[0]!.values[0]! : null;
}

/** Parses and re-formats: the canonical string, or the error. */
export function canonicalize(input: string, options: ParseOptions = {}): { ok: true; query: string } | { ok: false; error: TaskQueryError } {
  const parsed = parse(input, options);
  return parsed.ok ? { ok: true, query: format(parsed.query) } : parsed;
}

/**
 * Re-validates a query built in code (for example by the filter bar's pills)
 * by formatting and parsing it again, so a hand-built AST obeys the same
 * limits and value rules as typed text.
 */
export function validateQuery(query: TaskQuery, options: ParseOptions = {}): ParseResult {
  return parse(format(query), options);
}

// ---------------------------------------------------------------------------
// Due windows. The server compiles these to SQL and the client can filter a
// loaded board with them, so both agree on what "week" means.

export type DueWindow =
  | { kind: "none" }
  | { kind: "overdue"; before: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "before"; date: string }
  | { kind: "after"; date: string };

/**
 * What a canonical `due:` value means given the viewer's `today` (YYYY-MM-DD).
 * `overdue` is a due date before today; a timed card due today also counts
 * once its wall time has passed (the server compares against the viewer's
 * current wall time, approximate across zones as Today accepts, §5.1).
 */
export function dueWindow(value: string, today: string): DueWindow {
  switch (value) {
    case "none": return { kind: "none" };
    case "overdue": return { kind: "overdue", before: today };
    case "today": return { kind: "range", from: today, to: today };
    case "week": return { kind: "range", from: today, to: addQueryDays(today, 6) };
    case "next-week": return { kind: "range", from: addQueryDays(today, 7), to: addQueryDays(today, 13) };
  }
  if (value.startsWith("<")) return { kind: "before", date: value.slice(1) };
  if (value.startsWith(">")) return { kind: "after", date: value.slice(1) };
  return { kind: "range", from: value, to: value };
}

// ---------------------------------------------------------------------------
// URL codec. `?q=` carries the canonical grammar. The Wave 13 per-key
// parameters (§4.6: assignee, tag, flag, due, column, rel, plus board and
// state) are still read, so older links keep working; they are never written.

/** Every query parameter this codec owns. Callers keep the others (view, layout, group, sort, …). */
export const FILTER_PARAM_KEYS = ["q", "board", "state", "column", "assignee", "creator", "tag", "flag", "due", "has", "rel"] as const;

const LEGACY_PARAM_KEYS = ["board", "state", "column", "assignee", "creator", "tag", "flag", "due", "has"] as const;

type ParamsLike = { getAll(name: string): string[] };

/**
 * Decodes filters from URL parameters, leniently: unknown keys and invalid
 * values are dropped, limits truncate. Values of one legacy key OR together,
 * whether repeated or comma-separated, and AND with the `q` terms.
 */
export function decodeFilterParams(params: ParamsLike, options: Omit<ParseOptions, "lenient"> = {}): TaskQuery {
  const pieces: string[] = [];
  for (const q of params.getAll("q")) pieces.push(q);
  for (const key of LEGACY_PARAM_KEYS) {
    const values = params.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    if (values.length) pieces.push(`${key}:${values.map((value) => (needsQuotes(value) ? quote(value) : value)).join(",")}`);
  }
  for (const rel of params.getAll("rel").flatMap((value) => value.split(","))) {
    const value = rel.trim().toLowerCase();
    if (value === "any") pieces.push("has:relation");
    else if (value === "none") pieces.push("-has:relation");
    else if (value === "blocked") pieces.push("has:blocked");
  }
  const parsed = parse(pieces.join(" "), { ...options, lenient: true });
  return parsed.ok ? parsed.query : { terms: [] };
}

/** Writes the filters into `params` as one canonical `q`, removing every other filter key. */
export function encodeFilterParams(query: TaskQuery, params: URLSearchParams = new URLSearchParams()) {
  for (const key of FILTER_PARAM_KEYS) params.delete(key);
  const text = format(query);
  if (text) params.set("q", text);
  return params;
}
