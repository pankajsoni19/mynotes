import { expect, test } from "bun:test";
import { finalizeOpenNote } from "../src/noteFinalization";

function steps(options: { removed?: boolean; delta?: boolean; published?: boolean; publishError?: Error; removeError?: Error }) {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      hasPublishableDelta: options.delta ?? false,
      removeEmptyNewNote: async () => {
        calls.push("remove");
        if (options.removeError) throw options.removeError;
        return options.removed ?? false;
      },
      publish: async () => {
        calls.push("publish");
        if (options.publishError) throw options.publishError;
        return options.published ?? true;
      }
    }
  };
}

test("a blank never-published note is removed and never published", async () => {
  const { calls, steps: input } = steps({ removed: true, delta: true });
  expect(await finalizeOpenNote(input)).toBe("removed-empty");
  expect(calls).toEqual(["remove"]);
});

test("a changed draft is published after the blank-note check", async () => {
  const { calls, steps: input } = steps({ delta: true });
  expect(await finalizeOpenNote(input)).toBe("published");
  expect(calls).toEqual(["remove", "publish"]);
});

test("an unchanged note is left alone", async () => {
  const { calls, steps: input } = steps({ delta: false });
  expect(await finalizeOpenNote(input)).toBe("unchanged");
  expect(calls).toEqual(["remove"]);
});

test("a draft that turns out to match the published version reports unchanged", async () => {
  const { steps: input } = steps({ delta: true, published: false });
  expect(await finalizeOpenNote(input)).toBe("unchanged");
});

test("save, publish, and cleanup failures propagate so the caller can keep the note open", async () => {
  await expect(finalizeOpenNote(steps({ delta: true, publishError: new Error("Draft changed in another session") }).steps)).rejects.toThrow("Draft changed in another session");
  await expect(finalizeOpenNote(steps({ removeError: new Error("offline") }).steps)).rejects.toThrow("offline");
});
