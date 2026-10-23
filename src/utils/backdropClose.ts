import type { MouseEvent } from 'react';

// Whether the latest mouse press began on the backdrop itself. Only one pointer interacts at a
// time, so one module-level flag is enough. Stays true for clicks that had no press (keyboard).
let pressBeganOnBackdrop = true;

/**
 * Props for a modal backdrop element that closes the modal only on a real click on the backdrop.
 * A plain `onClick` also fires when the user presses inside the modal (e.g. to highlight text),
 * drags out and releases over the backdrop, because the click lands on the common ancestor.
 */
export function backdropClose(onClose: () => void) {
  return {
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      pressBeganOnBackdrop = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const closes = e.target === e.currentTarget && pressBeganOnBackdrop;
      pressBeganOnBackdrop = true;
      if (closes) onClose();
    },
  };
}
