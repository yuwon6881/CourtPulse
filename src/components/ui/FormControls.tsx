import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Search,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { backdropClose } from '../../utils/backdropClose';

interface ParsedOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

interface DropdownPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  placement: 'below' | 'above';
}

const DROPDOWN_GAP = 6;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_VIEWPORT_MARGIN = 12;

// The listbox/popover is rendered in a portal with fixed positioning so it is never clipped by
// scrollable or overflow-hidden ancestors (e.g. modal bodies), and flips above the
// trigger when there is not enough room below.
function computeDropdownPosition(
  trigger: HTMLElement,
  preferredMinWidth = 240,
  desiredHeight = DROPDOWN_MAX_HEIGHT,
  fixedWidth?: number
): DropdownPosition {
  const rect = trigger.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const spaceBelow = viewportH - rect.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN;
  const spaceAbove = rect.top - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN;
  const placement =
    spaceBelow >= Math.min(desiredHeight, 220) || spaceBelow >= spaceAbove
      ? 'below'
      : 'above';
  const available = placement === 'below' ? spaceBelow : spaceAbove;
  const targetWidth = fixedWidth
    ? Math.min(fixedWidth, viewportW - 2 * DROPDOWN_VIEWPORT_MARGIN)
    : Math.max(
        rect.width,
        Math.min(preferredMinWidth, viewportW - 2 * DROPDOWN_VIEWPORT_MARGIN)
      );
  const left = Math.max(
    DROPDOWN_VIEWPORT_MARGIN,
    Math.min(rect.left, viewportW - targetWidth - DROPDOWN_VIEWPORT_MARGIN)
  );
  return {
    left,
    width: targetWidth,
    maxHeight: Math.max(140, Math.min(desiredHeight, available)),
    placement,
    ...(placement === 'below'
      ? { top: rect.bottom + DROPDOWN_GAP }
      : { bottom: viewportH - rect.top + DROPDOWN_GAP }),
  };
}

interface StyledSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  hint?: string;
  error?: string;
  helperText?: string;
  containerClassName?: string;
  icon?: React.ReactNode;
  onChange?: (e: { target: { value: string } }) => void;
}

