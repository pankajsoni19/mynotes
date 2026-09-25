// D18: browser Back/Forward while an in-app dialog or sheet is open only closes it. Dialogs push no
// history entry, so the open app registers a guard that closes its dialog (and restores the entry the
// browser just left). Every popstate handler asks first, so the first one to see the event runs the
// guard and the others skip it. Listener order on window is registration order, which is why this is
// a shared check instead of a capture-phase listener.

type DialogGuard = () => boolean;

let guard: DialogGuard | null = null;
const consumed = new WeakSet<object>();

/** Registers the guard for the dialogs of the app on screen. Returns the unregister function. */
export function registerHistoryDialogGuard(next: DialogGuard) {
  guard = next;
  return () => { if (guard === next) guard = null; };
}

/** True when this popstate only closed a dialog, so the caller must not restore a route for it. */
export function popStateClosedDialog(event: object) {
  if (consumed.has(event)) return true;
  if (!guard?.()) return false;
  consumed.add(event);
  return true;
}
