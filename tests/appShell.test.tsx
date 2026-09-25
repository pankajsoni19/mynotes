import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppHome, AppPlaceholder } from "../src/AppShell";

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

test("Files and Bin placeholders offer the same account actions", () => {
  for (const section of ["files", "bin"] as const) {
    const markup = renderToStaticMarkup(<AppPlaceholder {...account} section={section} onHome={() => undefined} onOpenNotes={() => undefined} />);
    expect(accountButtons(markup)).toHaveLength(2);
    expect(markup).toContain(">Sign out</span>");
  }
});
