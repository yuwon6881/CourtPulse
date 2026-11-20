import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

export interface ScorePickerInputProps {
  value: string;
  onChange: (nextValue: string) => void;
  ariaLabel: string;
  headerLabel: string;
  min?: number;
  max?: number;
  targetPoints?: number;
  accent?: 'emerald' | 'sky';
  hasError?: boolean;
  isWinning?: boolean;
}

interface PopoverCoords {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
  placement: 'below' | 'above';
}

const POPOVER_WIDTH = 248;
const POPOVER_GAP = 8;
const POPOVER_MARGIN = 12;
const POPOVER_MAX_HEIGHT = 292;

function computeCenteredPopoverCoords(trigger: HTMLElement): PopoverCoords {
  const rect = trigger.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const width = Math.min(POPOVER_WIDTH, viewportW - POPOVER_MARGIN * 2);

  const centeredLeft = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(
    POPOVER_MARGIN,
    Math.min(centeredLeft, viewportW - width - POPOVER_MARGIN)
  );

  const spaceBelow = viewportH - rect.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const spaceAbove = rect.top - POPOVER_GAP - POPOVER_MARGIN;
  const placement: 'below' | 'above' =
    spaceBelow >= 220 || spaceBelow >= spaceAbove ? 'below' : 'above';

  const available = placement === 'below' ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(168, Math.min(POPOVER_MAX_HEIGHT, available));

  return {
    left: Math.round(left),
    width: Math.round(width),
    maxHeight: Math.round(maxHeight),
    placement,
    ...(placement === 'below'
      ? { top: Math.round(rect.bottom + POPOVER_GAP) }
      : { bottom: Math.round(viewportH - rect.top + POPOVER_GAP) }),
  };
}

/**
 * Centered, spinner-free numeric score input that opens a floating range-of-numbers
 * dropdown grid on click so users can pick scores in a single tap/click without +/- buttons.
 * Direct keyboard entry and ArrowUp/ArrowDown adjustments remain supported.
 */
