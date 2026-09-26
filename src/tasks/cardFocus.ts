// Focus for a card on the board after something replaced the focused control (the composer closing,
// a move, a dialog closing). The card may not be rendered yet: React commits the state change that
// adds or moves it on its own schedule, which can land after a zero-delay timer. So the lookup is
// retried for a few frames instead of giving up and leaving focus on the page body.

export const CARD_FOCUS_FRAMES = 20;

type FocusScheduler = { later: (run: () => void) => void; nextFrame: (run: () => void) => void };

const browserScheduler: FocusScheduler = {
  later: (run) => { window.setTimeout(run, 0); },
  nextFrame: (run) => { window.requestAnimationFrame(() => run()); }
};

/** The card's own focus target: the open button of a table, list, or calendar row, else the lane card. */
export function findCardTarget(root: Pick<Document, "querySelector">, cardId: string) {
  const id = CSS.escape(cardId);
  return root.querySelector<HTMLElement>(`[data-open-card="${id}"]`) ?? root.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
}

/**
 * Focuses what `find` returns once it exists, trying after the current task and then on each of the
 * next `frames` animation frames. Returns a cancel function.
 */
export function focusWhenRendered(find: () => { focus: () => void } | null | undefined, scheduler: FocusScheduler = browserScheduler, frames = CARD_FOCUS_FRAMES) {
  let cancelled = false;
  let left = frames;
  const attempt = () => {
    if (cancelled) return;
    const target = find();
    if (target) {
      target.focus();
      return;
    }
    if (left-- > 0) scheduler.nextFrame(attempt);
  };
  scheduler.later(attempt);
  return () => { cancelled = true; };
}

/** Focuses a card on the board once it is rendered (see focusWhenRendered). */
export function focusBoardCard(cardId: string) {
  return focusWhenRendered(() => findCardTarget(window.document, cardId));
}
