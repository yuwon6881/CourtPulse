import React from 'react';
import { Lightbulb } from 'lucide-react';
import {
  CourtBookingAdvice,
  describeCourtRate,
  formatCourtCount,
} from '../utils/courtAdvice';
import { Button } from './ui/Button';

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
  const statusNote =
    advice.status === 'need_players'
      ? `Wait for ${advice.playersShort} more ${advice.playersShort === 1 ? 'player' : 'players'} before booking`
      : advice.status === 'borderline'
      ? `${advice.playersShort} more ${advice.playersShort === 1 ? 'player fills' : 'players fill'} every court`
      : 'Ready to book';

  return (
    <div className="rounded-xl bg-amber-50/60 border border-amber-200/80 px-3.5 py-3 text-xs space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-800">
          <Lightbulb className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
          <span className="font-bold text-amber-900">Suggested:</span>
          <span>
            Book <strong className="text-slate-900">{formatCourtCount(advice.recommendedCourts)}</strong>
            {advice.totalCost !== null && (
              <span className="font-mono tabular-nums"> · {money(advice.totalCost)} total</span>
            )}
            {advice.costPerPlayer !== null && (
              <strong className="font-mono tabular-nums text-emerald-800">
                {' '}
                · ~{money(advice.costPerPlayer)}/player
              </strong>
            )}
          </span>
          <span className="text-slate-600">
            ({advice.goingCount} going{advice.ownerExcluded ? ', owner not billed' : ''} · {statusNote})
          </span>
        </p>
        {onApply && advice.totalCost !== null && !applied && (
          <Button
            size="sm"
            variant="warning"
            onClick={() => onApply(advice.recommendedCourts, advice.totalCost as number)}
          >
            Use {formatCourtCount(advice.recommendedCourts)} · {money(advice.totalCost)}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-slate-600">{describeCourtRate(advice.rate, currentFee)}</p>

      {advice.goingCount > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums text-slate-600">
          {advice.scenarios.map((sc) => (
            <li
              key={sc.courts}
              className={sc.isRecommended ? 'font-semibold text-slate-900' : undefined}
            >
              {formatCourtCount(sc.courts)}: {money(sc.costPerPlayer)}/player
              <span className="font-sans">
                {' '}
                ·{' '}
                {sc.fit === 'underfilled'
                  ? `${sc.courts * 4 - advice.goingCount} short of full doubles`
                  : FIT_LABEL[sc.fit]}
                {sc.restingPerGame > 0 ? `, ${sc.restingPerGame} resting` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
