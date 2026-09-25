import { expect, test } from "bun:test";
import { canPublish, finalizeOpenNote, mcpDraftBadge, shouldAutoPublish } from "../src/noteFinalization";

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

test("leaving a note auto-publishes only a draft edited in this session", () => {
  const base = { isOwner: true, sessionEdited: true, serverHasDelta: false, hasUnsavedChanges: false };
  expect(shouldAutoPublish({ ...base, hasUnsavedChanges: true })).toBe(true);
  expect(shouldAutoPublish({ ...base, serverHasDelta: true })).toBe(true);
  expect(shouldAutoPublish(base)).toBe(false);
  // A waiting draft (another session, or written by an MCP key) is left for an explicit Publish.
  expect(shouldAutoPublish({ ...base, sessionEdited: false, serverHasDelta: true })).toBe(false);
  expect(shouldAutoPublish({ ...base, isOwner: false, hasUnsavedChanges: true })).toBe(false);
});

test("the explicit Publish button is offered for any owner draft with a delta", () => {
  expect(canPublish({ isOwner: true, serverHasDelta: true, hasUnsavedChanges: false })).toBe(true);
  expect(canPublish({ isOwner: true, serverHasDelta: false, hasUnsavedChanges: true })).toBe(true);
  expect(canPublish({ isOwner: true, serverHasDelta: false, hasUnsavedChanges: false })).toBe(false);
  expect(canPublish({ isOwner: false, serverHasDelta: true, hasUnsavedChanges: true })).toBe(false);
});

test("an MCP-written draft is labelled with its key", async () => {
  expect(mcpDraftBadge("Laptop agent")).toBe("Draft by Laptop agent");
  expect(mcpDraftBadge(null)).toBeNull();
  expect(mcpDraftBadge(undefined)).toBeNull();
  // An unedited MCP draft is not published when the owner just looks at it and leaves.
  const calls: string[] = [];
  const outcome = await finalizeOpenNote({
    removeEmptyNewNote: async () => false,
    hasPublishableDelta: shouldAutoPublish({ isOwner: true, sessionEdited: false, serverHasDelta: true, hasUnsavedChanges: false }),
    publish: async () => { calls.push("publish"); return true; }
  });
  expect(outcome).toBe("unchanged");
  expect(calls).toEqual([]);
});
