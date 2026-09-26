import { useEffect, useRef, useState } from "react";
import { readHistoryDepth } from "../appShellNavigation";
import { dialogPopDirection, registerHistoryDialogGuard, undoDialogPop, useDialogSentinel } from "../historyDialogs";

/** Tracks a CSS media query (the phone layout below 761 px, as everywhere in Nook). */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const PHONE_QUERY = "(max-width: 760px)";

/** What `onBack(true)` may return: "keep" when the user chose to stay on the open dialog. */
export type ForcedBackResult = "keep" | void;
type OnBack = (forced: boolean) => ForcedBackResult;

/**
 * One popstate while a dialog is open (see useDialogBackGuard). Returns true when the move was
 * handled here, so the route handlers must not follow it.
 */
export function guardDialogPop(openDepth: number, poppedState: unknown, onBack: OnBack, restoreUrl: () => void, undo: typeof undoDialogPop = undoDialogPop) {
  const direction = dialogPopDirection(openDepth, readHistoryDepth(poppedState));
  if (!direction) {
    if (onBack(true) !== "keep") return false;
    // L4: the user kept an edited sheet, so put the dialog's URL back on the entry moved to.
    restoreUrl();
    return true;
  }
  onBack(false);
  undo(direction);
  return true;
}

/**
 * D69 for the Calendar: dialogs and sheets push no history entry. While any is open, browser Back
 * or Forward calls `onBack` (which closes the top dialog) and the browser's move is undone with
 * history.go(). The event sheet's layers guard themselves (EventSheet.tsx). When the direction cannot be told,
 * `onBack(true)` must close everything and the route handlers follow the browser, unless it
 * returns "keep": then the dialog stays and its URL is restored with replaceState.
 */
export function useDialogBackGuard(active: boolean, onBack: OnBack) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const depthRef = useRef(0);
  const openEntryRef = useRef<{ url: string; state: unknown }>({ url: "", state: null });
  const wasActiveRef = useRef(false);
  if (active && !wasActiveRef.current && typeof window !== "undefined") {
    depthRef.current = readHistoryDepth(window.history.state);
    openEntryRef.current = { url: `${window.location.pathname}${window.location.search}${window.location.hash}`, state: window.history.state };
  }
  wasActiveRef.current = active;
  useDialogSentinel(active);
  useEffect(() => registerHistoryDialogGuard((poppedState) => {
    if (!activeRef.current) return false;
    return guardDialogPop(depthRef.current, poppedState, (forced) => onBackRef.current(forced), () => {
      window.history.replaceState(openEntryRef.current.state, "", openEntryRef.current.url);
    });
  }), []);
}
