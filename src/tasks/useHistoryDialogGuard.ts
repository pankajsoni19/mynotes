import { useEffect, useRef } from "react";
import { readHistoryDepth } from "../appShellNavigation";
import { dialogPopDirection, registerHistoryDialogGuard, undoDialogPop } from "../historyDialogs";

/**
 * D18 for the Tasks views: browser Back or Forward while a dialog or sheet is open only closes it.
 * Dialogs push no history entry, so the browser's move is undone with history.go(). Same contract
 * as FilesApp; the view on screen registers the guard.
 */
export function useHistoryDialogGuard(open: boolean, close: () => void) {
  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(close);
  closeRef.current = close;
  // The depth of the entry the dialog was opened on, to tell Back from Forward.
  const depthRef = useRef(0);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) depthRef.current = readHistoryDepth(window.history.state);
  wasOpenRef.current = open;
  // Registered only while open, so nested views (the card dialog over the board) each guard their
  // own dialogs and the most recently opened one wins.
  useEffect(() => {
    if (!open) return undefined;
    return registerHistoryDialogGuard((poppedState) => {
      if (!openRef.current) return false;
      openRef.current = false;
      closeRef.current();
      const direction = dialogPopDirection(depthRef.current, readHistoryDepth(poppedState));
      // Direction unknown: let the route handlers follow the browser instead of leaving a stale URL.
      if (!direction) return false;
      undoDialogPop(direction);
      return true;
    });
  }, [open]);
}
