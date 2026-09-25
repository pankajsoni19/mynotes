import { afterAll } from "bun:test";

// Runs once after every test file. See tests/support/harness.ts for why the
// harness cannot clean up from its own module scope.
afterAll(() => {
  (globalThis as { __mynotesHarnessCleanup?: () => void }).__mynotesHarnessCleanup?.();
});
