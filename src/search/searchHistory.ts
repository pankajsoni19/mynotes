// History-state hint for Notes search, mirroring src/filesNavigation.ts. The query lives in
// component state and in this payload on the history entry, never in the URL. An entry with a hint
// whose query is empty was pushed for a search that was later cleared: it is reused instead of
// pushing another entry.
export type SearchHint = { query: string; all: boolean };

const historyKey = "mynotes.notes-search";
const historyVersion = 1;
const MAX_QUERY_LENGTH = 200;

export type SearchHistoryState = {
  [historyKey]: { version: number; userId: string; hint: SearchHint };
};

export function withSearchHint(userId: string, hint: SearchHint | null, currentState: unknown): Record<string, unknown> {
  const base = currentState && typeof currentState === "object" ? { ...currentState as Record<string, unknown> } : {};
  if (!hint) {
    delete base[historyKey];
    return base;
  }
  return { ...base, [historyKey]: { version: historyVersion, userId, hint: { query: hint.query.slice(0, MAX_QUERY_LENGTH), all: hint.all } } };
}

export function readSearchHint(state: unknown, userId: string): SearchHint | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[historyKey];
  if (!value || typeof value !== "object") return null;
  const entry = value as { version?: unknown; userId?: unknown; hint?: unknown };
  if (entry.version !== historyVersion || entry.userId !== userId || !entry.hint || typeof entry.hint !== "object") return null;
  const hint = entry.hint as Partial<SearchHint>;
  if (typeof hint.query !== "string" || typeof hint.all !== "boolean") return null;
  return { query: hint.query.slice(0, MAX_QUERY_LENGTH), all: hint.all };
}

export function sameSearchHint(left: SearchHint | null, right: SearchHint | null) {
  if (!left || !right) return left === right;
  return left.query === right.query && left.all === right.all;
}

// What the current entry should record: the live search, or an empty hint once a search was
// cleared on an entry that already had one (so that entry is reused, not pushed again).
export function nextSearchHint(active: boolean, query: string, all: boolean, current: SearchHint | null): SearchHint | null {
  if (active) return { query, all };
  return current ? { query: "", all: false } : null;
}
