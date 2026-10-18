import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { RacketGearItem, StringingLogEntry } from '../types/equipment';
import { paginatePlayerStringLogs } from '../utils/equipmentIndex';
import { calculateDaysElapsed } from '../utils/equipmentMath';
import { getRacketLabel } from '../utils/equipmentActions';
import { Button } from './ui/Button';
import { StyledSelect } from './ui/FormControls';

const HISTORY_PAGE_SIZE = 8;

const OUTCOME_LABEL: Record<NonNullable<StringingLogEntry['outcome']>, string> = {
  active: 'On racket',
  snapped: 'Snapped',
  cut_for_fresh_bed: 'Replaced',
};

interface StringingHistoryProps {
  playerId: string;
  today: string;
  playerRackets: RacketGearItem[];
  racketById: Map<string, RacketGearItem>;
  sortedLogs: StringingLogEntry[];
  onClearArchived?: () => void;
}

export const EquipmentStringingHistory: React.FC<StringingHistoryProps> = ({
  playerId,
  today,
  playerRackets,
  racketById,
  sortedLogs,
  onClearArchived,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [filterRacketId, setFilterRacketId] = useState('');

  useEffect(() => {
    setPage(1);
    setFilterRacketId('');
  }, [playerId]);

  const history = useMemo(
    () =>
      paginatePlayerStringLogs({
        stringLogs: sortedLogs,
        racketById,
        page,
        pageSize: HISTORY_PAGE_SIZE,
        filterRacketId: filterRacketId || undefined,
        alreadyFilteredAndSorted: true,
      }),
    [sortedLogs, racketById, page, filterRacketId]
  );

  const hasArchivedLogs = sortedLogs.some((l) => l.outcome !== 'active');

  return (
    <section
      aria-label="Stringing history"
      className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full px-4 sm:px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors cursor-pointer ${
          isOpen ? 'rounded-t-2xl' : 'rounded-2xl'
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg border border-violet-200/80 bg-violet-50 text-violet-700 flex items-center justify-center shrink-0">
            <History className="w-3.5 h-3.5" />
          </span>
          <span className="text-sm font-bold text-slate-900 truncate">Stringing History</span>
          <span className="h-5 min-w-5 px-1.5 rounded-full bg-slate-100 text-[11px] font-mono font-semibold tabular-nums text-slate-600 inline-flex items-center justify-center">
            {sortedLogs.length}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
          className="border-t border-slate-100"
        >
          <div className="px-4 sm:px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between gap-2">
            <StyledSelect
              aria-label="Filter history by racket"
              value={filterRacketId}
              onChange={(e) => {
                setFilterRacketId(e.target.value);
                setPage(1);
              }}
              containerClassName="w-48 min-w-0"
            >
              <option value="">{`All rackets (${sortedLogs.length})`}</option>
              {playerRackets.map((r) => (
                <option key={r.id} value={r.id}>
                  {getRacketLabel(r)}
                </option>
              ))}
            </StyledSelect>

            {hasArchivedLogs && onClearArchived && (
              <Button size="sm" onClick={onClearArchived}>
                Clear old logs
              </Button>
            )}
          </div>

          {history.visibleLogs.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-400">No stringing logged yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {history.visibleLogs.map((log) => {
                const spanDays = calculateDaysElapsed(log.strungAtDate, log.brokenOrCutDate || today);
                const outcome = log.outcome ?? 'active';
                return (
                  <li key={log.id} className="px-4 sm:px-5 py-2.5 hover:bg-slate-50/60 transition-colors flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">
                        {getRacketLabel(racketById.get(log.racketId))} · {log.stringModel}
                      </p>
                      <p className="text-[11px] font-mono tabular-nums text-slate-400">
                        Strung {log.strungAtDate} · lasted {spanDays}d
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <p className="text-slate-800 font-medium">{log.mainTensionLbs} lbs</p>
                      <p
                        className={`text-[11px] font-sans ${
                          outcome === 'active'
                            ? 'text-emerald-700'
                            : outcome === 'snapped'
                            ? 'text-rose-600'
                            : 'text-slate-400'
                        }`}
                      >
                        {OUTCOME_LABEL[outcome]}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {history.totalPages > 1 && (
            <div className="px-4 sm:px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 rounded-b-2xl flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-mono tabular-nums">
                Page {history.page} of {history.totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  disabled={history.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous history page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  disabled={!history.hasMore}
                  onClick={() => setPage((p) => Math.min(history.totalPages, p + 1))}
                  aria-label="Next history page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </section>
  );
};
