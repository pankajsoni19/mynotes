import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api";
import { taskErrorCode, taskErrorMessage } from "../tasksApi";
import { queryTaskCards, viewCards, type QueriedCard, type QueryPage, type QueryRefs, type QueryRequest } from "./homeApi";

/** Where results come from: an ad hoc grammar query, or a saved view run as the viewer. */
export type CardSource =
  | { kind: "query"; request: Omit<QueryRequest, "cursor" | "limit"> }
  | { kind: "view"; viewId: string; tz: string };

export const PAGE_SIZE = 50;

export type CardQueryState = {
  cards: QueriedCard[];
  nextCursor: string | null;
  total?: number;
  refs?: QueryRefs;
  status: "idle" | "loading" | "ready" | "error";
  loadingMore: boolean;
  error: string | null;
  /** The server's code for a refused query (FILTER_INVALID, RATE_LIMITED, …). */
  errorCode?: string;
};

const idle: CardQueryState = { cards: [], nextCursor: null, status: "idle", loadingMore: false, error: null };

// Results of recently shown queries, so Back from a card returns to the same loaded pages ("Load
// more" included) instead of starting over. Five entries, two minutes each; per tab, never stored.
const CACHE_LIMIT = 5;
const CACHE_MS = 120_000;
const cache = new Map<string, { at: number; state: CardQueryState }>();

export const sourceKey = (source: CardSource | null) => source ? JSON.stringify(source) : "";

function remember(key: string, state: CardQueryState) {
  if (!key || state.status !== "ready") return;
  cache.delete(key);
  cache.set(key, { at: Date.now(), state });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

function cached(key: string) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit.state;
}

/** Test hook. */
export function clearCardQueryCache() {
  cache.clear();
}

function fetchPage(source: CardSource, cursor: string | undefined, signal: AbortSignal): Promise<QueryPage> {
  if (source.kind === "view") return viewCards(source.viewId, { cursor, limit: PAGE_SIZE, tz: source.tz }, signal);
  return queryTaskCards({ ...source.request, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }, signal);
}

function failure(reason: unknown): Pick<CardQueryState, "error" | "errorCode"> {
  const code = taskErrorCode(reason);
  if (reason instanceof ApiError && reason.status === 429) return { error: "Too many searches in a row. Wait a few seconds, then try again.", errorCode: "RATE_LIMITED" };
  return { error: taskErrorMessage(reason, "Could not load the cards"), errorCode: typeof code === "string" ? code : undefined };
}

/**
 * Runs a cross-board query with keyset pages: the first page on every source change, then "Load
 * more" with the signed cursor. `null` runs nothing (a view without a selective filter, Q11).
 */
export function useCardQuery(source: CardSource | null) {
  const key = sourceKey(source);
  const [state, setState] = useState<CardQueryState>(() => (key && cached(key)) || idle);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const current = sourceRef.current;
    if (!current) {
      setState(idle);
      return;
    }
    const hit = reload === 0 ? cached(key) : null;
    // A remembered result shows at once. With more than one page loaded it stays as it was (so the
    // pages Load more fetched are kept); a single page is refreshed quietly behind it.
    if (hit) {
      setState(hit);
      if (hit.cards.length > PAGE_SIZE) return;
    }
    const controller = new AbortController();
    if (!hit) setState({ ...idle, status: "loading" });
    fetchPage(current, undefined, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      const next: CardQueryState = { cards: page.cards, nextCursor: page.nextCursor, total: page.total, refs: page.refs, status: "ready", loadingMore: false, error: null };
      remember(key, next);
      setState(next);
    }, (reason) => {
      if (controller.signal.aborted) return;
      setState({ ...idle, status: "error", ...failure(reason) });
    });
    return () => controller.abort();
  }, [key, reload]);

  const loadMore = useCallback(async () => {
    const current = sourceRef.current;
    const startKey = keyRef.current;
    const cursor = stateRef.current.loadingMore ? null : stateRef.current.nextCursor;
    if (!current || !cursor) return;
    stateRef.current = { ...stateRef.current, loadingMore: true };
    setState((previous) => ({ ...previous, loadingMore: true, error: null }));
    try {
      const page = await fetchPage(current, cursor, new AbortController().signal);
      if (keyRef.current !== startKey) return;
      setState((previous) => {
        const seen = new Set(previous.cards.map((card) => card.id));
        const next: CardQueryState = { ...previous, cards: [...previous.cards, ...page.cards.filter((card) => !seen.has(card.id))], nextCursor: page.nextCursor, loadingMore: false };
        remember(startKey, next);
        return next;
      });
    } catch (reason) {
      if (keyRef.current !== startKey) return;
      setState((previous) => ({ ...previous, loadingMore: false, ...failure(reason) }));
    }
  }, []);

  /** Replaces one loaded card (after a move), keeping its place. */
  const patchCard = useCallback((cardId: string, change: Partial<QueriedCard>) => {
    setState((previous) => {
      const next = { ...previous, cards: previous.cards.map((card) => card.id === cardId ? { ...card, ...change } : card) };
      remember(keyRef.current, next);
      return next;
    });
  }, []);

  const retry = useCallback(() => setReload((value) => value + 1), []);

  return { ...state, loadMore, patchCard, retry };
}
