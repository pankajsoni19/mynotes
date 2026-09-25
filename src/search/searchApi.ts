import { api, ApiError } from "../api";
import type { Visibility } from "../types";

// GET /api/search (docs/plan/API_CONTRACTS.md § Search). Highlights arrive as text segments, never HTML.
export type SearchSegment = { text: string; hit: boolean };
export type NoteSearchHit = {
  id: string;
  source: "published" | "draft";
  title: SearchSegment[];
  snippet: SearchSegment[];
  folder_id: string | null;
  owner_name: string;
  is_owner: 0 | 1;
  visibility: Visibility;
  updated_at: string;
};
export type NoteSearchResponse = { results: NoteSearchHit[]; truncated: boolean };

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 200;
export const SEARCH_DEBOUNCE_MS = 200;

// Full-text search starts once the trimmed query has two characters (code points, not UTF-16 units).
export function isSearchable(query: string) {
  return [...query.trim()].length >= SEARCH_MIN_CHARS;
}

export function searchPath(query: string, folder: string, limit = 20) {
  return `/search?${new URLSearchParams({ q: query.slice(0, SEARCH_MAX_CHARS), scope: "notes", folder, limit: String(limit) })}`;
}

export function searchNotes(query: string, folder: string, signal: AbortSignal) {
  return api<NoteSearchResponse>(searchPath(query, folder), { signal });
}

export function searchErrorMessage(reason: unknown) {
  if (reason instanceof ApiError && reason.status === 429) return "Searching too quickly. Wait a moment, then type again.";
  if (reason instanceof ApiError) return reason.message;
  return "Search is unavailable right now. Showing title matches.";
}
