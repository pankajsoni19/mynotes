import { expect, test } from "bun:test";
import { CARD_FOCUS_FRAMES, focusWhenRendered } from "../src/tasks/cardFocus";

function fakeScheduler() {
  const queue: Array<() => void> = [];
  return { queue, scheduler: { later: (run: () => void) => { queue.push(run); }, nextFrame: (run: () => void) => { queue.push(run); } } };
}

test("the new card is focused once it renders, even a few frames after the composer closed", () => {
  const { queue, scheduler } = fakeScheduler();
  let rendered = false;
  let focused = 0;
  focusWhenRendered(() => rendered ? { focus: () => { focused += 1; } } : null, scheduler);
  // Nothing on the board yet: it tries again on the next frame instead of leaving focus on the body.
  queue.shift()!();
  queue.shift()!();
  expect(focused).toBe(0);
  rendered = true;
  queue.shift()!();
  expect(focused).toBe(1);
  expect(queue).toHaveLength(0);
});

test("the retries stop after a bounded number of frames, and a cancel stops them at once", () => {
  const { queue, scheduler } = fakeScheduler();
  let looked = 0;
  focusWhenRendered(() => { looked += 1; return null; }, scheduler);
  while (queue.length) queue.shift()!();
  expect(looked).toBe(CARD_FOCUS_FRAMES + 1);
  const second = fakeScheduler();
  let focused = false;
  const cancel = focusWhenRendered(() => ({ focus: () => { focused = true; } }), second.scheduler);
  cancel();
  while (second.queue.length) second.queue.shift()!();
  expect(focused).toBe(false);
});
