import { useEffect, useRef, type RefObject } from 'react';

/**
 * Dismisses a transient popover (a menu, a dropdown) while it is `open`: a press or tap anywhere
 * outside `containerRef`, focus moving outside it, or Escape. The press is not swallowed, so it
 * still reaches whatever was pressed (another tab, the bell, a button).
 *
 * Listens on `document`, not on a click-away layer: a `position: fixed` layer inside a header with
 * `backdrop-filter` is positioned against that header, so it never covered the page.
 */
export function useDismissOnOutside(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void
): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const dismissIfOutside = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      onDismissRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismissRef.current();
    };
    document.addEventListener('pointerdown', dismissIfOutside, true);
    document.addEventListener('focusin', dismissIfOutside, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismissIfOutside, true);
      document.removeEventListener('focusin', dismissIfOutside, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, containerRef]);
}
