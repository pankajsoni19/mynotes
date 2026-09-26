import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { isMobileViewport } from "../mobileNavigation";
import { initialIndex, listKeyAction, typeaheadIndex, type SelectOption } from "./selectModel";
import { useHistoryDialog } from "./useHistoryDialog";
import "./select.css";

export type { SelectOption } from "./selectModel";

type SelectProps<T extends string> = {
  /** The visible label; also names the listbox. */
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Keeps the label for assistive technology only. */
  hideLabel?: boolean;
  /** Shown under the trigger (for example why the control is disabled). */
  hint?: string;
  className?: string;
};

/**
 * The shared custom dropdown (DEVELOPMENT_PLAN D91): never a native <select>. A button opens an
 * accessible listbox, as a popover on desktop and a bottom sheet at phone width (≤760 px) with
 * 48 px rows. Keyboard: Arrow keys, Home/End, Enter or Space to choose, Escape or Tab to close, and
 * type-to-search. Back/Forward while it is open only closes it (useHistoryDialog).
 */
export function Select<T extends string>({ label, value, options, onChange, disabled = false, hideLabel = false, hint, className }: SelectProps<T>) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const buttonId = `${baseId}-button`;
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typedRef = useRef({ text: "", at: 0 });
  const selected = options.find((option) => option.value === value);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  function show() {
    if (disabled) return;
    setSheet(isMobileViewport());
    setActive(initialIndex(options, value));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  }

  useHistoryDialog(open, () => setOpen(false));

  // Focus the list when it opens, and keep the highlighted option in view.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  });

  // A click outside the popover closes it (the sheet has its own scrim).
  useEffect(() => {
    if (!open || sheet) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close, open, sheet]);

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
    }
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    // Keep keys away from the dialog underneath (its Escape would close it too).
    event.stopPropagation();
    const action = listKeyAction(event.key, options, active);
    if (action.kind === "move") {
      event.preventDefault();
      if (action.index >= 0) setActive(action.index);
      return;
    }
    if (action.kind === "choose") {
      event.preventDefault();
      choose(action.index);
      return;
    }
    if (action.kind === "close") {
      if (event.key === "Escape") event.preventDefault();
      close(event.key === "Escape");
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const time = Date.now();
      const typed = time - typedRef.current.at < 700 ? typedRef.current.text + event.key : event.key;
      typedRef.current = { text: typed, at: time };
      const match = typeaheadIndex(options, active, typed);
      if (match >= 0) setActive(match);
    }
  }

  const list = <ul
    ref={listRef}
    id={listId}
    className="ui-select-list"
    role="listbox"
    tabIndex={-1}
    aria-labelledby={labelId}
    aria-activedescendant={active >= 0 ? optionId(active) : undefined}
    onKeyDown={onListKeyDown}
  >
    {options.map((option, index) => <li
      key={option.value}
      id={optionId(index)}
      role="option"
      aria-selected={option.value === value}
      aria-disabled={option.disabled || undefined}
      className={`ui-select-option${index === active ? " active" : ""}${option.disabled ? " disabled" : ""}`}
      onMouseMove={() => { if (!option.disabled && index !== active) setActive(index); }}
      onClick={() => choose(index)}
    >
      <span className="ui-select-check" aria-hidden="true">{option.value === value && <Check />}</span>
      <span className="ui-select-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
    </li>)}
  </ul>;

  return <div ref={rootRef} className={`ui-select${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
    <span id={labelId} className={hideLabel ? "ui-select-label sr-only" : "ui-select-label"}>{label}</span>
    <button
      ref={triggerRef}
      id={buttonId}
      type="button"
      className="ui-select-trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-labelledby={`${labelId} ${buttonId}`}
      aria-describedby={hint ? hintId : undefined}
      disabled={disabled}
      onClick={() => (open ? close() : show())}
      onKeyDown={onTriggerKeyDown}
    >
      <span className="ui-select-value">{selected?.label ?? "Choose…"}</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {hint && <small id={hintId} className="ui-select-hint">{hint}</small>}
    {open && !sheet && <div className="ui-select-popover">{list}</div>}
    {open && sheet && <>
      <button type="button" className="panel-scrim ui-select-scrim" onClick={() => close()} aria-label={`Close ${label}`} tabIndex={-1} />
      <div className="ui-select-sheet" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <header><strong aria-hidden="true">{label}</strong><button type="button" className="icon-button" onClick={() => close()} aria-label={`Close ${label}`}><X /></button></header>
        {list}
      </div>
    </>}
  </div>;
}
