import React from 'react';
import type { RacketGearItem, StringingLogEntry, UsageProfilePreset } from '../types/equipment';
import {
  type DurationRestringRecommendation,
  type GripDurationStatus,
  getUsageProfileConfig,
} from '../utils/equipmentMath';
import { Button } from './ui/Button';

type Tone = 'good' | 'warn' | 'danger';

const BAR_TONE: Record<Tone, string> = {
  good: 'bg-linear-to-r from-emerald-500 to-emerald-600',
  warn: 'bg-linear-to-r from-amber-400 to-amber-500',
  danger: 'bg-linear-to-r from-rose-500 to-rose-600',
};

const PILL_TONE: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  warn: 'bg-amber-50 text-amber-800 border-amber-200/80',
  danger: 'bg-rose-50 text-rose-700 border-rose-200/80',
};

const PILL_DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-rose-500',
};

const TEXT_TONE: Record<Tone, string> = {
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  danger: 'text-rose-600',
};

const HealthMeter: React.FC<{ label: string; percent: number; tone: Tone }> = ({
  label,
  percent,
  tone,
}) => (
  <div className="flex items-center gap-2.5">
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="flex-1 h-1.5 bg-slate-200/80 rounded-full overflow-hidden"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${BAR_TONE[tone]}`}
        style={{ width: `${Math.max(3, percent)}%` }}
      />
    </div>
    <span
      className={`w-10 text-right text-[11px] font-mono tabular-nums font-semibold shrink-0 ${TEXT_TONE[tone]}`}
    >
      {percent}%
    </span>
  </div>
);

const TrackPanel: React.FC<{
  kicker: string;
  title: string;
  badge?: React.ReactNode;
  subline: React.ReactNode;
  actions?: React.ReactNode;
  meter: React.ReactNode;
}> = ({ kicker, title, badge, subline, actions, meter }) => (
  <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/70 space-y-2.5">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
            {kicker}
          </span>
          <span className="font-semibold text-slate-900 truncate">{title}</span>
          {badge}
        </div>
        <div className="text-[11px] font-mono tabular-nums text-slate-500 flex items-center gap-1.5 flex-wrap">
          {subline}
        </div>
      </div>
      {actions && (
        <div className="grid grid-cols-2 gap-1.5 w-full sm:w-52 shrink-0">{actions}</div>
      )}
    </div>
    {meter}
  </div>
);

const Dot: React.FC = () => (
  <span aria-hidden="true" className="text-slate-300">
    ·
  </span>
);

interface RacketRowProps {
  racket: RacketGearItem;
  currentLog?: StringingLogEntry;
  latestLog?: StringingLogEntry;
  durationRec: DurationRestringRecommendation;
  gripStatus: GripDurationStatus;
  profilePreset: UsageProfilePreset;
  readOnly: boolean;
  onOpenRestring: (racketId: string) => void;
  onQuickRepeatRestring: (racketId: string) => void;
  onMarkSnapped: (racketId: string) => void;
  onResetGrip: (racketId: string) => void;
  onOpenChangeGrip: (racketId: string) => void;
}

export const EquipmentRacketRow = React.memo<RacketRowProps>(
  ({
    racket,
    currentLog,
    latestLog,
    durationRec,
    gripStatus,
    profilePreset,
    readOnly,
    onOpenRestring,
    onQuickRepeatRestring,
    onMarkSnapped,
    onResetGrip,
    onOpenChangeGrip,
  }) => {
    const profileCfg = getUsageProfileConfig(profilePreset);
    const healthScore = durationRec.healthScore;
    const isSnapped =
      racket.status === 'needs_restring' ||
      currentLog?.outcome === 'snapped' ||
      healthScore === 0;
    const isStringWarn = !isSnapped && healthScore <= profileCfg.stringWarnThreshold;
    const stringTone: Tone = isSnapped ? 'danger' : isStringWarn ? 'warn' : 'good';
    const gripTone: Tone = gripStatus.isDue ? 'danger' : gripStatus.isWarning ? 'warn' : 'good';
    const repeatLog = currentLog ?? latestLog;

    const fullModelText = `${racket.brand} ${racket.model}`.trim();
    const displayTitle = racket.nickname || fullModelText;

    const headline = isSnapped
      ? { text: 'String snapped', tone: 'danger' as Tone }
      : gripStatus.isDue
      ? { text: 'Grip re-wrap due', tone: 'warn' as Tone }
      : isStringWarn
      ? { text: 'Restring soon', tone: 'warn' as Tone }
      : { text: 'Court ready', tone: 'good' as Tone };

    return (
      <article className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900 truncate">{displayTitle}</h3>
            {displayTitle !== fullModelText && (
              <>
                <Dot />
                <span className="text-xs text-slate-500 truncate">{fullModelText}</span>
              </>
            )}
          </div>
          <span
            className={`h-6 px-2 rounded-full border text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0 ${PILL_TONE[headline.tone]}`}
          >
            <span
              aria-hidden="true"
              className={`w-1.5 h-1.5 rounded-full ${PILL_DOT[headline.tone]} ${headline.tone === 'danger' ? 'animate-pulse' : ''}`}
            />
            {headline.text}
          </span>
        </div>

        <TrackPanel
          kicker="String"
          title={currentLog ? currentLog.stringModel : 'Unstrung'}
          badge={
            currentLog && (
              <>
                <Dot />
                <span className="font-mono tabular-nums font-semibold text-slate-800">
                  {currentLog.mainTensionLbs} lbs
                </span>
              </>
            )
          }
          subline={
            <>
              {currentLog && (
                <>
                  <span>
                    {currentLog.strungAtDate} ({durationRec.daysElapsed}d/{durationRec.recommendedCycleDays}d)
                  </span>
                  <Dot />
                </>
              )}
              <span className={stringTone === 'good' ? 'text-slate-600' : TEXT_TONE[stringTone]}>
                {durationRec.statusLabel}
              </span>
            </>
          }
          actions={
            readOnly ? null : isSnapped ? (
              <>
                {repeatLog ? (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => onQuickRepeatRestring(racket.id)}
                    title={`Restring with ${repeatLog.stringModel} at ${repeatLog.mainTensionLbs} lbs`}
                  >
                    Repeat {repeatLog.mainTensionLbs} lbs
                  </Button>
                ) : (
                  <span />
                )}
                <Button size="sm" onClick={() => onOpenRestring(racket.id)}>
                  New string
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="primary" onClick={() => onOpenRestring(racket.id)}>
                  Restring
                </Button>
                <Button size="sm" variant="destructive" onClick={() => onMarkSnapped(racket.id)}>
                  Mark snapped
                </Button>
              </>
            )
          }
          meter={
            <HealthMeter label={`String health ${healthScore}%`} percent={healthScore} tone={stringTone} />
          }
        />

        <TrackPanel
          kicker="Grip"
          title={racket.gripBrandModel || 'Overgrip'}
          subline={
            <>
              <span>
                {gripStatus.wrappedAtDate} ({gripStatus.daysElapsed}d/{gripStatus.recommendedCycleDays}d)
              </span>
              <Dot />
              <span className={gripTone === 'good' ? 'text-slate-600' : TEXT_TONE[gripTone]}>
                {gripStatus.statusLabel}
              </span>
            </>
          }
          actions={
            readOnly ? null : (
              <>
                <Button
                  size="sm"
                  variant={gripStatus.isDue ? 'warning' : 'secondary'}
                  onClick={() => onResetGrip(racket.id)}
                >
                  Re-wrap
                </Button>
                <Button size="sm" onClick={() => onOpenChangeGrip(racket.id)}>
                  Change grip
                </Button>
              </>
            )
          }
          meter={
            <HealthMeter
              label={`Grip freshness ${gripStatus.gripHealthPercent}%`}
              percent={gripStatus.gripHealthPercent}
              tone={gripTone}
            />
          }
        />
      </article>
    );
  }
);
EquipmentRacketRow.displayName = 'EquipmentRacketRow';
