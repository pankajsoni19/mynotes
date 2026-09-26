import { expect, test } from "bun:test";
import { createOptionLoader } from "../src/ui/asyncOptions";
import {
  closedSelect, comboboxKey, filterOptions, foldText, groupRuns, moveActive, onlyEnabled, removeLastValue, selectKey, stepEnabled,
  toggleValue, typeaheadAppend, typeaheadMatch, wantsSearch, type NavOption
} from "../src/ui/listNavigation";
import { correctForContainingBlock, placePopover, POPUP_GAP } from "../src/ui/popoverPosition";

const opts = (...labels: string[]): NavOption[] => labels.map((label) => ({ value: label.toLowerCase().replace(/\W/g, "") || "x", label: label.replace(/^!/, ""), disabled: label.startsWith("!") }));

test("arrow keys, Home/End, and PageUp/PageDown skip disabled options and stop at the ends", () => {
  const list = opts("!Zero", "One", "!Two", "Three", "Four", "!Five");
  expect(moveActive(list, 1, "ArrowDown")).toBe(3);
  expect(moveActive(list, 3, "ArrowUp")).toBe(1);
  // No wrapping: the first and last enabled options hold.
  expect(moveActive(list, 1, "ArrowUp")).toBe(1);
  expect(moveActive(list, 4, "ArrowDown")).toBe(4);
  expect(moveActive(list, 3, "Home")).toBe(1);
  expect(moveActive(list, 1, "End")).toBe(4);
  expect(moveActive(list, -1, "ArrowDown")).toBe(1);
  expect(moveActive(list, -1, "ArrowUp")).toBe(4);
  const long = opts(...Array.from({ length: 25 }, (_, index) => index === 11 ? "!Skip" : `Item ${index}`));
  expect(moveActive(long, 0, "PageDown")).toBe(10);
  expect(moveActive(long, 10, "PageDown")).toBe(21);
  expect(moveActive(long, 24, "PageUp")).toBe(14);
  expect(moveActive(long, 3, "PageUp")).toBe(0);
  expect(stepEnabled(opts("!A", "!B"), 0, 1)).toBe(-1);
});

test("type-ahead matches prefixes, ignores case and accents, wraps, and cycles on a repeated letter", () => {
  const list = opts("Apple", "Banana", "blueberry", "!Blackberry", "Cherry", "Élan");
  expect(typeaheadMatch(list, -1, "b")).toBe(1);
  expect(typeaheadMatch(list, 1, "b")).toBe(2);
  // The disabled Blackberry is skipped and the search wraps.
  expect(typeaheadMatch(list, 2, "b")).toBe(1);
  expect(typeaheadMatch(list, 2, "bb")).toBe(1);
  expect(typeaheadMatch(list, 1, "bl")).toBe(2);
  expect(typeaheadMatch(list, 4, "el")).toBe(5);
  expect(typeaheadMatch(list, 0, "zz")).toBe(-1);
  expect(foldText("Élan")).toBe("elan");
  let buffer = typeaheadAppend({ buffer: "", at: 0 }, "b", 1000);
  buffer = typeaheadAppend(buffer, "l", 1200);
  expect(buffer.buffer).toBe("bl");
  expect(typeaheadAppend(buffer, "c", 1800).buffer).toBe("c");
});

test("the select reducer opens, moves, chooses, closes on Escape, and commits on Tab", () => {
  const list = opts("Daily", "Weekly", "!Monthly", "Yearly");
  let state = closedSelect();
  let result = selectKey(state, { key: "ArrowDown" }, list, 1, 0);
  expect(result).toMatchObject({ handled: true, state: { open: true, active: 1 } });
  state = result.state;
  result = selectKey(state, { key: "ArrowDown" }, list, 1, 0);
  expect(result.state.active).toBe(3);
  result = selectKey(result.state, { key: "Enter" }, list, 1, 0);
  expect(result).toMatchObject({ commit: 3, close: true, handled: true, state: { open: false } });
  // Escape closes without choosing, and is handled (preventDefault + stopPropagation).
  result = selectKey({ ...state, open: true }, { key: "Escape" }, list, 1, 0);
  expect(result).toMatchObject({ handled: true, close: true, state: { open: false } });
  expect(result.commit).toBeUndefined();
  // Tab chooses the active option and lets focus move on.
  result = selectKey({ ...state, open: true, active: 0 }, { key: "Tab" }, list, 1, 0);
  expect(result).toMatchObject({ handled: false, commit: 0, state: { open: false } });
  // Closed: typing opens on the match; Space opens; other keys are left alone.
  result = selectKey(closedSelect(), { key: "y" }, list, 0, 0);
  expect(result).toMatchObject({ handled: true, state: { open: true, active: 3 } });
  expect(selectKey(closedSelect(), { key: " " }, list, 0, 0).state.open).toBe(true);
  expect(selectKey(closedSelect(), { key: "Tab" }, list, 0, 0).handled).toBe(false);
  expect(selectKey(closedSelect(), { key: "c", ctrlKey: true }, list, 0, 0).handled).toBe(false);
  // Enter on a disabled option does nothing; Alt+ArrowUp chooses and closes.
  expect(selectKey({ ...state, open: true, active: 2 }, { key: "Enter" }, list, 0, 0).commit).toBeUndefined();
  expect(selectKey({ ...state, open: true, active: 1 }, { key: "ArrowUp", altKey: true }, list, 0, 0)).toMatchObject({ commit: 1, close: true });
  // While a search box has focus, Space and letters type instead of choosing.
  expect(selectKey({ ...state, open: true, active: 1 }, { key: " " }, list, 0, 0, true).handled).toBe(false);
  expect(selectKey({ ...state, open: true, active: 1 }, { key: "w" }, list, 0, 0, true).handled).toBe(false);
});