export const StyledSelect: React.FC<StyledSelectProps> = ({
  label,
  hint,
  error,
  helperText,
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
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

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

  const showSearch = options.length > 8;

  const filteredOptions = useMemo(() => {
    if (!showSearch || !searchQuery.trim()) return options;
    const q = searchQuery.trim().toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.group && opt.group.toLowerCase().includes(q))
    );
  }, [options, showSearch, searchQuery]);

  const currentVal =
    value !== undefined
      ? String(value)
      : defaultValue !== undefined
      ? String(defaultValue)
      : options[0]?.value ?? '';

  const selectedOption =
    options.find((opt) => opt.value === currentVal) || options[0] || null;

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      setSearchQuery('');
      return;
    }
    const update = () => {
      if (triggerRef.current) {
        setPosition(
          computeDropdownPosition(
            triggerRef.current,
            240,
            showSearch ? 320 : DROPDOWN_MAX_HEIGHT
          )
        );
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, showSearch]);

  useEffect(() => {
    if (!open || highlightedIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-option-index="${highlightedIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightedIndex, position]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
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
      if (open && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        const opt = filteredOptions[highlightedIndex];
        if (!opt.disabled) {
          handleSelectValue(opt.value);
        }
      } else {
        const currentIdx = filteredOptions.findIndex(
          (o) => o.value === currentVal
        );
        setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
        setOpen((prev) => !prev);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        const currentIdx = filteredOptions.findIndex(
          (o) => o.value === currentVal
        );
        setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
        setOpen(true);
      } else if (filteredOptions.length > 0) {
        setHighlightedIndex((prev) =>
          prev + 1 < filteredOptions.length ? prev + 1 : 0
        );
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        const currentIdx = filteredOptions.findIndex(
          (o) => o.value === currentVal
        );
        setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
        setOpen(true);
      } else if (filteredOptions.length > 0) {
        setHighlightedIndex((prev) =>
          prev - 1 >= 0 ? prev - 1 : filteredOptions.length - 1
        );
      }
    } else if (e.key === 'Home' && open && filteredOptions.length > 0) {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === 'End' && open && filteredOptions.length > 0) {
      e.preventDefault();
      setHighlightedIndex(filteredOptions.length - 1);
    }
  };

  const hasError = Boolean(error && error.trim());

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
              className={`text-xs font-semibold tracking-tight whitespace-nowrap ${
                hasError ? 'text-rose-700' : 'text-slate-800'
              }`}
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
          <div
            className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 z-10 transition-colors ${
              hasError
                ? 'text-rose-500'
                : open
                ? 'text-emerald-600'
                : 'text-slate-500'
            }`}
          >
            {icon}
          </div>
        )}
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          title={selectedOption ? selectedOption.label : undefined}
          aria-label={ariaLabel || label || 'Select option'}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={hasError || undefined}
          onClick={() => {
            if (disabled) return;
            const currentIdx = options.findIndex((o) => o.value === currentVal);
            setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
            setOpen((prev) => !prev);
          }}
          onKeyDown={handleTriggerKeyDown}
          className={`w-full h-10 text-left ${
            icon ? 'pl-9' : 'pl-3.5'
          } pr-9 text-xs sm:text-sm font-semibold text-slate-900 bg-white border rounded-xl shadow-2xs transition-all flex items-center justify-between cursor-pointer active:scale-[0.99] focus-visible:outline-none ${
            hasError
              ? 'border-rose-500 bg-rose-50/20 ring-3 ring-rose-500/10'
              : open
              ? 'border-emerald-600 ring-3 ring-emerald-500/15'
              : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50/40 focus-visible:border-emerald-600 focus-visible:ring-3 focus-visible:ring-emerald-500/15'
          } disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed disabled:active:scale-100 ${className}`}
        >
          <span className="truncate block">
            {selectedOption ? selectedOption.label : 'Select...'}
          </span>
          <span
            className={`pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 transition-transform duration-150 ${
              hasError
                ? 'text-rose-600'
                : open
                ? 'rotate-180 text-emerald-600'
                : 'text-slate-600'
            }`}
          >
            <ChevronDown className="w-4 h-4 shrink-0" />
          </span>
        </button>

        {typeof document !== 'undefined' &&
          createPortal(
            <AnimatePresence>
              {open && position && options.length > 0 && (
                <motion.div
                  ref={listRef}
                  role="listbox"
                  initial={{
                    opacity: 0,
                    y: position.placement === 'below' ? -4 : 4,
                    scale: 0.98,
                  }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    y: position.placement === 'below' ? -4 : 4,
                    scale: 0.98,
                  }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: 'fixed',
                    left: position.left,
                    width: position.width,
                    top: position.top,
                    bottom: position.bottom,
                    maxHeight: position.maxHeight,
                  }}
                  className="z-[100] bg-white border border-slate-200/95 rounded-xl shadow-xl shadow-slate-900/10 flex flex-col overflow-hidden ring-1 ring-slate-900/5"
                >
                  {showSearch && (
                    <div className="p-2 border-b border-slate-100 bg-slate-50/70 shrink-0">
                      <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                        <input
                          ref={searchInputRef}
                          type="text"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setHighlightedIndex(0);
                          }}
                          placeholder="Filter options..."
                          className="w-full h-8 pl-8 pr-7 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              searchInputRef.current?.focus();
                            }}
                            className="absolute right-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                            aria-label="Clear filter"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="py-1.5 overflow-y-auto overscroll-contain flex-1">
                    {filteredOptions.length === 0 ? (
                      <div className="px-3.5 py-4 text-center text-xs text-slate-400">
                        No matching options
                      </div>
                    ) : (
                      filteredOptions.map((opt, idx) => {
                        const isSelected = opt.value === currentVal;
                        const isHighlighted = idx === highlightedIndex;
                        const showGroupHeader =
                          Boolean(opt.group) &&
                          (idx === 0 ||
                            filteredOptions[idx - 1]?.group !== opt.group);

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
                              data-option-index={idx}
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
                              <span className="break-words line-clamp-2">
                                {opt.label}
                              </span>
                              {isSelected && (
                                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                              )}
                            </button>
                          </React.Fragment>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
      </div>
      <AnimatePresence initial={false}>
        {hasError ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14 }}
            role="alert"
            className="flex items-start gap-1.5 text-[11px] font-semibold text-rose-600 leading-snug pt-0.5"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        ) : helperText ? (
          <p className="text-[11px] text-slate-500 leading-snug pt-0.5">
            {helperText}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// Custom Interactive Calendar Dropdown (Replaces native HTML <input type="date">)
// ============================================================================

const WEEKDAY_SHORT_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getLocalTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDateParts(iso: string): {
  year: number;
  month: number; // 0-indexed
  day: number;
} | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return null;
  const [yStr, mStr, dStr] = iso.trim().split('-');
  const year = Number(yStr);
  const month = Number(mStr) - 1;
  const day = Number(dStr);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const dt = new Date(year, month, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function toIsoDateString(year: number, monthZeroIndexed: number, day: number): string {
  const dt = new Date(year, monthZeroIndexed, day);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToIso(baseIso: string, deltaDays: number): string {
  const parts = parseIsoDateParts(baseIso);
  if (!parts) return getLocalTodayIso();
  return toIsoDateString(parts.year, parts.month, parts.day + deltaDays);
}

function formatDateTriggerDisplay(iso: string): {
  primary: string;
  weekday: string;
  iso: string;
} | null {
  const parts = parseIsoDateParts(iso);
  if (!parts) return null;
  const dt = new Date(parts.year, parts.month, parts.day);
  const weekday = WEEKDAY_SHORT_NAMES[dt.getDay()];
  const monthShort = MONTH_SHORT_NAMES[parts.month];
  return {
    primary: `${monthShort} ${parts.day}, ${parts.year}`,
    weekday,
    iso,
  };
}

interface CalendarDayCell {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
}

export interface StyledDatePickerProps {
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  helperText?: string;
  value?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  containerClassName?: string;
  className?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const StyledDatePicker: React.FC<StyledDatePickerProps> = ({
  id,
  label,
  hint,
  error,
  helperText,
  value = '',
  min,
  max,
  disabled = false,
  placeholder = 'Select date...',
  containerClassName = '',
  className = '',
  onChange,
}) => {
  const todayIso = useMemo(() => getLocalTodayIso(), []);
  const parsedValue = useMemo(() => parseIsoDateParts(value), [value]);
  const parsedToday = useMemo(
    () => parseIsoDateParts(todayIso) || { year: 2026, month: 0, day: 1 },
    [todayIso]
  );

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState<number>(
    parsedValue?.year ?? parsedToday.year
  );
  const [viewMonth, setViewMonth] = useState<number>(
    parsedValue?.month ?? parsedToday.month
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  useEffect(() => {
    if (parsedValue) {
      setViewYear(parsedValue.year);
      setViewMonth(parsedValue.month);
    }
  }, [parsedValue?.year, parsedValue?.month]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      if (triggerRef.current) {
        setPosition(computeDropdownPosition(triggerRef.current, 296, 376, 304));
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
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

  const isDateDisabled = (iso: string): boolean => {
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  };

  const emitDateChange = (nextIso: string) => {
    if (disabled || isDateDisabled(nextIso)) return;
    const syntheticEvent = {
      target: { value: nextIso },
      currentTarget: { value: nextIso },
    } as React.ChangeEvent<HTMLInputElement>;
    onChange?.(syntheticEvent);
    setOpen(false);
  };

  const calendarDays = useMemo<CalendarDayCell[]>(() => {
    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: CalendarDayCell[] = [];

    // Leading days from previous month
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const iso = toIsoDateString(viewYear, viewMonth - 1, dayNum);
      cells.push({
        iso,
        day: dayNum,
        inCurrentMonth: false,
        isToday: iso === todayIso,
        isSelected: iso === value,
        isDisabled: isDateDisabled(iso),
      });
    }

    // Current month days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const iso = toIsoDateString(viewYear, viewMonth, dayNum);
      cells.push({
        iso,
        day: dayNum,
        inCurrentMonth: true,
        isToday: iso === todayIso,
        isSelected: iso === value,
        isDisabled: isDateDisabled(iso),
      });
    }

    // Trailing days to complete 42 cells (6 weeks) for stable popover height
    const remaining = 42 - cells.length;
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
      const iso = toIsoDateString(viewYear, viewMonth + 1, dayNum);
      cells.push({
        iso,
        day: dayNum,
        inCurrentMonth: false,
        isToday: iso === todayIso,
        isSelected: iso === value,
        isDisabled: isDateDisabled(iso),
      });
    }

    return cells;
  }, [viewYear, viewMonth, todayIso, value, min, max]);

  // Context-aware quick presets:
  // If `max` restricts future dates (e.g. restring/grip log dates), offer past shortcuts.
  // Otherwise offer upcoming session scheduling shortcuts.
  const quickPresets = useMemo(() => {
    const isPastBounded = Boolean(max && max <= todayIso);
    const rawPresets: { label: string; iso: string }[] = isPastBounded
      ? [
          { label: 'Today', iso: todayIso },
          { label: 'Yesterday', iso: addDaysToIso(todayIso, -1) },
          { label: '3d ago', iso: addDaysToIso(todayIso, -3) },
          { label: '1w ago', iso: addDaysToIso(todayIso, -7) },
        ]
      : (() => {
          const todayParts = parseIsoDateParts(todayIso);
          const todayDow = todayParts
            ? new Date(
                todayParts.year,
                todayParts.month,
                todayParts.day
              ).getDay()
            : 0;
          const daysUntilSat = (6 - todayDow + 7) % 7 || 7;
          return [
            { label: 'Today', iso: todayIso },
            { label: 'Tomorrow', iso: addDaysToIso(todayIso, 1) },
            { label: 'Next Sat', iso: addDaysToIso(todayIso, daysUntilSat) },
            {
              label: '+1 Week',
              iso: addDaysToIso(value || todayIso, 7),
            },
          ];
        })();

    return rawPresets.filter((p) => !isDateDisabled(p.iso));
  }, [todayIso, max, min, value]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const hasError = Boolean(error && error.trim());
  const errorId = id ? `${id}-error` : undefined;
  const formattedTrigger = useMemo(
    () => formatDateTriggerDisplay(value),
    [value]
  );

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
              className={`text-xs font-semibold tracking-tight whitespace-nowrap ${
                hasError ? 'text-rose-700' : 'text-slate-800'
              }`}
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
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 z-10 transition-colors ${
            hasError
              ? 'text-rose-500'
              : open
              ? 'text-emerald-600'
              : 'text-slate-500'
          }`}
        >
          <CalendarIcon className="w-4 h-4 shrink-0" />
        </div>

        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-label={label || 'Select date'}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError && errorId ? errorId : undefined}
          onClick={() => {
            if (disabled) return;
            if (!open && parsedValue) {
              setViewYear(parsedValue.year);
              setViewMonth(parsedValue.month);
            }
            setOpen((prev) => !prev);
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((prev) => !prev);
            }
          }}
          className={`w-full h-10 pl-9 pr-9 text-left text-xs sm:text-sm bg-white border rounded-xl shadow-2xs transition-all flex items-center justify-between gap-2 cursor-pointer active:scale-[0.99] focus-visible:outline-none ${
            hasError
              ? 'border-rose-500 bg-rose-50/20 ring-3 ring-rose-500/10'
              : open
              ? 'border-emerald-600 ring-3 ring-emerald-500/15'
              : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50/40 focus-visible:border-emerald-600 focus-visible:ring-3 focus-visible:ring-emerald-500/15'
          } disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed disabled:active:scale-100 ${className}`}
        >
          {formattedTrigger ? (
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <span className="font-semibold text-slate-900 font-sans truncate">
                {formattedTrigger.primary}
              </span>
              <span className="text-[11px] font-mono tabular-nums font-medium text-slate-500 shrink-0">
                · {formattedTrigger.weekday}
              </span>
            </span>
          ) : (
            <span className="text-slate-400 font-normal truncate">
              {placeholder}
            </span>
          )}

          <span
            className={`pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 transition-transform duration-150 ${
              hasError
                ? 'text-rose-600'
                : open
                ? 'rotate-180 text-emerald-600'
                : 'text-slate-600'
            }`}
          >
            <ChevronDown className="w-4 h-4 shrink-0" />
          </span>
        </button>

        {typeof document !== 'undefined' &&
          createPortal(
            <AnimatePresence>
              {open && position && (
                <motion.div
                  ref={popoverRef}
                  role="dialog"
                  aria-label={label ? `${label} calendar` : 'Calendar date picker'}
                  initial={{
                    opacity: 0,
                    y: position.placement === 'below' ? -4 : 4,
                    scale: 0.98,
                  }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    y: position.placement === 'below' ? -4 : 4,
                    scale: 0.98,
                  }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: 'fixed',
                    left: position.left,
                    width: position.width,
                    top: position.top,
                    bottom: position.bottom,
                  }}
                  className="z-[100] bg-white border border-slate-200/95 rounded-2xl shadow-xl shadow-slate-900/12 p-3.5 space-y-3 ring-1 ring-slate-900/5 select-none"
                >
                  {/* Quick Preset Bar */}
                  {quickPresets.length > 0 && (
                    <div className="flex items-center gap-1.5 pb-2.5 border-b border-slate-100 overflow-x-auto no-scrollbar">
                      {quickPresets.map((preset) => {
                        const isPresetActive = preset.iso === value;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => emitDateChange(preset.iso)}
                            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer active:scale-95 ${
                              isPresetActive
                                ? 'bg-emerald-600 text-white shadow-2xs'
                                : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 hover:text-slate-900'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Month / Year Navigation Header */}
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      aria-label="Previous month"
                      className="w-8 h-8 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-950 flex items-center justify-center transition-all cursor-pointer active:scale-95 shadow-2xs"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <div className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight font-display">
                      {MONTH_NAMES[viewMonth]}{' '}
                      <span className="font-mono tabular-nums">{viewYear}</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleNextMonth}
                      aria-label="Next month"
                      className="w-8 h-8 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-950 flex items-center justify-center transition-all cursor-pointer active:scale-95 shadow-2xs"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Weekday Headers */}
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {WEEKDAY_SHORT_HEADERS.map((wd) => (
                      <div
                        key={wd}
                        className="text-[10px] font-bold uppercase tracking-wider text-slate-400 py-0.5"
                      >
                        {wd}
                      </div>
                    ))}
                  </div>

                  {/* 6-Week Day Grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((cell) => (
                      <button
                        key={cell.iso}
                        type="button"
                        disabled={cell.isDisabled}
                        onClick={() => emitDateChange(cell.iso)}
                        aria-label={cell.iso}
                        aria-pressed={cell.isSelected}
                        className={`h-8 rounded-lg font-mono tabular-nums text-xs flex items-center justify-center transition-all relative ${
                          cell.isDisabled
                            ? 'text-slate-300 opacity-40 cursor-not-allowed'
                            : cell.isSelected
                            ? 'bg-emerald-600 text-white font-bold shadow-xs ring-2 ring-emerald-600/20 cursor-pointer'
                            : cell.isToday
                            ? 'bg-emerald-50/80 text-emerald-800 border border-emerald-400/80 font-bold hover:bg-emerald-100/80 cursor-pointer active:scale-95'
                            : cell.inCurrentMonth
                            ? 'text-slate-800 hover:bg-slate-100 font-semibold cursor-pointer active:scale-95'
                            : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600 font-medium cursor-pointer active:scale-95'
                        }`}
                      >
                        <span>{cell.day}</span>
                      </button>
                    ))}
                  </div>

                  {/* Footer with ISO readout & Jump to Today */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono tabular-nums text-slate-500">
                      {value || 'No date selected'}
                    </span>
                    {!isDateDisabled(todayIso) && (
                      <button
                        type="button"
                        onClick={() => emitDateChange(todayIso)}
                        className="font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
                      >
                        Select Today
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
      </div>

      <AnimatePresence initial={false}>
        {hasError ? (
          <motion.div
            key="error"
            id={errorId}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14 }}
            role="alert"
            className="flex items-start gap-1.5 text-[11px] font-semibold text-rose-600 leading-snug pt-0.5"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        ) : helperText ? (
          <p className="text-[11px] text-slate-500 leading-snug pt-0.5">
            {helperText}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// Custom Interactive Time Slot Picker (Editable HH:MM + Quick Dropdown)
// ============================================================================

const TIME_SLOT_OPTIONS: { value: string; label12h: string }[] = Array.from(
  { length: 36 },
  (_, idx) => {
    const totalMinutes = (6 * 60) + idx * 30; // 06:00 to 23:30
    const hours24 = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const value = `${String(hours24).padStart(2, '0')}:${String(mins).padStart(
      2,
      '0'
    )}`;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    const label12h = `${hours12}:${String(mins).padStart(2, '0')} ${period}`;
    return { value, label12h };
  }
);

export interface StyledTimePickerProps {
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  helperText?: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  containerClassName?: string;
  className?: string;
  onChange: (e: { target: { value: string } }) => void;
}

export const StyledTimePicker: React.FC<StyledTimePickerProps> = ({
  id,
  label,
  hint,
  error,
  helperText,
  value,
  disabled = false,
  placeholder = '19:00',
  containerClassName = '',
  className = '',
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      if (wrapperRef.current) {
        setPosition(computeDropdownPosition(wrapperRef.current, 180, 240));
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      '[data-time-selected="true"]'
    );
    activeEl?.scrollIntoView({ block: 'center' });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
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

  const hasError = Boolean(error && error.trim());
  const errorId = id ? `${id}-error` : undefined;

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
              className={`text-xs font-semibold tracking-tight whitespace-nowrap ${
                hasError ? 'text-rose-700' : 'text-slate-800'
              }`}
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

      <div ref={wrapperRef} className="relative flex items-center">
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 z-10 transition-colors ${
            hasError
              ? 'text-rose-500'
              : open
              ? 'text-emerald-600'
              : 'text-slate-500'
          }`}
        >
          <Clock className="w-4 h-4 shrink-0" />
        </div>

        <input
          id={id}
          type="text"
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError && errorId ? errorId : undefined}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={(e) => onChange({ target: { value: e.target.value } })}
          className={`w-full h-10 pl-9 pr-9 text-sm font-mono tabular-nums font-semibold text-slate-900 border rounded-xl shadow-2xs transition-all focus:outline-none placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed ${
            hasError
              ? 'border-rose-500 bg-rose-50/20 hover:border-rose-600 focus:border-rose-600 focus:ring-3 focus:ring-rose-500/15'
              : open
              ? 'bg-white border-emerald-600 ring-3 ring-emerald-500/15'
              : 'bg-white border-slate-300 hover:border-slate-400 focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/15'
          } ${className}`}
        />

        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={label ? `Toggle ${label} options` : 'Toggle time options'}
          onClick={() => {
            if (!disabled) setOpen((prev) => !prev);
          }}
          className={`absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer transition-transform duration-150 ${
            hasError
              ? 'text-rose-600'
              : open
              ? 'rotate-180 text-emerald-600'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ChevronDown className="w-4 h-4 shrink-0" />
        </button>

        {typeof document !== 'undefined' &&
          createPortal(
            <AnimatePresence>
              {open && position && (
                <motion.div
                  ref={listRef}
                  role="listbox"
                  aria-label={label ? `${label} presets` : 'Time slots'}
                  initial={{
                    opacity: 0,
                    y: position.placement === 'below' ? -4 : 4,
                    scale: 0.98,
                  }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    y: position.placement === 'below' ? -4 : 4,
                    scale: 0.98,
                  }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: 'fixed',
                    left: position.left,
                    width: position.width,
                    top: position.top,
                    bottom: position.bottom,
                    maxHeight: position.maxHeight,
                  }}
                  className="z-[100] bg-white border border-slate-200/95 rounded-xl shadow-xl shadow-slate-900/10 py-1.5 overflow-y-auto overscroll-contain ring-1 ring-slate-900/5"
                >
                  {TIME_SLOT_OPTIONS.map((slot) => {
                    const isSelected = slot.value === value.trim();
                    return (
                      <button
                        key={slot.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-time-selected={isSelected || undefined}
                        onClick={() => {
                          onChange({ target: { value: slot.value } });
                          setOpen(false);
                        }}
                        className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50/90 text-emerald-950 font-bold'
                            : 'text-slate-800 hover:bg-slate-50 font-medium'
                        }`}
                      >
                        <span className="font-mono tabular-nums font-semibold">
                          {slot.value}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-500">
                          <span>{slot.label12h}</span>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
      </div>

      <AnimatePresence initial={false}>
        {hasError ? (
          <motion.div
            key="error"
            id={errorId}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14 }}
            role="alert"
            className="flex items-start gap-1.5 text-[11px] font-semibold text-rose-600 leading-snug pt-0.5"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        ) : helperText ? (
          <p className="text-[11px] text-slate-500 leading-snug pt-0.5">
            {helperText}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

interface StyledInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  helperText?: string;
  containerClassName?: string;
  icon?: React.ReactNode;
  prefixText?: string;
  suffixText?: string;
}

export const StyledInput: React.FC<StyledInputProps> = ({
  label,
  hint,
  error,
  helperText,
  containerClassName = '',
  className = '',
  id,
  icon,
  prefixText,
  suffixText,
  type,
  ...props
}) => {
  if (type === 'date') {
    return (
      <StyledDatePicker
        id={id}
        label={label}
        hint={hint}
        error={error}
        helperText={helperText}
        containerClassName={containerClassName}
        className={className}
        value={props.value !== undefined ? String(props.value) : ''}
        min={props.min !== undefined ? String(props.min) : undefined}
        max={props.max !== undefined ? String(props.max) : undefined}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={props.onChange}
      />
    );
  }

  if (type === 'time') {
    return (
      <StyledTimePicker
        id={id}
        label={label}
        hint={hint}
        error={error}
        helperText={helperText}
        containerClassName={containerClassName}
        className={className}
        value={props.value !== undefined ? String(props.value) : ''}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={props.onChange as (e: { target: { value: string } }) => void}
      />
    );
  }

  const hasError = Boolean(error && error.trim());
  const errorId = id ? `${id}-error` : undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {(label || hint) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label
              htmlFor={id}
              className={`text-xs font-semibold tracking-tight whitespace-nowrap ${
                hasError ? 'text-rose-700' : 'text-slate-800'
              }`}
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
          <div
            className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 ${
              hasError ? 'text-rose-500' : 'text-slate-500'
            }`}
          >
            {icon}
          </div>
        )}
        {prefixText && !icon && (
          <div
            className={`pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-xs font-semibold font-mono ${
              hasError ? 'text-rose-600' : 'text-slate-600'
            }`}
          >
            {prefixText}
          </div>
        )}
        <input
          id={id}
          type={type}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError && errorId ? errorId : undefined}
          {...props}
          className={`w-full h-10 ${
            icon ? 'pl-9' : prefixText ? 'pl-7' : 'pl-3.5'
          } ${
            suffixText ? 'pr-10' : 'pr-3.5'
          } text-sm text-slate-900 border rounded-xl shadow-2xs transition-all focus:outline-none placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed ${
            hasError
              ? 'border-rose-500 bg-rose-50/20 hover:border-rose-600 focus:border-rose-600 focus:ring-3 focus:ring-rose-500/15'
              : 'bg-white border-slate-300 hover:border-slate-400 focus:border-emerald-600 focus:ring-3 focus:ring-emerald-500/15'
          } ${className}`}
        />
        {suffixText && (
          <div
            className={`pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold font-mono ${
              hasError ? 'text-rose-600' : 'text-slate-600'
            }`}
          >
            {suffixText}
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {hasError ? (
          <motion.div
            key="error"
            id={errorId}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14 }}
            role="alert"
            className="flex items-start gap-1.5 text-[11px] font-semibold text-rose-600 leading-snug pt-0.5"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        ) : helperText ? (
          <p className="text-[11px] text-slate-500 leading-snug pt-0.5">
            {helperText}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export interface FormAlertBannerProps {
  message?: string | null;
  variant?: 'error' | 'warning' | 'success' | 'info';
  onDismiss?: () => void;
  className?: string;
}

export const FormAlertBanner: React.FC<FormAlertBannerProps> = ({
  message,
  variant = 'error',
  onDismiss,
  className = '',
}) => {
  if (!message) return null;

  const styles =
    variant === 'error'
      ? 'bg-rose-50/90 border-rose-200 text-rose-900'
      : variant === 'warning'
      ? 'bg-amber-50/90 border-amber-200 text-amber-900'
      : variant === 'success'
      ? 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
      : 'bg-slate-50 border-slate-200 text-slate-800';

  const icon =
    variant === 'error' ? (
      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
    ) : variant === 'warning' ? (
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
    ) : variant === 'success' ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
    ) : (
      <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
    );

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={`rounded-xl border px-3.5 py-2.5 flex items-start justify-between gap-2.5 text-xs font-medium leading-relaxed ${styles} ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        {icon}
        <span className="break-words">{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-current opacity-60 hover:opacity-100 shrink-0 cursor-pointer p-0.5 rounded-lg transition-opacity"
          aria-label="Dismiss message"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
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
            } items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-all cursor-pointer select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 ${
              size === 'sm'
                ? 'px-3 py-1.5 text-xs min-h-[34px] sm:min-h-[32px]'
                : 'px-3.5 py-2 text-xs min-h-[38px] sm:min-h-[36px]'
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
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          {...backdropClose(onCancel)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-xl w-full sm:max-w-md p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 space-y-4 overflow-hidden"
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
                className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-all active:scale-95 cursor-pointer shrink-0"
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
                className="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmClick}
                className={`h-9 px-4 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] cursor-pointer shadow-xs ${confirmBtnStyles}`}
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


