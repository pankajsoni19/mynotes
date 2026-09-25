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

/**
 * D69 for the Calendar: dialogs and sheets push no history entry. While any is open, browser Back
 * or Forward calls `onBack` (which closes the top dialog, or asks "Discard changes?" for an edited
 * sheet) and the browser's move is undone with history.go(). When the direction cannot be told,
 * `onBack(true)` must close everything and the route handlers follow the browser.
 */
export function useDialogBackGuard(active: boolean, onBack: (forced: boolean) => void) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const depthRef = useRef(0);
  const wasActiveRef = useRef(false);
  if (active && !wasActiveRef.current && typeof window !== "undefined") depthRef.current = readHistoryDepth(window.history.state);
  wasActiveRef.current = active;
  useDialogSentinel(active);
  useEffect(() => registerHistoryDialogGuard((poppedState) => {
    if (!activeRef.current) return false;
    const direction = dialogPopDirection(depthRef.current, readHistoryDepth(poppedState));
    if (!direction) {
      onBackRef.current(true);
      return false;
    }
    onBackRef.current(false);
    undoDialogPop(direction);
    return true;
  }), []);
}
