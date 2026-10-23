import React from 'react';
import { motion } from 'motion/react';

type SectionTone = 'emerald' | 'amber' | 'violet' | 'slate';

const TONE_BADGE: Record<SectionTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  amber: 'bg-amber-50 text-amber-700 border-amber-200/80',
  violet: 'bg-violet-50 text-violet-700 border-violet-200/80',
  slate: 'bg-slate-100 text-slate-700 border-slate-200/80',
};

interface EquipmentSectionProps {
  title: string;
  icon: React.ReactNode;
  tone: SectionTone;
  count?: number;
  aside?: React.ReactNode;
  className?: string;
  delay?: number;
  children: React.ReactNode;
}

/** Panel shell shared by the gear locker's racket, shuttle and history sections. */
export const EquipmentSection: React.FC<EquipmentSectionProps> = ({
  title,
  icon,
  tone,
  count,
  aside,
  className = '',
  delay = 0,
  children,
}) => (
  <motion.section
    aria-label={title}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.2, delay, ease: 'easeOut' }}
    className={`bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden ${className}`}
  >
    <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${TONE_BADGE[tone]}`}
        >
          {icon}
        </div>
        <h2 className="text-sm font-bold text-slate-900 truncate">{title}</h2>
        {count !== undefined && (
          <span className="h-5 min-w-5 px-1.5 rounded-full bg-slate-100 text-[11px] font-mono font-semibold tabular-nums text-slate-600 inline-flex items-center justify-center">
            {count}
          </span>
        )}
      </div>
      {aside}
    </div>
    {children}
  </motion.section>
);
