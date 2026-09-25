import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppHome } from "../src/AppShell";
import { BinApp } from "../src/bin/BinApp";

const account = { displayName: "Ada Lovelace", onSettings: () => undefined, onSignOut: () => undefined };

function accountButtons(markup: string) {
  const group = markup.match(/<div class="app-account" role="group" aria-label="Account">(.*?)<\/div>/)?.[1] ?? "";
  return [...group.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);
}

test("Home offers Settings and Sign out in its header", () => {
  const buttons = accountButtons(renderToStaticMarkup(<AppHome {...account} onOpen={() => undefined} />));
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toContain('aria-controls="account-settings-dialog"');
  expect(buttons[0]).toContain('aria-label="Open settings for Ada Lovelace"');
  expect(buttons[1]).toContain('title="Sign out"');
});

test("the Bin app offers Home and the same account actions", () => {
  const markup = renderToStaticMarkup(<BinApp {...account} flash={() => undefined} onHome={() => undefined} />);
  expect(accountButtons(markup)).toHaveLength(2);
  expect(markup).toContain(">Sign out</span>");
  expect(markup).toContain("<small>MyNotes</small><strong>Bin</strong>");
  expect(markup).toContain(">Home</button>");
  // Nothing is loaded yet, so the list shows its loading state and Empty Bin is disabled.
  expect(markup).toContain("Loading the Bin…");
  expect(markup).toMatch(/<button class="bin-empty-button" disabled="">/);
  for (const label of ["All", "Notes", "Files"]) expect(markup).toContain(`>${label}</button>`);
});

test("Home opens Files and Bin as live apps", () => {
  const markup = renderToStaticMarkup(<AppHome {...account} onOpen={() => undefined} />);
  const files = markup.match(/<button class="app-card app-card-files">(.*?)<\/button>/)?.[1] ?? "";
  expect(files).toContain("Your workspace");
  expect(files).toContain("Upload, preview, and organize documents next to your notes.");
  expect(files).toContain("Open Files");
  const bin = markup.match(/<button class="app-card app-card-bin">(.*?)<\/button>/)?.[1] ?? "";
  expect(bin).toContain("Restore deleted notes and files for 30 days");
  expect(bin).toContain("Open Bin");
  expect(bin).not.toContain("Coming next");
});
