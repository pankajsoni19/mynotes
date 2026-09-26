import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CardDialog } from "../src/tasks/CardDialog";
import { CardPage } from "../src/tasks/CardPage";

const noop = () => undefined;
const props = {
  userId: "u1", cardId: "k1", columns: [], boardOwner: false, onClose: noop, onMissing: noop, onChanged: noop, onMove: noop,
  onDelete: async () => undefined, notify: noop
};

test("the dialog is modal with an Expand control; the page is not modal and has Collapse instead of Close", () => {
  const dialog = renderToStaticMarkup(<CardDialog {...props} onExpand={noop} />);
  expect(dialog).toContain('role="dialog"');
  expect(dialog).toContain('aria-modal="true"');
  expect(dialog).toContain('class="icon-button task-card-expand"');
  expect(dialog).toContain('aria-label="Open as page"');
  expect(dialog).toContain('aria-label="Close card"');
  expect(dialog).toContain("task-card-scrim");

  const page = renderToStaticMarkup(<CardDialog {...props} layout="page" onExpand={noop} onCollapse={noop} />);
  expect(page).toContain('class="task-card-dialog task-card-page"');
  expect(page).not.toContain('role="dialog"');
  expect(page).not.toContain("aria-modal");
  expect(page).not.toContain("task-card-scrim");
  expect(page).not.toContain("Open as page");
  expect(page).toContain('aria-label="Collapse to a dialog"');
  expect(page).not.toContain('aria-label="Close card"');
});

test("the page frame adds Back to board and keeps the same tree as the dialog host", () => {
  const on = renderToStaticMarkup(<CardPage enabled boardName={"Home & <b>"} onBackToBoard={noop}><p>card</p></CardPage>);
  expect(on).toContain('class="task-card-page-wrap"');
  expect(on).toContain('aria-label="Back to board Home &amp; &lt;b&gt;"');
  expect(on).toContain("<p>card</p>");
  const off = renderToStaticMarkup(<CardPage enabled={false} boardName="Home" onBackToBoard={noop}><p>card</p></CardPage>);
  expect(off).toBe('<div class="task-card-dialog-host"><p>card</p></div>');
});

test("Expand is hidden at phone width, where the dialog is already full screen (§11 Q6)", () => {
  const css = readFileSync(new URL("../src/tasks/tasks.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("/* The card as a full page"));
  expect(phone).toMatch(/@media \(max-width: 760px\) \{\s*\.task-card-expand \{ display: none; \}/);
});
