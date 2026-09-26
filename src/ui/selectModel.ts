/**
 * Pure keyboard model for src/ui/Select.tsx (D91), so the rules are unit-tested without a DOM.
 */
export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  /** One line under the label. */
  description?: string;
  disabled?: boolean;
};

/** The next enabled index from `from` in `step` direction, wrapping; `from` itself when nothing else is enabled. */
export function stepIndex(options: readonly SelectOption[], from: number, step: 1 | -1) {
  const count = options.length;
  if (count === 0) return -1;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + step * offset) % count) + count) % count;
    if (!options[index]!.disabled) return index;
  }
  return from;
}

/** The first (or last) enabled index, or -1. */
export function edgeIndex(options: readonly SelectOption[], edge: "first" | "last") {
  const indexes = options.map((_, index) => index);
  if (edge === "last") indexes.reverse();
  return indexes.find((index) => !options[index]!.disabled) ?? -1;
}

/** Where the highlight starts when the list opens: the selected option if enabled, else the first enabled one. */
export function initialIndex(options: readonly SelectOption[], value: string) {
  const selected = options.findIndex((option) => option.value === value);
  return selected >= 0 && !options[selected]!.disabled ? selected : edgeIndex(options, "first");
}

/**
 * Type-to-search: the next enabled option after `from` whose label starts with `query`
 * (case-insensitive), wrapping; -1 when none does.
 */
export function typeaheadIndex(options: readonly SelectOption[], from: number, query: string) {
  const needle = query.toLocaleLowerCase();
  if (!needle) return -1;
  const count = options.length;
  // A repeated single letter cycles through matches; a longer query refines from the current one.
  const start = needle.length > 1 ? from : from + 1;
  for (let offset = 0; offset < count; offset += 1) {
    const index = (((start + offset) % count) + count) % count;
    const option = options[index]!;
    if (!option.disabled && option.label.toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

export type SelectKeyAction =
  | { kind: "move"; index: number }
  | { kind: "choose"; index: number }
  | { kind: "close" }
  | { kind: "none" };

/** What a key does while the list is open. */
export function listKeyAction(key: string, options: readonly SelectOption[], active: number): SelectKeyAction {
  switch (key) {
    case "ArrowDown": return { kind: "move", index: stepIndex(options, active, 1) };
    case "ArrowUp": return { kind: "move", index: stepIndex(options, active, -1) };
    case "Home": return { kind: "move", index: edgeIndex(options, "first") };
    case "End": return { kind: "move", index: edgeIndex(options, "last") };
    case "Enter":
    case " ":
      return active >= 0 && !options[active]?.disabled ? { kind: "choose", index: active } : { kind: "none" };
    case "Escape":
    case "Tab":
      return { kind: "close" };
    default:
      return { kind: "none" };
  }
}
