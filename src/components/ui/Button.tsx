import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'destructive' | 'warning';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'text-white bg-emerald-600 border-emerald-700/20 dark:border-emerald-500/40 hover:bg-emerald-700 dark:hover:bg-emerald-500 shadow-[0_1px_2px_rgba(6,78,59,0.22),inset_0_1px_0_rgba(255,255,255,0.16)] dark:shadow-xs',
  secondary: 'text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800/90 border-slate-300/90 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400/90 dark:hover:border-slate-600 shadow-2xs',
  success: 'text-white bg-emerald-600 border-emerald-700/20 dark:border-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-500 shadow-[0_1px_2px_rgba(6,78,59,0.22),inset_0_1px_0_rgba(255,255,255,0.16)] dark:shadow-xs',
  warning: 'text-white bg-amber-600 border-amber-700/20 dark:border-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 shadow-xs',
  destructive: 'text-rose-700 dark:text-rose-300 bg-white dark:bg-rose-950/40 border-rose-200/95 dark:border-rose-800/80 hover:bg-rose-50 dark:hover:bg-rose-950/70 hover:border-rose-300 dark:hover:border-rose-700 shadow-2xs',
};

// Larger touch targets on phones (40px md, 44px lg) while tightening cleanly from `sm` up.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 sm:h-8 px-3',
  md: 'h-10 sm:h-9 px-4',
  lg: 'h-11 sm:h-10 px-4',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className = '',
  ...props
}) => (
  <button
    type={type}
    {...props}
    className={`inline-flex items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
  />
);

