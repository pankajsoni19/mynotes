import { expect, test } from "bun:test";
import { acquireDialogSentinel, dialogSentinelState, isDialogSentinelState, needsDialogSentinel, popStateClosedDialog, registerHistoryDialogGuard, takeDialogSentinelEntry } from "../src/historyDialogs";

test("a sentinel is pushed only for a phone dialog opened at depth 0", () => {
  expect(needsDialogSentinel(null, { phone: true, active: false })).toBe(true);
  expect(needsDialogSentinel({ "mynotes.depth": 0 }, { phone: true, active: false })).toBe(true);
  // D18 unchanged: deeper entries push nothing, nor does the desktop, nor a second dialog.
  expect(needsDialogSentinel({ "mynotes.depth": 2 }, { phone: true, active: false })).toBe(false);
  expect(needsDialogSentinel(null, { phone: false, active: false })).toBe(false);
  expect(needsDialogSentinel(null, { phone: true, active: true })).toBe(false);
  expect(needsDialogSentinel(dialogSentinelState(null), { phone: true, active: false })).toBe(false);
});

test("the sentinel keeps the entry's state one level deeper with the dialog hint", () => {
  const state = dialogSentinelState({ route: "home" });
  expect(state).toEqual({ route: "home", "mynotes.dialog": true, "mynotes.depth": 1 });
  expect(isDialogSentinelState(state)).toBe(true);
  expect(isDialogSentinelState({ route: "home" })).toBe(false);
});

function fakeHistory(initial: unknown) {
  const entries: unknown[] = [initial];
  let index = 0;
  const history = {
    get state() { return entries[index]; },
    pushState(state: unknown) { entries.splice(index + 1, entries.length, state); index += 1; },
    back() { index -= 1; }
  };
  return { history, env: { history: history as unknown as History, href: () => "https://nook.test/", phone: () => true } };
}

test("closing the dialog by other means pops the sentinel and ignores that popstate", async () => {
  const { history, env } = fakeHistory({ route: "home" });
  const release = acquireDialogSentinel(env);
  expect(isDialogSentinelState(history.state)).toBe(true);
  // A second dialog replacing the first keeps the same sentinel.
  const second = acquireDialogSentinel(env);
  release();
  await Bun.sleep(5);
  expect(isDialogSentinelState(history.state)).toBe(true);
  second();
  await Bun.sleep(5);
  expect(history.state).toEqual({ route: "home" });
  // The popstate caused by history.back() is not a route change.
  expect(popStateClosedDialog({ state: history.state })).toBe(true);
  expect(popStateClosedDialog({ state: history.state })).toBe(false);
});

test("Back from the sentinel only closes the dialog, without undoing the move", async () => {
  const { history, env } = fakeHistory(null);
  let open = true;
  const unregister = registerHistoryDialogGuard(() => {
    if (!open) return false;
    open = false;
    return false; // Depths 0 and 0: direction unknown.
  });
  const release = acquireDialogSentinel(env);
  history.back();
  expect(popStateClosedDialog({ state: history.state })).toBe(true);
  expect(open).toBe(false);
  release();
  await Bun.sleep(5);
  // Nothing more to pop: a later, real navigation goes through.
  expect(history.state).toBeNull();
  expect(popStateClosedDialog({ state: null })).toBe(false);
  unregister();
});

// Like a browser: history.back() only moves (and updates state) when its popstate is delivered.
function asyncHistory(initial: unknown) {
  const entries: unknown[] = [initial];
  let index = 0;
  let pending = 0;
  const history = {
    get state() { return entries[index]; },
    pushState(state: unknown) { entries.splice(index + 1, entries.length, state); index += 1; },
    replaceState(state: unknown) { entries[index] = state; },
    back() { pending += 1; }
  };
  const deliver = () => {
    expect(pending).toBeGreaterThan(0);
    pending -= 1;
    index -= 1;
    return popStateClosedDialog({ state: entries[index] });
  };
  return { history, deliver, entries: () => entries.slice(0, index + 1), env: { history: history as unknown as History, href: () => "https://nook.test/", phone: () => true } };
}

test("a dialog opened before the sentinel's pop lands gets a sentinel once it has", async () => {
  const { history, deliver, entries, env } = asyncHistory({ route: "home" });
  const first = acquireDialogSentinel(env);
  first();
  await Bun.sleep(5);
  // history.back() is on its way; the state still reads the old sentinel.
  expect(isDialogSentinelState(history.state)).toBe(true);
  const second = acquireDialogSentinel(env);
  expect(entries()).toHaveLength(2);
  // The pop lands (ignored), then the new dialog's sentinel is pushed.
  expect(deliver()).toBe(true);
  expect(entries()).toEqual([{ route: "home" }, dialogSentinelState({ route: "home" })]);
  // Back now only closes the second dialog.
  let open = true;
  const unregister = registerHistoryDialogGuard(() => { open = false; return false; });
  history.back();
  expect(deliver()).toBe(true);
  expect(open).toBe(false);
  second();
  await Bun.sleep(5);
  expect(entries()).toEqual([{ route: "home" }]);
  unregister();
});

test("Back that closes the inner of two stacked dialogs re-arms the sentinel for the outer one", async () => {
  const { history, deliver, entries, env } = asyncHistory({ route: "collection", "mynotes.depth": 0 });
  const outer = acquireDialogSentinel(env);
  const inner = acquireDialogSentinel(env);
  expect(entries()).toHaveLength(2);
  let innerOpen = true;
  const unregister = registerHistoryDialogGuard(() => { if (!innerOpen) return false; innerOpen = false; return false; });
  // Back pops the sentinel and closes only the inner dialog (a dropdown sheet over a sheet).
  history.back();
  expect(deliver()).toBe(true);
  expect(innerOpen).toBe(false);
  inner();
  // The outer dialog is still open, so it holds a fresh sentinel: the next Back closes it in place.
  expect(entries()).toEqual([{ route: "collection", "mynotes.depth": 0 }, dialogSentinelState({ route: "collection", "mynotes.depth": 0 })]);
  unregister();
  outer();
  await Bun.sleep(5);
  expect(deliver()).toBe(true);
  expect(entries()).toEqual([{ route: "collection", "mynotes.depth": 0 }]);
});

test("an in-app navigation from the sentinel replaces it instead of stacking on it", async () => {
  const { history, entries, env } = asyncHistory({ route: "home", "mynotes.depth": 0 });
  const release = acquireDialogSentinel(env);
  expect(takeDialogSentinelEntry({ route: "home" })).toBe(false);
  // The app's navigation asks first, then replaces the sentinel at its depth.
  expect(takeDialogSentinelEntry(history.state)).toBe(true);
  history.replaceState({ route: "note", "mynotes.depth": 1 });
  expect(entries()).toEqual([{ route: "home", "mynotes.depth": 0 }, { route: "note", "mynotes.depth": 1 }]);
  // Asked again (or with no sentinel held), it is an ordinary push.
  expect(takeDialogSentinelEntry(history.state)).toBe(false);
  release();
  await Bun.sleep(5);
  // Closing the dialog pops nothing: the new route stays.
  expect(entries()).toHaveLength(2);
  expect(popStateClosedDialog({ state: history.state })).toBe(false);
});
