import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface ParsedOption {
  value: string;
  label: string;
  disabled?: boolean;
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
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === 'option') {
        const props = child.props as {
          value?: string | number;
          disabled?: boolean;
          children?: React.ReactNode;
        };
        const rawVal =
          props.value !== undefined
            ? String(props.value)
            : String(props.children ?? '');
        const rawLabel =
          typeof props.children === 'string' ||
          typeof props.children === 'number'
            ? String(props.children)
            : Array.isArray(props.children)
            ? props.children.join('')
            : rawVal;
        list.push({
          value: rawVal,
          label: rawLabel.trim(),
          disabled: Boolean(props.disabled),
        });
      }
    });
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
    <div ref={containerRef} className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {(label || hint) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label
              htmlFor={id}
              className="text-xs font-medium text-slate-600 tracking-tight"
            >
              {label}
            </label>
          )}
          {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
        </div>
      )}
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 z-10">
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
          } pr-9 text-sm font-medium text-slate-900 bg-white border rounded-lg shadow-2xs transition-all flex items-center justify-between cursor-pointer ${
            open
              ? 'border-emerald-600 ring-3 ring-emerald-500/15'
              : 'border-slate-200/90 hover:border-slate-300'
          } disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${className}`}
        >
          <span className="truncate block">
            {selectedOption ? selectedOption.label : 'Select...'}
          </span>
          <span
            className={`pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-transform duration-150 ${
              open ? 'rotate-180 text-emerald-600' : ''
            }`}
          >
            <ChevronDown className="w-4 h-4 shrink-0" />
          </span>
        </button>

        {open && options.length > 0 && (
          <div
            role="listbox"
            className="absolute left-0 right-0 mt-1.5 z-50 bg-white border border-slate-200/95 rounded-xl shadow-lg shadow-slate-900/10 py-1.5 max-h-64 overflow-y-auto ring-1 ring-slate-900/5"
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === currentVal;
              const isHighlighted = idx === highlightedIndex;
              return (
                <button
                  key={`${opt.value}_${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => handleSelectValue(opt.value)}
                  className={`w-full px-3.5 py-2 text-left text-xs sm:text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    opt.disabled
                      ? 'text-slate-300 cursor-not-allowed'
                      : isSelected
                      ? 'bg-emerald-50/90 text-emerald-950 font-semibold'
                      : isHighlighted
                      ? 'bg-slate-100/90 text-slate-900 font-medium'
                      : 'text-slate-700 hover:bg-slate-50 font-medium'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && (
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
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
              className="text-xs font-medium text-slate-600 tracking-tight"
            >
              {label}
            </label>
          )}
          {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
        </div>
      )}
      <div className="relative flex items-center">
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
            {icon}
          </div>
        )}
        {prefixText && !icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-xs font-medium text-slate-400 font-mono">
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
          } text-sm text-slate-900 bg-white border border-slate-200/90 rounded-lg shadow-2xs hover:border-slate-300 focus:outline-none focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/15 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${className}`}
        />
        {suffixText && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-medium text-slate-400 font-mono">
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
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center bg-slate-100/90 p-1 rounded-lg border border-slate-200/70 shrink-0 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-all cursor-pointer select-none ${
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs'
            } ${
              active
                ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-900/5'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  active ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
