import { useEffect, useState } from "react";
import { isSearchable, searchErrorMessage, searchNotes, SEARCH_DEBOUNCE_MS, type NoteSearchHit } from "./searchApi";

type Loaded = { key: string; status: "ready" | "error"; results: NoteSearchHit[]; truncated: boolean; error: string };
export type NoteSearchState = {
  active: boolean;
  status: "idle" | "loading" | "ready" | "error";
  results: NoteSearchHit[];
  truncated: boolean;
  error: string;
};

// Debounced full-text search. A newer query (or scope, or data refresh) aborts the request in
// flight. Results for the current query and scope stay on screen while a refresh for changed data
// runs; a new query shows "loading" so the caller can fall back to its instant title filter.
export function useNoteSearch(query: string, folder: string, refresh: unknown): NoteSearchState {
  const active = isSearchable(query);
  const key = active ? `${folder}\n${query}` : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!active) {
      setLoaded(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchNotes(query, folder, controller.signal)
        .then((response) => setLoaded({ key, status: "ready", results: response.results, truncated: response.truncated, error: "" }))
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setLoaded({ key, status: "error", results: [], truncated: false, error: searchErrorMessage(reason) });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `key` covers query and folder; `refresh` re-runs the search after the notes list changes.
  }, [active, key, refresh]);

  const current = loaded && loaded.key === key ? loaded : null;
  return {
    active,
    status: !active ? "idle" : current?.status ?? "loading",
    results: current?.results ?? [],
    truncated: current?.truncated ?? false,
    error: current?.error ?? ""
  };
}
