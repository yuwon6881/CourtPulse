import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../utils/theme';

interface ThemeToggleButtonProps {
  className?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({
  className = '',
}) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`h-9 w-9 rounded-xl border border-slate-300/85 dark:border-slate-700/80 bg-white dark:bg-slate-800/90 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400/80 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white inline-flex items-center justify-center transition-all shadow-2xs shrink-0 cursor-pointer active:scale-95 ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 text-slate-700" />
      )}
    </button>
  );
};
