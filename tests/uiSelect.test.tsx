import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { popStateClosedDialog, registerHistoryDialogGuard } from "../src/historyDialogs";
import { createDialogGuard } from "../src/ui/useHistoryDialogGuard";
import { Select, type Option } from "../src/ui/Select";

const colours: Option[] = [
  { value: "blue", label: "Blue", swatch: "blue" },
  { value: "green", label: "Green", swatch: "green", description: "Shared by Ada" },
  { value: "red", label: "Red", swatch: "red", disabled: true }
];
const noop = () => undefined;

test("the trigger is a select-only combobox with the chosen label and a swatch", () => {
  const markup = renderToStaticMarkup(<Select value="green" onChange={noop} options={colours} label="Colour" />);
  expect(markup).toContain('role="combobox"');
  expect(markup).toContain('aria-haspopup="listbox"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toMatch(/aria-controls="[^"]+-listbox"/);
  expect(markup).toContain('aria-label="Colour"');
  expect(markup).toContain('<span class="ui-option-swatch color-green" aria-hidden="true"></span>');
  expect(markup).toContain('<span class="ui-select-value">Green</span>');
  // No native select anywhere (D91), and the list is not rendered while closed.
  expect(markup).not.toContain("<select");
  expect(markup).not.toContain('role="listbox"');
});

test("an open popup lists options with selected, disabled, description, and the active descendant", () => {
  const markup = renderToStaticMarkup(<Select value="green" onChange={noop} options={colours} label="Colour" presentation="popup" defaultOpen />);
  expect(markup).toContain('aria-expanded="true"');
  expect(markup).toContain('role="listbox"');
  expect(markup).toContain('class="ui-popup"');
  expect(markup).toMatch(/role="option" aria-selected="true" class="ui-option active selected"/);
  expect(markup).toMatch(/role="option" aria-selected="false" aria-disabled="true"/);
  expect(markup).toContain("<small>Shared by Ada</small>");
  const active = /aria-activedescendant="([^"]+)"/.exec(markup)?.[1];
  expect(active).toBeTruthy();
  expect(markup).toContain(`id="${active}" role="option"`);
  // Not a sheet on desktop.
  expect(markup).not.toContain("ui-sheet");
});

test("the phone presentation is a bottom sheet dialog with a heading and a focusable list", () => {
  const markup = renderToStaticMarkup(<Select value="blue" onChange={noop} options={colours} label="Calendar" presentation="sheet" defaultOpen />);
  expect(markup).toContain('class="ui-sheet-layer"');
  expect(markup).toContain('role="dialog" aria-modal="true" aria-label="Calendar"');
  expect(markup).toContain("<strong>Calendar</strong>");
  expect(markup).toMatch(/role="listbox" aria-label="Calendar" class="ui-listbox" tabindex="-1" aria-activedescendant="[^"]+"/);
  expect(markup).not.toContain('class="ui-popup"');
});

test("the phone sheet's guard closes only the sheet on Back and undoes the move", () => {
  // The host dialog (a Calendar or Collections sheet) registered its guard first.
  let hostAsked = 0;
  const unregisterHost = registerHistoryDialogGuard(() => { hostAsked += 1; return true; });
  // The same guard DropdownSheet registers through useHistoryDialogGuard (D69).
  let open = true;
  let closed = 0;
  const undone: string[] = [];
  const unregisterSheet = registerHistoryDialogGuard(createDialogGuard({
    isOpen: () => open, markClosed: () => { open = false; }, close: () => { closed += 1; }, openDepth: () => 3, undo: (direction) => { undone.push(direction); }
  }));
  expect(popStateClosedDialog({ state: { "mynotes.depth": 2 } })).toBe(true);
  expect(closed).toBe(1);
  expect(undone).toEqual(["back"]);
  expect(hostAsked).toBe(0);
  // Once closed it passes the next Back on to the host.
  unregisterSheet();
  expect(popStateClosedDialog({ state: { "mynotes.depth": 2 } })).toBe(true);
  expect(hostAsked).toBe(1);
  unregisterHost();
  // Forward is undone the other way.
  open = true;
  const again = registerHistoryDialogGuard(createDialogGuard({
    isOpen: () => open, markClosed: () => { open = false; }, close: () => { closed += 1; }, openDepth: () => 3, undo: (direction) => { undone.push(direction); }
  }));
  expect(popStateClosedDialog({ state: { "mynotes.depth": 4 } })).toBe(true);
  expect(undone).toEqual(["back", "forward"]);
  again();
});

test("search appears above 8 options in auto mode and filters on the same labels", () => {
  const many: Option[] = Array.from({ length: 9 }, (_, index) => ({ value: `f${index}`, label: `Field ${index}` }));
  const markup = renderToStaticMarkup(<Select value="f1" onChange={noop} options={many} label="Sort 1 field" presentation="popup" defaultOpen />);
  expect(markup).toContain('type="search" role="combobox" aria-expanded="true" aria-autocomplete="list"');
  expect(markup).toContain('aria-label="Search Sort 1 field"');
  const few = renderToStaticMarkup(<Select value="f1" onChange={noop} options={many.slice(0, 8)} label="Sort 1 field" presentation="popup" defaultOpen />);
  expect(few).not.toContain('type="search"');
});

test("labels render as text, never markup (T98)", () => {
  const hostile: Option[] = [{ value: "x", label: '<img src=x onerror="alert(1)">', description: "<b>bold</b>" }];
  const markup = renderToStaticMarkup(<Select value="x" onChange={noop} options={hostile} label="Pick" presentation="popup" defaultOpen />);
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain("<b>");
  expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("placeholder, disabled, labelledBy, and the cell variant", () => {
  const markup = renderToStaticMarkup(<Select value={null} onChange={noop} options={colours} labelledBy="field-label" placeholder="—" variant="cell" disabled />);
  expect(markup).toContain('aria-labelledby="field-label"');
  expect(markup).not.toContain("aria-label=");
  expect(markup).toContain('data-placeholder="true"');
  expect(markup).toContain('class="ui-select ui-select-cell"');
  expect(markup).toContain("disabled");
  expect(markup).toContain(">—</span>");
});
