import type { MouseEvent } from 'react';

interface Dismissable {
  el: HTMLElement;
  close: () => void;
}

// Open dialogs that registered through backdropClose(), so Escape can close the topmost one.
const dismissables = new Set<Dismissable>();
let escapeListening = false;

function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  let top: Dismissable | null = null;
  for (const entry of dismissables) {
    if (!entry.el.isConnected) continue;
    // Later in the document (or nested deeper) means drawn on top of the earlier one
    if (!top || top.el.compareDocumentPosition(entry.el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      top = entry;
    }
  }
  if (!top) return;
  // An open dropdown or date picker inside the dialog takes the first Escape itself
  if (top.el.querySelector('[aria-expanded="true"]')) return;
  event.preventDefault();
  top.close();
}

// Whether the latest mouse press began on the backdrop itself. Only one pointer interacts at a
// time, so one module-level flag is enough. Stays true for clicks that had no press (keyboard).
let pressBeganOnBackdrop = true;

/**
 * Props for a modal backdrop element that closes the modal only on a real click on the backdrop.
 * A plain `onClick` also fires when the user presses inside the modal (e.g. to highlight text),
 * drags out and releases over the backdrop, because the click lands on the common ancestor.
 */
export function backdropClose(onClose: () => void) {
  let registered: Dismissable | null = null;
  return {
    // Registers the dialog for Escape-to-close while it is mounted
    ref: (el: HTMLElement | null) => {
      if (registered) {
        dismissables.delete(registered);
        registered = null;
      }
      if (!el) return;
      registered = { el, close: onClose };
      dismissables.add(registered);
      if (!escapeListening && typeof document !== 'undefined') {
        document.addEventListener('keydown', handleEscape);
        escapeListening = true;
      }
    },
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
