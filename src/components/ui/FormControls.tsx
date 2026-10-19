import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface ParsedOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

interface StyledSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  hint?: string;
  containerClassName?: string;
  icon?: React.ReactNode;
  onChange?: (e: { target: { value: string } }) => void;
}

export const StyledSelect: React.FC<StyledSelectProps> = ({
  label,
  hint,
  containerClassName = '',
  className = '',
  children,
  id,
  icon,
  value,
  defaultValue,
  disabled,
  onChange,
  'aria-label': ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo<ParsedOption[]>(() => {
    const list: ParsedOption[] = [];

    const extractText = (node: React.ReactNode): string => {
      if (node === null || node === undefined || typeof node === 'boolean') {
        return '';
      }
      if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
      }
      if (Array.isArray(node)) {
        return node.map(extractText).join('');
      }
      if (React.isValidElement(node)) {
        const elProps = node.props as { children?: React.ReactNode };
        return extractText(elProps.children);
      }
      return '';
    };

    const traverse = (nodes: React.ReactNode, currentGroup?: string) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;
        const childProps = child.props as {
          value?: string | number;
          disabled?: boolean;
          label?: string;
          children?: React.ReactNode;
        };

        if (child.type === React.Fragment) {
          traverse(childProps.children, currentGroup);
          return;
        }

        if (child.type === 'optgroup') {
          const groupLabel = childProps.label
            ? String(childProps.label).trim()
            : currentGroup;
          traverse(childProps.children, groupLabel);
          return;
        }

        if (child.type === 'option') {
          const textLabel = extractText(childProps.children).trim();
          const rawVal =
            childProps.value !== undefined
              ? String(childProps.value)
              : textLabel;
          list.push({
            value: rawVal,
            label: textLabel || rawVal,
            disabled: Boolean(childProps.disabled),
            group: currentGroup,
          });
        }
      });
    };

    traverse(children);
    return list;
  }, [children]);

  const currentVal =
    value !== undefined
      ? String(value)
      : defaultValue !== undefined
      ? String(defaultValue)
      : options[0]?.value ?? '';

  const selectedOption =
    options.find((opt) => opt.value === currentVal) || options[0] || null;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelectValue = (nextValue: string) => {
    if (disabled) return;
    onChange?.({ target: { value: nextValue } });
    setOpen(false);
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open && highlightedIndex >= 0 && options[highlightedIndex]) {
        const opt = options[highlightedIndex];
        if (!opt.disabled) {
          handleSelectValue(opt.value);
        }
      } else {
        const currentIdx = options.findIndex((o) => o.value === currentVal);
        setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
        setOpen((prev) => !prev);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        const currentIdx = options.findIndex((o) => o.value === currentVal);
        setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
        setOpen(true);
      } else {
        setHighlightedIndex((prev) =>
          prev + 1 < options.length ? prev + 1 : 0
        );
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        const currentIdx = options.findIndex((o) => o.value === currentVal);
        setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
        setOpen(true);
      } else {
        setHighlightedIndex((prev) =>
          prev - 1 >= 0 ? prev - 1 : options.length - 1
        );
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative ${open ? 'z-50' : 'z-auto'} flex flex-col gap-1.5 ${containerClassName}`}
    >
      {(label || hint) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label
              htmlFor={id}
              className="text-xs font-semibold text-slate-800 tracking-tight whitespace-nowrap"
            >
              {label}
            </label>
          )}
          {hint && (
            <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap truncate">
              {hint}
            </span>
          )}
        </div>
      )}
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 z-10">
            {icon}
          </div>
        )}
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel || label || 'Select option'}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (disabled) return;
            const currentIdx = options.findIndex((o) => o.value === currentVal);
            setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
            setOpen((prev) => !prev);
          }}
          onKeyDown={handleTriggerKeyDown}
          className={`w-full h-10 text-left ${
            icon ? 'pl-9' : 'pl-3.5'
          } pr-9 text-xs sm:text-sm font-semibold text-slate-900 bg-white border rounded-xl shadow-2xs transition-all flex items-center justify-between cursor-pointer ${
            open
              ? 'border-emerald-600 ring-3 ring-emerald-500/15'
              : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50/40'
          } disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed ${className}`}
        >
          <span className="truncate block">
            {selectedOption ? selectedOption.label : 'Select...'}
          </span>
          <span
            className={`pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-600 transition-transform duration-150 ${
              open ? 'rotate-180 text-emerald-600' : ''
            }`}
          >
            <ChevronDown className="w-4 h-4 shrink-0" />
          </span>
        </button>

        <AnimatePresence>
          {open && options.length > 0 && (
            <motion.div
              role="listbox"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-0 right-0 mt-1.5 z-50 bg-white border border-slate-200/95 rounded-xl shadow-xl shadow-slate-900/10 py-1.5 max-h-64 overflow-y-auto ring-1 ring-slate-900/5"
            >
              {options.map((opt, idx) => {
                const isSelected = opt.value === currentVal;
                const isHighlighted = idx === highlightedIndex;
                const showGroupHeader =
                  Boolean(opt.group) &&
                  (idx === 0 || options[idx - 1]?.group !== opt.group);

                return (
                  <React.Fragment key={`${opt.value}_${idx}`}>
                    {showGroupHeader && (
                      <div
                        className={`px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50/80 select-none ${
                          idx > 0 ? 'mt-1 border-t border-slate-100' : ''
                        }`}
                      >
                        {opt.group}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={opt.disabled}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => handleSelectValue(opt.value)}
                      className={`w-full px-3.5 py-2.5 text-left text-xs sm:text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        opt.disabled
                          ? 'text-slate-400 cursor-not-allowed'
                          : isSelected
                          ? 'bg-emerald-50/90 text-emerald-950 font-bold'
                          : isHighlighted
                          ? 'bg-slate-100/90 text-slate-900 font-semibold'
                          : 'text-slate-800 hover:bg-slate-50 font-medium'
                      }`}
                    >
                      <span className="break-words line-clamp-2">{opt.label}</span>
                      {isSelected && (
                        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                      )}
                    </button>
                  </React.Fragment>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

interface StyledInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  containerClassName?: string;
  icon?: React.ReactNode;
  prefixText?: string;
  suffixText?: string;
}

export const StyledInput: React.FC<StyledInputProps> = ({
  label,
  hint,
  containerClassName = '',
  className = '',
  id,
  icon,
  prefixText,
  suffixText,
  ...props
}) => {
  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {(label || hint) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label
              htmlFor={id}
              className="text-xs font-semibold text-slate-800 tracking-tight whitespace-nowrap"
            >
              {label}
            </label>
          )}
          {hint && (
            <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap truncate">
              {hint}
            </span>
          )}
        </div>
      )}
      <div className="relative flex items-center">
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
            {icon}
          </div>
        )}
        {prefixText && !icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-xs font-semibold text-slate-600 font-mono">
            {prefixText}
          </div>
        )}
        <input
          id={id}
          {...props}
          className={`w-full h-10 ${
            icon ? 'pl-9' : prefixText ? 'pl-7' : 'pl-3.5'
          } ${
            suffixText ? 'pr-10' : 'pr-3.5'
          } text-sm text-slate-900 bg-white border border-slate-300 rounded-xl shadow-2xs hover:border-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/15 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed ${className}`}
        />
        {suffixText && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold text-slate-600 font-mono">
            {suffixText}
          </div>
        )}
      </div>
    </div>
  );
};

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={`${
        fullWidth ? 'flex w-full' : 'inline-flex'
      } flex-wrap sm:flex-nowrap items-center bg-slate-200/80 p-1 rounded-xl border border-slate-300/80 max-w-full ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={(e) => {
              e.stopPropagation();
              if (opt.value !== value) {
                onChange(opt.value);
              }
            }}
            className={`relative ${
              fullWidth ? 'flex-1' : 'inline-flex'
            } items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-all cursor-pointer select-none ${
              size === 'sm'
                ? 'px-3 py-1.5 text-xs min-h-[32px]'
                : 'px-3.5 py-2 text-xs min-h-[36px]'
            } ${
              active
                ? 'bg-white text-slate-950 font-bold shadow-xs ring-1 ring-slate-900/10'
                : 'text-slate-700 hover:text-slate-950 hover:bg-white/50'
            }`}
          >
            <span className="pointer-events-none">{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={`pointer-events-none font-mono text-[11px] tabular-nums ${
                  active ? 'text-emerald-700 font-bold' : 'text-slate-600'
                }`}
              >
                · {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
  onCancel,
}) => {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  const handleConfirmClick = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  const confirmBtnStyles =
    variant === 'danger'
      ? 'bg-rose-600 hover:bg-rose-700 text-white'
      : variant === 'warning'
      ? 'bg-amber-600 hover:bg-amber-700 text-white'
      : 'bg-emerald-600 hover:bg-emerald-700 text-white';

  const iconBadgeStyles =
    variant === 'danger'
      ? 'bg-rose-50 text-rose-600 border-rose-200/80'
      : variant === 'warning'
      ? 'bg-amber-50 text-amber-700 border-amber-200/80'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200/80';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-5 sm:p-6 space-y-4 overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${iconBadgeStyles}`}
                >
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="space-y-1 min-w-0">
                  <h3
                    id="confirm-modal-title"
                    className="text-base font-bold text-slate-900 font-display"
                  >
                    {title}
                  </h3>
                  <div className="text-xs text-slate-600 leading-relaxed">
                    {description}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer shrink-0"
                aria-label="Close confirmation dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={onCancel}
                className="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmClick}
                className={`h-9 px-4 rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs ${confirmBtnStyles}`}
              >
                {submitting ? 'Processing...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