export const ScorePickerInput: React.FC<ScorePickerInputProps> = ({
  value,
  onChange,
  ariaLabel,
  headerLabel,
  min = 0,
  max = 30,
  targetPoints,
  accent = 'emerald',
  hasError = false,
  isWinning = false,
}) => {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const parsedNum = value.trim() === '' ? null : parseInt(value, 10);
  const currentNum =
    parsedNum !== null && !Number.isNaN(parsedNum) ? parsedNum : null;

  const effectiveMax = useMemo(() => {
    const baseMax = Math.max(min, max);
    if (currentNum !== null && currentNum > baseMax) {
      return Math.min(500, currentNum);
    }
    return baseMax;
  }, [min, max, currentNum]);

  const numbers = useMemo(() => {
    const count = Math.max(0, effectiveMax - min + 1);
    return Array.from({ length: count }, (_, idx) => min + idx);
  }, [min, effectiveMax]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const update = () => {
      if (inputRef.current) {
        setCoords(computeCenteredPopoverCoords(inputRef.current));
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

  // Keep the currently selected score scrolled into view when opening longer ranges.
  useEffect(() => {
    if (!open || !coords || !gridRef.current) return;
    const selectedEl = gridRef.current.querySelector<HTMLElement>(
      '[data-selected="true"]'
    );
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [open, coords]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        inputRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/[^\d]/g, '');
    if (digitsOnly === '') {
      onChange('');
      return;
    }
    const clamped = Math.min(500, parseInt(digitsOnly, 10));
    onChange(String(clamped));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const next = Math.max(min, (currentNum ?? 0) - 1);
        onChange(String(next));
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(500, (currentNum ?? 0) + 1);
      onChange(String(next));
      return;
    }
    if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const handleSelectNumber = (num: number) => {
    onChange(String(num));
    setOpen(false);
  };

  const accentBorderRing =
    accent === 'sky'
      ? open
        ? 'border-sky-500 dark:border-sky-500 ring-2 ring-sky-500/20'
        : isWinning
        ? 'border-sky-400/80 dark:border-sky-600/80 hover:border-sky-500 dark:hover:border-sky-500 focus:border-sky-500 focus:ring-sky-500/20'
        : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 focus:border-sky-500 focus:ring-sky-500/20'
      : open
      ? 'border-emerald-600 dark:border-emerald-500 ring-2 ring-emerald-500/20'
      : isWinning
      ? 'border-emerald-400/80 dark:border-emerald-600/80 hover:border-emerald-500 dark:hover:border-emerald-500 focus:border-emerald-600 focus:ring-emerald-500/20'
      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 focus:border-emerald-600 focus:ring-emerald-500/20';

  const headerTone =
    accent === 'sky'
      ? 'text-sky-700 dark:text-sky-400'
      : 'text-emerald-700 dark:text-emerald-400';

  const selectedCellTone =
    accent === 'sky'
      ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
      : 'bg-emerald-600 text-white border-emerald-600 shadow-xs';

  const targetCellTone =
    accent === 'sky'
      ? 'bg-sky-50/70 dark:bg-sky-950/45 border-sky-300/80 dark:border-sky-700/80 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60'
      : 'bg-emerald-50/70 dark:bg-emerald-950/45 border-emerald-300/80 dark:border-emerald-700/80 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60';

  return (
    <div className="relative inline-flex items-center justify-center">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        value={value}
        onClick={() => {
          setOpen(true);
          inputRef.current?.select();
        }}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className={`no-spinner w-16 h-11 sm:w-[68px] sm:h-10 px-0 text-center leading-none font-mono tabular-nums font-bold text-lg sm:text-base rounded-xl border bg-white dark:bg-slate-800/95 text-slate-900 dark:text-white shadow-2xs transition-all cursor-pointer focus:outline-none focus:ring-2 ${
          hasError
            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
            : accentBorderRing
        }`}
      />

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={popoverRef}
                id={listboxId}
                role="listbox"
                aria-label={`${headerLabel} options`}
                initial={{
                  opacity: 0,
                  y: coords.placement === 'below' ? -4 : 4,
                  scale: 0.98,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: coords.placement === 'below' ? -4 : 4,
                  scale: 0.98,
                }}
                transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: 'fixed',
                  left: coords.left,
                  width: coords.width,
                  top: coords.top,
                  bottom: coords.bottom,
                  zIndex: 80,
                }}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200/95 dark:border-slate-700/90 shadow-xl shadow-slate-900/12 dark:shadow-black/60 overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60">
                  <span className={`text-[11px] font-semibold ${headerTone}`}>
                    {headerLabel}
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {min}–{effectiveMax}
                  </span>
                </div>

                <div
                  ref={gridRef}
                  style={{ maxHeight: Math.max(124, coords.maxHeight - 36) }}
                  className="p-2 overflow-y-auto overscroll-contain grid grid-cols-6 gap-1"
                >
                  {numbers.map((num) => {
                    const isSelected = currentNum === num;
                    const isTarget =
                      !isSelected &&
                      targetPoints !== undefined &&
                      num === targetPoints;
                    return (
                      <button
                        key={num}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-selected={isSelected ? 'true' : undefined}
                        onMouseDown={(e) => {
                          // Prevent input blur flicker before click fires
                          e.preventDefault();
                        }}
                        onClick={() => handleSelectNumber(num)}
                        className={`h-9 sm:h-8 rounded-lg border text-xs font-mono tabular-nums font-semibold flex items-center justify-center transition-colors duration-100 cursor-pointer ${
                          isSelected
                            ? selectedCellTone
                            : isTarget
                            ? targetCellTone
                            : 'border-transparent bg-slate-50/70 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/90 hover:border-slate-200 dark:hover:border-slate-600'
                        }`}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};
