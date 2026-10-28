/** Room kept between a floating panel and the screen edge. */
export const POPOVER_VIEWPORT_GUTTER = 12;

/**
 * Places a fixed panel under a trigger button with its right edge on the button's right edge,
 * then slides it back inside the screen. Anchoring by the right edge alone pushes a wide panel off
 * the left of a phone whenever the button is not near the right edge.
 */
export function anchorPanelBelow(
  trigger: { right: number; bottom: number },
  viewportWidth: number,
  maxWidth: number,
  gutter: number = POPOVER_VIEWPORT_GUTTER
): { top: number; left: number; width: number } {
  const width = Math.max(0, Math.min(maxWidth, viewportWidth - gutter * 2));
  const rightAligned = trigger.right - width;
  const left = Math.min(Math.max(rightAligned, gutter), viewportWidth - width - gutter);
  return {
    top: Math.max(8, Math.round(trigger.bottom + 8)),
    left: Math.round(left),
    width: Math.round(width),
  };
}
