import React from 'react';
import { motion } from 'motion/react';
import { Activity, Cloud, CloudOff, Eye, Feather, Hand, Loader2, Swords } from 'lucide-react';
import type { EquipmentIndex } from '../utils/equipmentIndex';
import type { EquipmentSyncStatus } from './useEquipmentStore';

export const EquipmentSyncNote: React.FC<{
  status: EquipmentSyncStatus;
  canEdit: boolean;
  playerName: string;
}> = ({ status, canEdit }) => {
  // The line is always rendered so "Saving…" fades in place instead of pushing the page down.
  const visible = status === 'saving' && canEdit;
  return (
    <p
      aria-live="polite"
      className={`flex items-center gap-1.5 text-[11px] text-slate-500 mt-1 h-4 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {visible && (
        <>
          <Loader2 aria-hidden="true" className="w-3.5 h-3.5 shrink-0 animate-spin text-slate-400" />
          <span>Saving…</span>
        </>
      )}
    </p>
  );
};

type StatTone = 'emerald' | 'sky' | 'violet' | 'amber';

const TONE_BADGE: Record<StatTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  sky: 'bg-sky-50 text-sky-700 border-sky-200/80',
  violet: 'bg-violet-50 text-violet-700 border-violet-200/80',
  amber: 'bg-amber-50 text-amber-700 border-amber-200/80',
};

const StatTile: React.FC<{
  icon: React.ReactNode;
  tone: StatTone;
  label: string;
  value: React.ReactNode;
  index: number;
}> = ({ icon, tone, label, value, index }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.18, delay: index * 0.03, ease: 'easeOut' }}
    className="bg-white rounded-2xl border border-slate-200/90 p-3.5 sm:p-4 shadow-2xs flex items-center gap-3 min-w-0"
  >
    <div
      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${TONE_BADGE[tone]}`}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-600 leading-snug">{label}</p>
      <p className="text-lg font-bold text-slate-900 font-mono tabular-nums leading-tight mt-0.5">
        {value}
      </p>
    </div>
  </motion.div>
);

export const EquipmentLockerStats: React.FC<{ summary: EquipmentIndex['summary'] }> = ({
  summary,
}) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    <StatTile
      index={0}
      tone="emerald"
      icon={<Swords className="w-4 h-4" />}
      label="Court-ready rackets"
      value={`${summary.playableCount}/${summary.totalFramesCount}`}
    />
    <StatTile
      index={1}
      tone="sky"
      icon={<Hand className="w-4 h-4" />}
      label="Fresh grips"
      value={`${summary.gripsFreshCount}/${summary.totalFramesCount}`}
    />
    <StatTile
      index={2}
      tone="amber"
      icon={<Feather className="w-4 h-4" />}
      label="Shuttles left"
      value={summary.totalShuttlesRemaining}
    />
    <StatTile
      index={3}
      tone="violet"
      icon={<Activity className="w-4 h-4" />}
      label="Average tension today"
      value={summary.meanEffectiveTension !== null ? `${summary.meanEffectiveTension} lbs` : '—'}
    />
  </div>
);
