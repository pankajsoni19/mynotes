import { useEffect, useRef } from "react";
import { readHistoryDepth } from "../appShellNavigation";
import { dialogPopDirection, registerHistoryDialogGuard, undoDialogPop } from "../historyDialogs";

type Guard = (poppedState: unknown) => boolean;

// Tasks nests guards (the board's dialogs, the card view's unsaved-description prompt, a confirm
// inside the card). historyDialogs.ts keeps registered guards as a stack and asks the newest first,
// so each open piece registers its own guard and the innermost one closes first.

/**
 * D18 for the Tasks views: browser Back or Forward while `open` only runs `close` (closing a
 * dialog, or asking whether to discard changes). Dialogs push no history entry, so the browser's
 * move is undone with history.go(). Same contract as FilesApp.
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
  useEffect(() => {
    if (!open) return undefined;
    const guard: Guard = (poppedState) => {
      if (!openRef.current) return false;
      openRef.current = false;
      closeRef.current();
      const direction = dialogPopDirection(depthRef.current, readHistoryDepth(poppedState));
      // Direction unknown: let the route handlers follow the browser instead of leaving a stale URL.
      if (!direction) return false;
      undoDialogPop(direction);
      return true;
    };
    return registerHistoryDialogGuard(guard);
  }, [open]);
}
