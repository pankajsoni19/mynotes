// D18: browser Back/Forward while an in-app dialog or sheet is open only closes it. Dialogs push no
// history entry, so the open app registers a guard that closes its dialog and then undoes the
// browser's move with history.go(), whose own popstate is ignored once. Every popstate handler asks
// first, so the first one to see the event runs the guard and the others skip it. Listener order on
// window is registration order, which is why this is a shared check instead of a capture-phase listener.

/** Receives the state of the entry the browser moved to; returns true when it closed a dialog. */
type DialogGuard = (poppedState: unknown) => boolean;

// A stack: the app on screen registers one guard, and shared chrome (the notification bell's
// popover) may register another. The newest guard is asked first; the first to close a dialog wins.
const guards: DialogGuard[] = [];
let ignoring = 0;
let ignoreTimer: ReturnType<typeof setTimeout> | null = null;
const consumed = new WeakSet<object>();

/** Registers a guard for the dialogs of the app on screen (or shared chrome). Returns the unregister function. */
export function registerHistoryDialogGuard(next: DialogGuard) {
  guards.push(next);
  return () => {
    const index = guards.lastIndexOf(next);
    if (index >= 0) guards.splice(index, 1);
  };
}

function runGuards(state: unknown) {
  for (let index = guards.length - 1; index >= 0; index -= 1) if (guards[index]!(state)) return true;
  return false;
}

/** True when this popstate only closed a dialog (or undid that move), so the caller must not restore a route for it. */
export function popStateClosedDialog(event: { state?: unknown }) {
  if (consumed.has(event)) return true;
  if (ignoring > 0) {
    ignoring -= 1;
    consumed.add(event);
    return true;
  }
  if (!runGuards(event.state)) return false;
  consumed.add(event);
  return true;
}

export type PopDirection = "back" | "forward";

/**
 * Which way the browser moved, from the `mynotes.depth` of the entry the dialog was opened on and of
 * the entry it moved to. Null when the depths match and the direction cannot be told.
 */
export function dialogPopDirection(openDepth: number, poppedDepth: number): PopDirection | null {
  if (poppedDepth < openDepth) return "back";
  if (poppedDepth > openDepth) return "forward";
  return null;
}

/** The history.go() delta that returns to the entry the dialog was opened on. */
export const undoPopDelta = (direction: PopDirection) => direction === "back" ? 1 : -1;

/** Moves back to the dialog's entry and ignores the popstate that move causes. */
export function undoDialogPop(direction: PopDirection, go: (delta: number) => void = (delta) => window.history.go(delta)) {
  ignoring += 1;
  // A move that never fires popstate must not swallow a later, real one.
  if (ignoreTimer) clearTimeout(ignoreTimer);
  ignoreTimer = setTimeout(() => { ignoring = 0; ignoreTimer = null; }, 1000);
  go(undoPopDelta(direction));
}
