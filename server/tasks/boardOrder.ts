/**
 * Server-computed ordering for columns and cards (WAVES_7-9.md D40). Pure:
 * callers load the siblings, apply the plan, and hold the board lock.
 *
 * Positions are REAL. A new item goes to the midpoint of its neighbours, or
 * to last + POSITION_STEP at the bottom (POSITION_STEP when the list is
 * empty; half of the first position at the top). When the new gap to a
 * neighbour would drop below MIN_GAP, the whole list is renumbered to
 * POSITION_STEP, 2 × POSITION_STEP, … with the new item in place.
 */
export const POSITION_STEP = 1024;
export const MIN_GAP = 1e-6;

export type Positioned = { id: string; position: number };
/** `renumbered` lists new positions for every sibling when the list had to be renumbered, otherwise null. */
export type InsertPlan = { position: number; renumbered: Positioned[] | null };

/** Sort order used everywhere: position, then id as a stable tie-break. */
export const byPosition = (a: Positioned, b: Positioned) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Plans inserting one item among `siblings` (which must not contain the item).
 * `after`: undefined = bottom, null = top, an id = directly after that sibling.
 * Returns null when `after` names no sibling (a stale anchor).
 */
export function planInsert(siblings: readonly Positioned[], after: string | null | undefined): InsertPlan | null {
  const sorted = [...siblings].sort(byPosition);
  let index: number;
  if (after === undefined) index = sorted.length;
  else if (after === null) index = 0;
  else {
    const anchor = sorted.findIndex((item) => item.id === after);
    if (anchor < 0) return null;
    index = anchor + 1;
  }
  const previous = sorted[index - 1];
  const next = sorted[index];
  let position: number;
  if (!next) position = previous ? previous.position + POSITION_STEP : POSITION_STEP;
  else {
    const lower = previous ? previous.position : 0;
    position = lower + (next.position - lower) / 2;
    const gap = Math.min(position - lower, next.position - position);
    if (!(gap >= MIN_GAP) || !Number.isFinite(position)) return renumber(sorted, index);
  }
  if (!Number.isFinite(position) || position > Number.MAX_SAFE_INTEGER / 2) return renumber(sorted, index);
  return { position, renumbered: null };
}

function renumber(sorted: Positioned[], index: number): InsertPlan {
  const renumbered: Positioned[] = [];
  let slot = 1;
  let position = 0;
  for (let at = 0; at <= sorted.length; at += 1) {
    if (at === index) position = slot++ * POSITION_STEP;
    const item = sorted[at];
    if (item) renumbered.push({ id: item.id, position: slot++ * POSITION_STEP });
  }
  return { position, renumbered };
}
