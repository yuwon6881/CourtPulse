import React from 'react';
import type { FootwearAndConsumableItem } from '../types/equipment';
import { Button } from './ui/Button';

interface ShuttleTubeRowProps {
  tube: FootwearAndConsumableItem;
  lowThreshold: number;
  readOnly: boolean;
  onUseShuttle: (tubeId: string) => void;
  onFinishTube: (tubeId: string) => void;
  onRestockTube: (tubeId: string) => void;
  onRemoveFinishedTube: (tubeId: string) => void;
}

export const EquipmentShuttleTubeRow = React.memo<ShuttleTubeRowProps>(
  ({ tube, lowThreshold, readOnly, onUseShuttle, onFinishTube, onRestockTube, onRemoveFinishedTube }) => {
    const totalPcs = Math.max(1, tube.maxRecommendedHours || 12);
    const remainingPcs = Math.max(0, totalPcs - tube.hoursOrSessionsUsed);
    const isFinished = remainingPcs === 0;
    const isLow = !isFinished && remainingPcs <= lowThreshold;

    const segmentCount = Math.min(12, totalPcs);
    const filledSegments = Math.round((remainingPcs / totalPcs) * segmentCount);

    return (
      <div className="p-4 sm:p-5 space-y-2.5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-bold text-slate-900 truncate">{tube.brandModel}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">{tube.statusNote}</p>
          </div>

          {!readOnly && (
          <div className="grid grid-cols-2 gap-1.5 shrink-0">
            {isFinished ? (
              <>
                <Button size="sm" variant="success" onClick={() => onRestockTube(tube.id)}>
                  Refill {totalPcs}
                </Button>
                <Button size="sm" onClick={() => onRemoveFinishedTube(tube.id)}>
                  Remove
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => onUseShuttle(tube.id)}
                  aria-label={`Use one shuttle from ${tube.brandModel}`}
                >
                  Use 1
                </Button>
                <Button size="sm" variant="destructive" onClick={() => onFinishTube(tube.id)}>
                  Mark empty
                </Button>
              </>
            )}
          </div>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <div
            role="meter"
            aria-label={`${remainingPcs} of ${totalPcs} shuttles left`}
            aria-valuemin={0}
            aria-valuemax={totalPcs}
            aria-valuenow={remainingPcs}
            className="flex-1 grid gap-1"
            style={{ gridTemplateColumns: `repeat(${segmentCount}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: segmentCount }, (_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-colors duration-300 ${
                  idx >= filledSegments
                    ? 'bg-slate-200/80'
                    : isLow
                    ? 'bg-amber-400'
                    : 'bg-emerald-500'
                }`}
              />
            ))}
          </div>
          <span
            className={`w-12 text-right text-xs font-mono tabular-nums font-semibold shrink-0 ${
              isFinished ? 'text-rose-600' : isLow ? 'text-amber-700' : 'text-slate-600'
            }`}
          >
            {isFinished ? '0 left' : `${remainingPcs}/${totalPcs}`}
          </span>
        </div>
      </div>
    );
  }
);
EquipmentShuttleTubeRow.displayName = 'EquipmentShuttleTubeRow';
