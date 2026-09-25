import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilesApp } from "../src/files/FilesApp";

test("the Files workspace renders its rail, list, and phone panels before data loads", () => {
  const markup = renderToStaticMarkup(<FilesApp userId="u1" displayName="Ada Lovelace" navigate={() => undefined} flash={() => undefined} onHome={() => undefined} onSettings={() => undefined} onSignOut={() => undefined} />);
  expect(markup).toContain("<small>MyNotes</small><strong>Files</strong>");
  for (const label of ["Home", "All files", "Shared with me", "Loading files…", "Select a file"]) expect(markup).toContain(label);
  expect(markup).toContain('data-mobile-panel="folders"');
  expect(markup).toContain('aria-live="polite"');
  expect(markup).toContain('type="file" multiple=""');
  // Nothing to upload into until the folders are known.
  expect(markup).not.toContain(">Upload</button>");
});
