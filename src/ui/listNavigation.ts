// Pure list logic shared by Select and Combobox (D91): which option is active after a key, type-ahead,
// filtering, and multi-value edits. No DOM here, so every key path is unit-tested
// (tests/uiListNavigation.test.ts) and the components only map events onto these functions.

export type NavOption = { value: string; label: string; description?: string; disabled?: boolean; group?: string };

/** Case- and accent-insensitive form of a label, for type-ahead and filtering. */
export function foldText(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

export function firstEnabled(options: readonly NavOption[]) {
  return options.findIndex((option) => !option.disabled);
}

export function lastEnabled(options: readonly NavOption[]) {
  for (let index = options.length - 1; index >= 0; index -= 1) if (!options[index]!.disabled) return index;
  return -1;
}

/**
 * The next enabled option `steps` enabled options away from `from` in `direction`, without wrapping.
 * Stops at the last enabled option in that direction; -1 only when nothing is enabled.
 */
export function stepEnabled(options: readonly NavOption[], from: number, direction: 1 | -1, steps = 1) {
  if (from < 0 || from >= options.length) return direction === 1 ? firstEnabled(options) : lastEnabled(options);
  let result = options[from]!.disabled ? -1 : from;
  let left = steps;
  for (let index = from + direction; index >= 0 && index < options.length && left > 0; index += direction) {
    if (options[index]!.disabled) continue;
    result = index;
    left -= 1;
  }
  return result >= 0 ? result : direction === 1 ? lastEnabled(options) : firstEnabled(options);
}

export const PAGE_SIZE = 10;

export type NavKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp";

const navKeys = new Set<string>(["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]);
export const isNavKey = (key: string): key is NavKey => navKeys.has(key);

/** The active option after a navigation key. Disabled options are skipped. */
export function moveActive(options: readonly NavOption[], active: number, key: NavKey) {
  switch (key) {
    case "ArrowDown": return stepEnabled(options, active, 1);
    case "ArrowUp": return stepEnabled(options, active, -1);
    case "Home": return firstEnabled(options);
    case "End": return lastEnabled(options);
    case "PageDown": return stepEnabled(options, active, 1, PAGE_SIZE);
    case "PageUp": return stepEnabled(options, active, -1, PAGE_SIZE);
  }
}

/**
 * Type-ahead (APG): `buffer` is what was typed within the last half second. Repeating one letter
 * cycles through the options starting with it; a longer buffer keeps the current option while it
 * still matches. The search wraps. Returns -1 when nothing matches.
 */
export function typeaheadMatch(options: readonly NavOption[], active: number, buffer: string) {
  if (!buffer || !options.length) return -1;
  const folded = foldText(buffer);
  const repeated = folded.length > 1 && [...folded].every((char) => char === folded[0]);
  const needle = repeated ? folded[0]! : folded;
  // A fresh or cycling search starts after the active option; an extended one starts on it.
  const start = folded.length === 1 || repeated ? active + 1 : Math.max(active, 0);
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (start + offset + options.length) % options.length;
    const option = options[index]!;
    if (!option.disabled && foldText(option.label).startsWith(needle)) return index;
  }
  return -1;
}

export const TYPEAHEAD_RESET_MS = 500;

export type Typeahead = { buffer: string; at: number };

/** Appends a typed character, starting over after TYPEAHEAD_RESET_MS. */
export function typeaheadAppend(state: Typeahead, char: string, now: number): Typeahead {
  return { buffer: now - state.at > TYPEAHEAD_RESET_MS ? char : state.buffer + char, at: now };
}

/** True for a key that types a character (not a shortcut). */
export function isPrintableKey(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/** Options whose label or description contains every word of `query`, ignoring case and accents. */
export function filterOptions<T extends NavOption>(options: readonly T[], query: string): T[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((option) => {
    const haystack = foldText(`${option.label} ${option.description ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

/** "auto" shows a search box above this many options. */
export const AUTO_SEARCH_THRESHOLD = 8;

export function wantsSearch(searchable: boolean | "auto" | undefined, count: number) {
  return searchable === true || (searchable === "auto" && count > AUTO_SEARCH_THRESHOLD);
}

/** Contiguous runs of options with the same `group`, in order (a group heading per run). */
export function groupRuns<T extends NavOption>(options: readonly T[]) {
  const runs: { group: string | undefined; items: { option: T; index: number }[] }[] = [];
  options.forEach((option, index) => {
    const last = runs[runs.length - 1];
    if (last && last.group === option.group) last.items.push({ option, index });
    else runs.push({ group: option.group, items: [{ option, index }] });
  });
  return runs;
}

// ---- Select (single value) ----

export type SelectKeyInput = { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
export type SelectState = { open: boolean; active: number; typeahead: Typeahead };
export type SelectKeyResult = {
  state: SelectState;
  /** The key was used: the component calls preventDefault and stopPropagation. */
  handled: boolean;
  /** An option index to choose. */
  commit?: number;
  /** Close the popup and return focus to the trigger. */
  close?: boolean;
};

export const closedSelect = (): SelectState => ({ open: false, active: -1, typeahead: { buffer: "", at: 0 } });

/**
 * Keyboard for a select-only combobox (APG). Closed: ↓, ↑, Alt+↓, Enter, and Space open it on the
 * chosen option (↑ with nothing chosen opens on the last one), Home/End open on the first/last,
 * and typing opens it on the matching option. Open: ↑/↓, Home/End, PageUp/PageDown move; Enter or Space chooses; Escape
 * closes without choosing; Tab chooses the active option and lets focus move on; Alt+↑ chooses.
 * `selected` is the chosen option's index (-1 for none). `searching` is true while a search box has
 * focus, so Space and letters type into it instead.
 */
export function selectKey(state: SelectState, event: SelectKeyInput, options: readonly NavOption[], selected: number, now: number, searching = false): SelectKeyResult {
  const start = selected >= 0 && !options[selected]?.disabled ? selected : firstEnabled(options);
  if (!state.open) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      const active = event.key === "ArrowUp" && selected < 0 ? lastEnabled(options) : start;
      return { state: { ...state, open: true, active }, handled: true };
    }
    if (event.key === "Home" || event.key === "End") {
      return { state: { ...state, open: true, active: event.key === "Home" ? firstEnabled(options) : lastEnabled(options) }, handled: true };
    }
    if (isPrintableKey(event) && event.key !== " ") {
      const typeahead = typeaheadAppend(state.typeahead, event.key, now);
      const match = typeaheadMatch(options, selected, typeahead.buffer);
      return { state: { open: true, active: match >= 0 ? match : start, typeahead }, handled: true };
    }
    return { state, handled: false };
  }
  if (event.key === "Escape") return { state: { ...state, open: false }, handled: true, close: true };
  if (event.key === "ArrowUp" && event.altKey) return { state: { ...state, open: false }, handled: true, commit: state.active, close: true };
  if (isNavKey(event.key)) {
    return { state: { ...state, active: moveActive(options, state.active, event.key) }, handled: true };
  }
  if (event.key === "Enter" || (event.key === " " && !searching)) {
    if (state.active >= 0 && options[state.active]?.disabled) return { state, handled: true };
    return { state: { ...state, open: false }, handled: true, commit: state.active >= 0 ? state.active : undefined, close: true };
  }
  if (event.key === "Tab") {
    // Not handled: focus moves on as usual.
    return { state: { ...state, open: false }, handled: false, commit: state.active >= 0 && !options[state.active]?.disabled ? state.active : undefined };
  }
  if (!searching && isPrintableKey(event)) {
    const typeahead = typeaheadAppend(state.typeahead, event.key, now);
    const match = typeaheadMatch(options, state.active, typeahead.buffer);
    return { state: { ...state, active: match >= 0 ? match : state.active, typeahead }, handled: true };
  }
  return { state, handled: false };
}

// ---- Combobox (editable, single or multiple) ----

/** Adds `value` or removes it when already chosen; never goes past `max`. */
export function toggleValue<V extends string>(values: readonly V[], value: V, max = Infinity): V[] {
  if (values.includes(value)) return values.filter((item) => item !== value);
  if (values.length >= max) return [...values];
  return [...values, value];
}

export const removeLastValue = <V extends string>(values: readonly V[]): V[] => values.slice(0, -1);

export type ComboboxKeyResult = {
  open: boolean;
  active: number;
  handled: boolean;
  /** An option index to choose (toggle in multiple mode). */
  commit?: number;
  /** Backspace in an empty input removes the last chip. */
  removeLast?: boolean;
  close?: boolean;
};

/**
 * Keyboard for an editable combobox (APG list autocomplete). ↓ or Alt+↓ opens; ↑/↓, Home/End (only
 * while open, so the caret keys still work in the text otherwise), PageUp/PageDown move; Enter chooses
 * (and keeps the list open when `multiple`); Escape closes; Backspace in an empty input removes the
 * last chip; Tab closes and lets focus move on.
 */
export function comboboxKey(state: { open: boolean; active: number }, event: SelectKeyInput, options: readonly NavOption[], context: { query: string; multiple: boolean; hasValues: boolean }): ComboboxKeyResult {
  const { open, active } = state;
  if (event.key === "Backspace" && context.query === "" && context.hasValues) return { open, active, handled: true, removeLast: true };
  if (!open) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      return { open: true, active: event.key === "ArrowUp" ? lastEnabled(options) : firstEnabled(options), handled: true };
    }
    return { open, active, handled: false };
  }
  if (event.key === "Escape") return { open: false, active: -1, handled: true, close: true };
  if (event.key === "Tab") return { open: false, active: -1, handled: false, close: true };
  if (event.key === "ArrowUp" && event.altKey) return { open: false, active, handled: true, close: true };
  if (isNavKey(event.key)) return { open, active: moveActive(options, active, event.key), handled: true };
  if (event.key === "Enter") {
    if (active < 0 || options[active]?.disabled) return { open, active, handled: true };
    return { open: context.multiple, active, handled: true, commit: active, close: !context.multiple };
  }
  return { open, active, handled: false };
}
