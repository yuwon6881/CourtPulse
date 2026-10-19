import React, { useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import {
  CourtBookingAdvice,
  describeCourtRate,
  formatCourtCount,
} from '../utils/courtAdvice';

interface CourtSuggestionProps {
  advice: CourtBookingAdvice;
  /** Fee the rate was read from, so the explanation can show the arithmetic. */
  currentFee: number;
  /** When provided, offers to copy the recommendation into the fee being edited. */
  onApply?: (courts: number, totalCost: number) => void;
  /** Hides the apply action when the draft already matches the recommendation. */
  applied?: boolean;
}

const FIT_LABEL: Record<
  Exclude<CourtBookingAdvice['scenarios'][number]['fit'], 'underfilled'>,
  string
> = {
  good: 'good rotation',
  busy: 'busy rotation',
  crowded: 'crowded',
};

const money = (n: number | null): string => (n === null ? '—' : `$${n.toFixed(2)}`);

export const CourtSuggestion: React.FC<CourtSuggestionProps> = ({
  advice,
  currentFee,
  onApply,
  applied = false,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const statusNote =
    advice.status === 'need_players'
      ? `Wait for ${advice.playersShort} more ${advice.playersShort === 1 ? 'player' : 'players'}`
      : advice.status === 'borderline'
      ? `${advice.playersShort} more ${advice.playersShort === 1 ? 'player fills' : 'players fill'} court`
      : 'Ready to book';

  return (
    <div className="rounded-lg bg-amber-50/50 border border-amber-200/70 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-800 min-w-0">
          <Lightbulb className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
          <span className="font-semibold text-amber-950">Suggested:</span>
          <span>
            Book <strong className="text-slate-900">{formatCourtCount(advice.recommendedCourts)}</strong>
            {advice.totalCost !== null && (
              <span className="font-mono tabular-nums text-slate-700"> ({money(advice.totalCost)}</span>
            )}
            {advice.costPerPlayer !== null && (
              <span className="font-mono tabular-nums font-semibold text-emerald-800">
                {' '}· ~{money(advice.costPerPlayer)}/p
              </span>
            )}
            {advice.totalCost !== null && <span className="font-mono"> )</span>}
          </span>
          <span className="text-slate-500">
            · {advice.goingCount} going · {statusNote}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onApply && advice.totalCost !== null && !applied && (
            <button
              type="button"
              onClick={() => onApply(advice.recommendedCourts, advice.totalCost as number)}
              className="h-6 px-2.5 rounded-md bg-amber-500/90 hover:bg-amber-600 text-white text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
            >
              Use {formatCourtCount(advice.recommendedCourts)} ({money(advice.totalCost)})
            </button>
          )}
          {advice.goingCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              className="h-6 px-2 rounded-md text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-amber-100/60 inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>{showDetails ? 'Hide' : 'Compare'}</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {showDetails && (
        <div className="mt-2 pt-2 border-t border-amber-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-600">
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono tabular-nums">
            {advice.scenarios.map((sc) => (
              <li
                key={sc.courts}
                className={sc.isRecommended ? 'font-semibold text-slate-900' : undefined}
              >
                {formatCourtCount(sc.courts)}: {money(sc.costPerPlayer)}/p
                <span className="font-sans text-slate-500">
                  {' '}({sc.fit === 'underfilled'
                    ? `${sc.courts * 4 - advice.goingCount} short`
                    : FIT_LABEL[sc.fit]}
                  {sc.restingPerGame > 0 ? `, ${sc.restingPerGame} rest` : ''})
                </span>
              </li>
            ))}
          </ul>
          <span className="text-slate-500 shrink-0">{describeCourtRate(advice.rate, currentFee)}</span>
        </div>
      )}
    </div>
  );
};

