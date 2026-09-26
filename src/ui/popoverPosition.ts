// Pure placement for the desktop dropdown popup (D114). The popup is `position: fixed` inside its
// owner's subtree (no portal, so dialog focus traps and aria-modal keep working), which lets it
// escape overflow clipping in scrolling grids. It opens below the trigger and flips above when the
// space below is short and there is more above.

export type Box = { top: number; left: number; width: number; height: number };
export type Placement = { top: number; left: number; minWidth: number; maxWidth: number; maxHeight: number; side: "below" | "above" };

export const POPUP_GAP = 4;
export const VIEWPORT_GUTTER = 8;
export const POPUP_MAX_HEIGHT = 320;
/** Below this many pixels of room the popup flips if the other side has more. */
export const POPUP_MIN_ROOM = 160;

export function placePopover(anchor: Box, popup: { width: number; height: number }, viewport: { width: number; height: number }): Placement {
  const below = viewport.height - (anchor.top + anchor.height) - POPUP_GAP - VIEWPORT_GUTTER;
  const above = anchor.top - POPUP_GAP - VIEWPORT_GUTTER;
  const wanted = Math.min(popup.height, POPUP_MAX_HEIGHT);
  const side = below >= wanted || below >= POPUP_MIN_ROOM || below >= above ? "below" : "above";
  const room = Math.max(0, side === "below" ? below : above);
  const maxHeight = Math.min(POPUP_MAX_HEIGHT, room);
  const height = Math.min(wanted, maxHeight);
  const maxWidth = Math.max(0, viewport.width - 2 * VIEWPORT_GUTTER);
  const minWidth = Math.min(anchor.width, maxWidth);
  const width = Math.min(Math.max(popup.width, minWidth), maxWidth);
  const left = Math.min(Math.max(anchor.left, VIEWPORT_GUTTER), Math.max(VIEWPORT_GUTTER, viewport.width - VIEWPORT_GUTTER - width));
  const top = side === "below" ? anchor.top + anchor.height + POPUP_GAP : anchor.top - POPUP_GAP - height;
  return { top, left, minWidth, maxWidth, maxHeight, side };
}

/**
 * Fixed positioning is relative to the viewport only when no ancestor has a transform (or filter,
 * or `contain`); otherwise that ancestor is the containing block and the popup lands offset by its
 * origin. After applying `intended`, the component measures where the popup really is and applies
 * this corrected position, which lands it on `intended` in either case.
 */
export function correctForContainingBlock(intended: { top: number; left: number }, measured: { top: number; left: number }) {
  return { top: intended.top - (measured.top - intended.top), left: intended.left - (measured.left - intended.left) };
}
