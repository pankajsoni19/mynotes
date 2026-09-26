import { useEffect, useRef } from "react";
import { readHistoryDepth } from "../appShellNavigation";
import { dialogPopDirection, registerHistoryDialogGuard, undoDialogPop, useDialogSentinel } from "../historyDialogs";

/**
 * D18 for one dialog, sheet, or popover: while `open`, browser Back/Forward only closes it (the move
 * is undone with history.go(), and a depth-0 entry on a phone gets the sentinel). Guards stack, so a
 * picker opened inside a dialog closes first. `close` may change between renders.
 */
export function useHistoryDialog(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useDialogSentinel(open);
  useEffect(() => {
    if (!open) return;
    const depth = readHistoryDepth(window.history.state);
    let active = true;
    const unregister = registerHistoryDialogGuard((poppedState) => {
      if (!active) return false;
      active = false;
      closeRef.current();
      const direction = dialogPopDirection(depth, readHistoryDepth(poppedState));
      // Direction unknown: let the route handlers follow the browser instead of leaving a stale URL.
      if (!direction) return false;
      undoDialogPop(direction);
      return true;
    });
    return () => {
      active = false;
      unregister();
    };
  }, [open]);
}
