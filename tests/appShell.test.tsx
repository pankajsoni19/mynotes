import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountActions, AppHome } from "../src/AppShell";
import { BinApp } from "../src/bin/BinApp";

const account = { displayName: "Ada Lovelace", onSettings: () => undefined, onSignOut: () => undefined };

function accountButtons(markup: string) {
  const group = markup.match(/<div class="app-account" role="group" aria-label="Account">(.*?)<\/div>/)?.[1] ?? "";
  return [...group.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);
}

test("Home offers Settings, Bin, and Sign out in its header", () => {
  const markup = renderToStaticMarkup(<AppHome {...account} onOpen={() => undefined} />);
  // The header names the section only; the product name lives on the login page and the document title.
  expect(markup).toContain('<span class="brand-text"><strong>Home</strong></span>');
  expect(markup).not.toContain("<small>Nook</small>");
  const buttons = accountButtons(markup);
  expect(buttons).toHaveLength(3);
  expect(buttons[0]).toContain('aria-controls="account-settings-dialog"');
  expect(buttons[0]).toContain('aria-label="Open settings for Ada Lovelace"');
  expect(buttons[1]).toContain('title="Bin"');
  expect(buttons[1]).toContain('aria-label="Bin"');
  expect(buttons[2]).toContain('title="Sign out"');
  // The count badge waits for the lazy Bin fetch, so the first render has none.
  expect(markup).not.toContain("app-account-badge");
});

test("the Home Bin button shows a count badge only when the Bin has items", () => {
  const empty = renderToStaticMarkup(<AccountActions {...account} onBin={() => undefined} binCount={0} />);
  expect(empty).not.toContain("app-account-badge");
  const full = renderToStaticMarkup(<AccountActions {...account} onBin={() => undefined} binCount={3} />);
  expect(full).toContain('aria-label="Bin, 3 items"');
  expect(full).toContain('<span class="app-account-badge" aria-hidden="true">3</span>');
  expect(renderToStaticMarkup(<AccountActions {...account} onBin={() => undefined} binCount={140} />)).toContain(">99+</span>");
});

test("the Bin app offers Home and the same account actions", () => {
  const markup = renderToStaticMarkup(<BinApp {...account} flash={() => undefined} onHome={() => undefined} />);
  expect(accountButtons(markup)).toHaveLength(2);
  expect(markup).toContain(">Sign out</span>");
  expect(markup).toContain("<span class=\"brand-text\"><strong>Bin</strong></span>");
  expect(markup).not.toContain("<small>Nook</small>");
  expect(markup).toContain(">Home</button>");
  // Nothing is loaded yet, so the list shows its loading state and Empty Bin is disabled.
  expect(markup).toContain("Loading the Bin…");
  expect(markup).toMatch(/<button class="bin-empty-button" disabled="">/);
  for (const label of ["All", "Notes", "Files"]) expect(markup).toContain(`>${label}</button>`);
});

test("Home opens Files as a live app and keeps the Bin out of the grid", () => {
  const markup = renderToStaticMarkup(<AppHome {...account} onOpen={() => undefined} />);
  const files = markup.match(/<button class="app-card app-card-files">(.*?)<\/button>/)?.[1] ?? "";
  expect(files).toContain("Your workspace");
  expect(files).toContain("Upload, preview, and organize documents next to your notes.");
  expect(files).toContain("Open Files");
  expect(markup).not.toContain("app-card-bin");
  expect(markup).not.toContain("Open Bin");
});

test("Home opens Tasks as a live app", () => {
  const markup = renderToStaticMarkup(<AppHome {...account} onOpen={() => undefined} />);
  const tasks = markup.match(/<button class="app-card app-card-tasks">(.*?)<\/button>/)?.[1] ?? "";
  expect(tasks).toContain("Plan work on shared boards with draggable cards");
  expect(tasks).toContain("Open Tasks");
  expect([...markup.matchAll(/class="app-card app-card-(\w+)"/g)].map((match) => match[1])).toEqual(["notes", "files", "tasks"]);
});

test("account buttons have 44px hit areas on phones without growing the icon", async () => {
  const css = await Bun.file(new URL("../src/appShell.css", import.meta.url)).text();
  const phone = css.slice(css.indexOf("@media (max-width: 760px)"));
  expect(phone).toMatch(/\.app-account-button \{[^}]*width: 44px;[^}]*height: 44px;/);
  expect(css).toMatch(/\.app-account-button svg \{ width: 16px;/);
});
