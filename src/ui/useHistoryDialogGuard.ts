import { useEffect, useRef } from "react";
import { readHistoryDepth } from "../appShellNavigation";
import { dialogPopDirection, registerHistoryDialogGuard, undoDialogPop, useDialogSentinel } from "../historyDialogs";

type Guard = (poppedState: unknown) => boolean;

// Shared by Tasks, Today, and the dropdown sheets (src/ui). Tasks nests guards (the board's
// dialogs, the card view's unsaved-description prompt, a confirm inside the card), and a dropdown
// sheet opens over a Calendar or Collections sheet. historyDialogs.ts keeps registered guards as a
// stack and asks the newest first, so each open piece registers its own guard and the innermost one
// closes first.

/**
 * The guard for one open dialog: it runs `close` once, then undoes the browser's move back to the
 * entry at `openDepth`. `isOpen` and `markClosed` let a stale guard (already closed) pass the event on.
 */
export function createDialogGuard(options: { isOpen: () => boolean; markClosed: () => void; close: () => void; openDepth: () => number; undo?: typeof undoDialogPop }): Guard {
  return (poppedState) => {
    if (!options.isOpen()) return false;
    options.markClosed();
    options.close();
    const direction = dialogPopDirection(options.openDepth(), readHistoryDepth(poppedState));
    // Direction unknown: let the route handlers follow the browser instead of leaving a stale URL.
    if (!direction) return false;
    (options.undo ?? undoDialogPop)(direction);
    return true;
  };
}

/**
 * D18 and D69: browser Back or Forward while `open` only runs `close` (closing a dialog or sheet, or
 * asking whether to discard changes). Dialogs push no history entry, so the browser's move is undone
 * with history.go(). At depth 0 on a phone the dialog holds the sentinel entry (historyDialogs.ts).
 * Same contract as FilesApp.
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
  useDialogSentinel(open);
  useEffect(() => {
    if (!open) return undefined;
    return registerHistoryDialogGuard(createDialogGuard({
      isOpen: () => openRef.current,
      markClosed: () => { openRef.current = false; },
      close: () => closeRef.current(),
      openDepth: () => depthRef.current
    }));
  }, [open]);
}
