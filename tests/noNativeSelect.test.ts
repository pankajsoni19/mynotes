import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

// D91: every dropdown is the shared Select or Combobox from src/ui. The last native select, the Tasks
// card dialog's assignee picker, moved to Combobox in Wave 13B, so nothing is allowlisted.
const allowlist = new Set<string>();
const root = join(import.meta.dir, "..", "src");

test("no native select outside src/ui", async () => {
  const offenders: string[] = [];
  for await (const path of new Glob("**/*.tsx").scan({ cwd: root })) {
    if (path.startsWith("ui/") || allowlist.has(path)) continue;
    const source = await Bun.file(join(root, path)).text();
    source.split("\n").forEach((line, index) => {
      if (/<select(\s|>|$)/.test(line)) offenders.push(`src/${path}:${index + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

test("the allowlist only names files that still have a native select", async () => {
  for (const path of allowlist) {
    const source = await Bun.file(join(root, path)).text();
    expect(/<select[\s>]/.test(source)).toBe(true);
  }
});