test("the multi reducer adds, removes, respects maxSelected, and Backspace removes the last chip", () => {
  expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
  expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  expect(toggleValue(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  expect(toggleValue(["a", "b"], "b", 2)).toEqual(["a"]);
  expect(removeLastValue(["a", "b"])).toEqual(["a"]);
  expect(removeLastValue([])).toEqual([]);
  const list = opts("Ada", "Grace", "!Linus");
  expect(comboboxKey({ open: false, active: -1 }, { key: "Backspace" }, list, { query: "", multiple: true, hasValues: true })).toMatchObject({ handled: true, removeLast: true });
  // Backspace with text edits the text.
  expect(comboboxKey({ open: true, active: 0 }, { key: "Backspace" }, list, { query: "a", multiple: true, hasValues: true }).handled).toBe(false);
  expect(comboboxKey({ open: false, active: -1 }, { key: "ArrowDown" }, list, { query: "", multiple: true, hasValues: false })).toMatchObject({ open: true, active: 0 });
  // Enter keeps the list open when choosing several, and closes it for one.
  expect(comboboxKey({ open: true, active: 1 }, { key: "Enter" }, list, { query: "", multiple: true, hasValues: false })).toMatchObject({ commit: 1, open: true });
  expect(comboboxKey({ open: true, active: 1 }, { key: "Enter" }, list, { query: "", multiple: false, hasValues: false })).toMatchObject({ commit: 1, open: false, close: true });
  expect(comboboxKey({ open: true, active: 2 }, { key: "Enter" }, list, { query: "", multiple: true, hasValues: false }).commit).toBeUndefined();
  expect(comboboxKey({ open: true, active: 1 }, { key: "Escape" }, list, { query: "", multiple: true, hasValues: false })).toMatchObject({ handled: true, close: true, open: false });
  // Home/End move the caret while closed, and the list while open.
  expect(comboboxKey({ open: false, active: -1 }, { key: "Home" }, list, { query: "ab", multiple: true, hasValues: false }).handled).toBe(false);
  expect(comboboxKey({ open: true, active: 0 }, { key: "End" }, list, { query: "", multiple: true, hasValues: false }).active).toBe(1);
});

test("Enter with text typed and nothing active picks the only match, or the Create row when nothing matches", () => {
  const one: NavOption[] = [{ value: "u1", label: "Asha" }];
  const context = { query: "as", multiple: true, hasValues: false };
  // An assignee search that loaded one person: Enter adds them without ArrowDown first.
  expect(comboboxKey({ open: true, active: -1 }, { key: "Enter" }, one, context)).toMatchObject({ handled: true, commit: 0, active: 0, open: true });
  expect(comboboxKey({ open: true, active: -1 }, { key: "Enter" }, one, { ...context, multiple: false })).toMatchObject({ commit: 0, close: true });
  // Only the Create row is left: Enter creates.
  const create: NavOption[] = [{ value: "\u0000create", label: "Create “Bug”" }];
  expect(comboboxKey({ open: true, active: -1 }, { key: "Enter" }, create, { ...context, query: "Bug" }).commit).toBe(0);
  // A disabled neighbour does not count: one enabled option is still the only choice.
  expect(comboboxKey({ open: true, active: -1 }, { key: "Enter" }, [{ value: "x", label: "Asher", disabled: true }, ...one], context).commit).toBe(1);
  // Two choices, no text, or a list still loading: Enter waits for a pick.
  const two: NavOption[] = [...one, { value: "u2", label: "Asif" }];
  expect(comboboxKey({ open: true, active: -1 }, { key: "Enter" }, two, context)).toEqual({ open: true, active: -1, handled: true });
  expect(comboboxKey({ open: true, active: -1 }, { key: "Enter" }, one, { ...context, query: "  " }).commit).toBeUndefined();
  expect(comboboxKey({ open: true, active: -1 }, { key: "Enter" }, one, { ...context, settled: false }).commit).toBeUndefined();
  expect(onlyEnabled(two)).toBe(-1);
  expect(onlyEnabled([])).toBe(-1);
});

test("filtering matches every word in labels and descriptions; groups, and auto search above 8 options", () => {
  const list: NavOption[] = [
    { value: "p", label: "Personal", description: "Yours" },
    { value: "w", label: "Work", description: "Shared by Zoë" },
    { value: "h", label: "Home café" }
  ];
  expect(filterOptions(list, "zoe").map((option) => option.value)).toEqual(["w"]);
  expect(filterOptions(list, "home cafe").map((option) => option.value)).toEqual(["h"]);
  expect(filterOptions(list, "  ")).toHaveLength(3);
  expect(wantsSearch("auto", 8)).toBe(false);
  expect(wantsSearch("auto", 9)).toBe(true);
  expect(wantsSearch(true, 2)).toBe(true);
  expect(wantsSearch(false, 50)).toBe(false);
  const runs = groupRuns([{ value: "a", label: "A", group: "Mine" }, { value: "b", label: "B", group: "Mine" }, { value: "c", label: "C", group: "Shared" }]);
  expect(runs.map((run) => [run.group, run.items.map((item) => item.index)])).toEqual([["Mine", [0, 1]], ["Shared", [2]]]);
});

test("popoverPosition opens below, flips above near the bottom, and clamps to the viewport", () => {
  const viewport = { width: 390, height: 844 };
  const below = placePopover({ top: 100, left: 20, width: 200, height: 40 }, { width: 150, height: 200 }, viewport);
  expect(below).toMatchObject({ side: "below", top: 140 + POPUP_GAP, left: 20, minWidth: 200 });
  const flipped = placePopover({ top: 760, left: 20, width: 200, height: 40 }, { width: 150, height: 300 }, viewport);
  expect(flipped.side).toBe("above");
  expect(flipped.top).toBe(760 - POPUP_GAP - 300);
  expect(flipped.top).toBeGreaterThanOrEqual(8);
  // A wide popup near the right edge is pulled back inside the 8 px gutter.
  const clamped = placePopover({ top: 100, left: 300, width: 80, height: 40 }, { width: 240, height: 100 }, viewport);
  expect(clamped.left + 240).toBeLessThanOrEqual(390 - 8);
  // Little room either way: the side with more room wins and the height is capped to it.
  const tight = placePopover({ top: 300, left: 0, width: 100, height: 40 }, { width: 100, height: 900 }, { width: 800, height: 400 });
  expect(tight.side).toBe("above");
  expect(tight.maxHeight).toBe(300 - POPUP_GAP - 8);
});

test("popoverPosition lands on target inside a transformed container", () => {
  // A dialog centred with translate(-50%, -50%) at (200, 150) is the containing block of its fixed
  // children, so top/left are measured from its corner. The correction cancels that origin.
  const origin = { top: 150, left: 200 };
  const intended = { top: 340, left: 260 };
  const measured = { top: intended.top + origin.top, left: intended.left + origin.left };
  const corrected = correctForContainingBlock(intended, measured);
  expect({ top: corrected.top + origin.top, left: corrected.left + origin.left }).toEqual(intended);
  // Un-transformed containers (the Wave 13 dialogs) need no correction.
  expect(correctForContainingBlock(intended, intended)).toEqual(intended);
});

test("async options are debounced, and a new request aborts the previous one", async () => {
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule = (run: () => void, ms: number) => {
    const timer = { run, ms, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  };
  const signals: AbortSignal[] = [];
  const resolvers: ((value: string[]) => void)[] = [];
  const results: [string, string[]][] = [];
  const loader = createOptionLoader((query, signal) => {
    signals.push(signal);
    return new Promise<string[]>((resolve) => resolvers.push(resolve)).then((items) => items.map((item) => `${query}:${item}`));
  }, { onResult: (query, result) => results.push([query, result]), onError: () => undefined }, { schedule });
  loader.request("a");
  loader.request("ad");
  // Typing within the debounce cancels the earlier timer; nothing was loaded for "a".
  expect(timers.map((timer) => [timer.ms, timer.cancelled])).toEqual([[200, true], [200, false]]);
  timers[1]!.run();
  loader.request("ada");
  timers[2]!.run();
  expect(signals[0]!.aborted).toBe(true);
  resolvers[0]!(["late"]);
  resolvers[1]!(["x"]);
  await Promise.resolve();
  await Promise.resolve();
  // The aborted "ad" answer is dropped even though it arrived.
  expect(results).toEqual([["ada", ["ada:x"]]]);
  loader.cancel();
  expect(signals[1]!.aborted).toBe(true);
});
