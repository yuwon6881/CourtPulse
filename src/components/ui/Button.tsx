import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'destructive' | 'warning';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'text-white bg-slate-900 border-slate-900 hover:bg-slate-800 shadow-xs',
  secondary: 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50 hover:border-slate-400 shadow-2xs',
  success: 'text-white bg-emerald-600 border-emerald-600 hover:bg-emerald-700 shadow-xs',
  warning: 'text-white bg-amber-600 border-amber-600 hover:bg-amber-700 shadow-xs',
  destructive: 'text-rose-700 bg-white border-rose-200 hover:bg-rose-50 hover:border-rose-300 shadow-2xs',
};

// sm stays at 36px on phones so dense rows keep a usable touch target; it tightens to 32px from `sm`.
// lg matches the 40px height of StyledInput/StyledSelect so toolbar rows line up.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 sm:h-8 px-3',
  md: 'h-9 px-4',
  lg: 'h-10 px-4',
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
    className={`inline-flex items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap cursor-pointer active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
  />
);
