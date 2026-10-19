import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface ModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Shared dialog shell: bottom sheet on compact screens, centered card from `sm` up.
 * Passing `onSubmit` wraps body and footer in a form so Enter submits.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  description,
  icon,
  onClose,
  children,
  footer,
  onSubmit,
}) => {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const body = (
    <>
      <div className="p-5 sm:p-6 space-y-4">{children}</div>
      {footer && (
        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2">
          {footer}
        </div>
      )}
    </>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-xl"
          >
            <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {icon && (
                  <div className="w-9 h-9 rounded-xl border border-emerald-200/80 bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    {icon}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 id={titleId} className="text-base font-bold text-slate-900 font-display">
                    {title}
                  </h2>
                  {description && (
                    <p className="text-xs text-slate-500 mt-0.5">{description}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {onSubmit ? (
              <form onSubmit={onSubmit} noValidate>
                {body}
              </form>
            ) : (
              body
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
