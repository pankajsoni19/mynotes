import { expect, test } from "bun:test";
import { acquireDialogSentinel, dialogSentinelState, isDialogSentinelState, needsDialogSentinel, popStateClosedDialog, registerHistoryDialogGuard } from "../src/historyDialogs";

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
