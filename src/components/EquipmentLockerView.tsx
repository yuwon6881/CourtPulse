import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Feather, Gauge, Plus, Swords, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { EquipmentLockerViewProps, UsageProfilePreset } from '../types/equipment';
import {
  INITIAL_CONSUMABLES,
  INITIAL_PLAYER_PROFILES,
  INITIAL_RACKETS,
  INITIAL_STRING_LOGS,
} from '../data/seedEquipment';
import { createEquipmentIndex } from '../utils/equipmentIndex';
import { getUsageProfileConfig, todayIsoDate } from '../utils/equipmentMath';
import type { EquipmentStoreState } from '../utils/equipmentStorage';
import { useEquipmentStore } from './useEquipmentStore';
import { EquipmentLockerStats, EquipmentSyncNote } from './EquipmentLockerSummary';
import { EquipmentSection } from './EquipmentSection';
import {
  type AddRacketPayload,
  type AddShuttleTubePayload,
  type GripChangePayload,
  type RestringPayload,
  addRacketToLocker,
  addShuttleTube,
  changeRacketGrip,
  clearArchivedStringLogs,
  finishShuttleTube,
  getRacketLabel,
  markRacketStringSnapped,
  removeShuttleTube,
  restockShuttleTube,
  restringRacket,
  rewrapRacketGrip,
  setPlayerProfilePreset,
  takeShuttleFromTube,
} from '../utils/equipmentActions';
import {
  AddRacketModal,
  AddShuttleTubeModal,
  ChangeGripModal,
  RestringModal,
} from './EquipmentModals';
import { EquipmentRacketRow } from './EquipmentRacketRow';
import { EquipmentShuttleTubeRow } from './EquipmentShuttleTubeRow';
import { EquipmentStringingHistory } from './EquipmentStringingHistory';
import { Button } from './ui/Button';
import { SegmentedControl, StyledSelect } from './ui/FormControls';

const PROFILE_OPTIONS: { value: UsageProfilePreset; label: string }[] = (
  ['cost_saving', 'balanced', 'performance'] as const
).map((value) => ({ value, label: getUsageProfileConfig(value).label }));

const SEED_STORE: EquipmentStoreState = {
  rackets: INITIAL_RACKETS,
  stringLogs: INITIAL_STRING_LOGS,
  consumables: INITIAL_CONSUMABLES,
  playerProfiles: INITIAL_PLAYER_PROFILES,
};

type ModalState =
  | { kind: 'none' }
  | { kind: 'restring'; racketId: string }
  | { kind: 'grip'; racketId: string }
  | { kind: 'add_racket' }
  | { kind: 'add_tube' };

export const EquipmentLockerView: React.FC<EquipmentLockerViewProps> = ({
  player,
  allPlayers,
  onSelectPlayer,
  canEdit,
  cloudOwnerId,
}) => {
  const { store, setStore, status, syncError } = useEquipmentStore(cloudOwnerId, SEED_STORE);
  const [feedback, setFeedback] = useState('');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const today = todayIsoDate();
  const isEditable = canEdit && status !== 'loading' && status !== 'error';

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(''), 2500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const activeProfilePreset: UsageProfilePreset =
    store.playerProfiles?.[player.id] ?? player.defaultProfile ?? 'balanced';
  const activeProfileConfig = getUsageProfileConfig(activeProfilePreset);

  const equipmentIndex = useMemo(
    () =>
      createEquipmentIndex({
        playerId: player.id,
        rackets: store.rackets,
        stringLogs: store.stringLogs,
        consumables: store.consumables,
        profilePreset: activeProfilePreset,
        playerMatchesPlayed: player.matchesPlayed,
        referenceDate: today,
      }),
    [player.id, player.matchesPlayed, store, activeProfilePreset, today]
  );
  const { playerRackets, racketById, shuttleTubes, summary } = equipmentIndex;

  const racketLabel = useCallback(
    (racketId: string) => getRacketLabel(racketById.get(racketId)),
    [racketById]
  );
  const tubeLabel = useCallback(
    (tubeId: string) =>
      store.consumables.find((c) => c.id === tubeId)?.brandModel ?? 'tube',
    [store.consumables]
  );

  const closeModal = useCallback(() => setModal({ kind: 'none' }), []);

  const handleSelectProfilePreset = (preset: UsageProfilePreset) => {
    setStore((prev) => setPlayerProfilePreset(prev, player.id, preset));
    setFeedback(`Care schedule set to ${getUsageProfileConfig(preset).label}`);
  };

  const handleRestring = useCallback(
    (payload: RestringPayload) => {
      setStore((prev) =>
        restringRacket(prev, payload, { today, newLogId: `slog-${Date.now()}` })
      );
      setFeedback(
        `Restrung ${racketLabel(payload.racketId)} (${payload.stringModel} at ${payload.mainTensionLbs} lbs)`
      );
    },
    [today, racketLabel]
  );

  const handleQuickRepeatRestring = useCallback(
    (racketId: string) => {
      const prevLog =
        equipmentIndex.activeLogByRacketId.get(racketId) ||
        equipmentIndex.latestLogByRacketId.get(racketId);
      if (!prevLog) return;
      handleRestring({
        racketId,
        stringModel: prevLog.stringModel,
        gaugeMm: prevLog.gaugeMm,
        mainTensionLbs: prevLog.mainTensionLbs,
        crossTensionLbs: prevLog.crossTensionLbs,
        strungAtDate: today,
      });
    },
    [equipmentIndex, handleRestring, today]
  );

  const handleMarkSnapped = useCallback(
    (racketId: string) => {
      setStore((prev) => markRacketStringSnapped(prev, racketId, today));
      setFeedback(`Marked ${racketLabel(racketId)} as snapped`);
    },
    [today, racketLabel]
  );

  const handleRewrapGrip = useCallback(
    (racketId: string) => {
      setStore((prev) => rewrapRacketGrip(prev, racketId, today));
      setFeedback(`Fresh grip wrapped on ${racketLabel(racketId)}`);
    },
    [today, racketLabel]
  );

  const handleChangeGrip = useCallback(
    (payload: GripChangePayload) => {
      setStore((prev) => changeRacketGrip(prev, payload));
      setFeedback(`Updated grip on ${racketLabel(payload.racketId)} (${payload.gripBrandModel})`);
    },
    [racketLabel]
  );

  const handleAddRacket = (payload: AddRacketPayload) => {
    const stamp = Date.now();
    setStore((prev) =>
      addRacketToLocker(prev, payload, {
        playerId: player.id,
        today,
        racketId: `rkt-${stamp}`,
        logId: `slog-init-${stamp}`,
      })
    );
    setFeedback(`Added ${payload.model}`);
  };

  const handleUseShuttle = useCallback(
    (tubeId: string) => {
      setStore((prev) => takeShuttleFromTube(prev, tubeId));
      setFeedback(`Used 1 shuttle from ${tubeLabel(tubeId)}`);
    },
    [tubeLabel]
  );

  const handleFinishTube = useCallback(
    (tubeId: string) => {
      setStore((prev) => finishShuttleTube(prev, tubeId));
      setFeedback(`${tubeLabel(tubeId)} marked empty`);
    },
    [tubeLabel]
  );

  const handleRestockTube = useCallback(
    (tubeId: string) => {
      setStore((prev) => restockShuttleTube(prev, tubeId, today));
      setFeedback(`Refilled ${tubeLabel(tubeId)}`);
    },
    [today, tubeLabel]
  );

  const handleRemoveTube = useCallback(
    (tubeId: string) => {
      setStore((prev) => removeShuttleTube(prev, tubeId));
      setFeedback(`Removed empty tube (${tubeLabel(tubeId)})`);
    },
    [tubeLabel]
  );

  const handleAddTube = (payload: AddShuttleTubePayload) => {
    setStore((prev) =>
      addShuttleTube(prev, payload, { playerId: player.id, today, tubeId: `cons-${Date.now()}` })
    );
    setFeedback(`Added ${payload.brandModel} (${payload.shuttleCount} shuttles)`);
  };

  const handleClearArchived = () => {
    const playerRacketIds = new Set(playerRackets.map((r) => r.id));
    setStore((prev) => clearArchivedStringLogs(prev, playerRacketIds));
    setFeedback('Cleared old stringing logs. Current strings are kept.');
  };

  const modalRacketId =
    modal.kind === 'restring' || modal.kind === 'grip' ? modal.racketId : '';
  const restringLog =
    equipmentIndex.activeLogByRacketId.get(modalRacketId) ||
    equipmentIndex.latestLogByRacketId.get(modalRacketId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Gear Locker
          </h1>
          <EquipmentSyncNote status={status} canEdit={canEdit} playerName={player.name} />
        </div>

        {isEditable && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end gap-2 shrink-0">
            <Button size="lg" onClick={() => setModal({ kind: 'add_tube' })}>
              <Plus className="w-3.5 h-3.5" />
              Shuttle tube
            </Button>
            <Button size="lg" variant="primary" onClick={() => setModal({ kind: 'add_racket' })}>
              <Plus className="w-3.5 h-3.5" />
              Racket
            </Button>
          </div>
        )}
      </div>

      <EquipmentLockerStats summary={summary} />

      {syncError && (
        <p role="alert" className="px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          {syncError}
        </p>
      )}

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl border border-slate-200/80 bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Gauge className="w-4 h-4" />
          </div>
          <p className="text-sm font-bold text-slate-900">Care schedule</p>
        </div>
        {isEditable ? (
          <SegmentedControl
            options={PROFILE_OPTIONS}
            value={activeProfilePreset}
            onChange={handleSelectProfilePreset}
          />
        ) : (
          <span className="self-start md:self-auto h-7 px-2.5 rounded-lg bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center shrink-0">
            {activeProfileConfig.label}
          </span>
        )}
      </div>

      {status === 'loading' ? (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-10 text-center">
          <p className="text-xs text-slate-500 animate-pulse">Loading gear…</p>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <EquipmentSection
          title="Rackets, Strings & Grips"
          icon={<Swords className="w-3.5 h-3.5" />}
          tone="emerald"
          count={playerRackets.length}
          className="lg:col-span-7"
        >
          {playerRackets.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-xs text-slate-500">
                No rackets in {player.name}&apos;s locker yet.
              </p>
              {isEditable && (
                <Button variant="primary" onClick={() => setModal({ kind: 'add_racket' })}>
                  <Plus className="w-3.5 h-3.5" />
                  Add racket
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {playerRackets.map((racket) => {
                const rec = equipmentIndex.durationRecByRacketId.get(racket.id);
                const gripStatus = equipmentIndex.gripStatusByRacketId.get(racket.id);
                if (!rec || !gripStatus) return null;
                return (
                  <EquipmentRacketRow
                    key={racket.id}
                    racket={racket}
                    currentLog={equipmentIndex.activeLogByRacketId.get(racket.id)}
                    latestLog={equipmentIndex.latestLogByRacketId.get(racket.id)}
                    durationRec={rec}
                    gripStatus={gripStatus}
                    profilePreset={activeProfilePreset}
                    readOnly={!isEditable}
                    onOpenRestring={(id) => setModal({ kind: 'restring', racketId: id })}
                    onQuickRepeatRestring={handleQuickRepeatRestring}
                    onMarkSnapped={handleMarkSnapped}
                    onResetGrip={handleRewrapGrip}
                    onOpenChangeGrip={(id) => setModal({ kind: 'grip', racketId: id })}
                  />
                );
              })}
            </div>
          )}
        </EquipmentSection>

        <div className="lg:col-span-5 space-y-4">
          <EquipmentSection
            title="Shuttle Tubes"
            icon={<Feather className="w-3.5 h-3.5" />}
            tone="amber"
            count={shuttleTubes.length}
            delay={0.05}
          >
            {shuttleTubes.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <p className="text-xs text-slate-400">No shuttle tubes recorded.</p>
                {isEditable && (
                  <Button size="sm" onClick={() => setModal({ kind: 'add_tube' })}>
                    <Plus className="w-3.5 h-3.5" />
                    Add tube
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {shuttleTubes.map((tube) => (
                  <EquipmentShuttleTubeRow
                    key={tube.id}
                    tube={tube}
                    lowThreshold={activeProfileConfig.shuttleLowThreshold}
                    readOnly={!isEditable}
                    onUseShuttle={handleUseShuttle}
                    onFinishTube={handleFinishTube}
                    onRestockTube={handleRestockTube}
                    onRemoveFinishedTube={handleRemoveTube}
                  />
                ))}
              </div>
            )}
          </EquipmentSection>

          <EquipmentStringingHistory
            playerId={player.id}
            today={today}
            playerRackets={playerRackets}
            racketById={racketById}
            sortedLogs={equipmentIndex.playerStringLogsSorted}
            onClearArchived={isEditable ? handleClearArchived : undefined}
          />
        </div>
      </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="fixed bottom-20 md:bottom-4 right-4 left-4 sm:left-auto z-50 sm:max-w-sm bg-slate-900 text-white pl-3.5 pr-1.5 py-1.5 rounded-xl shadow-xl shadow-slate-900/20 flex items-center justify-between gap-3 text-xs"
          >
            <span className="truncate">{feedback}</span>
            <button
              type="button"
              onClick={() => setFeedback('')}
              aria-label="Dismiss notification"
              className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-white rounded-lg shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <RestringModal
        isOpen={modal.kind === 'restring'}
        today={today}
        rackets={playerRackets}
        defaultRacketId={modalRacketId}
        defaultStringModel={restringLog?.stringModel}
        defaultTensionLbs={restringLog?.mainTensionLbs}
        onClose={closeModal}
        onSubmit={handleRestring}
      />
      <ChangeGripModal
        isOpen={modal.kind === 'grip'}
        today={today}
        rackets={playerRackets}
        defaultRacketId={modalRacketId}
        defaultGripBrandModel={racketById.get(modalRacketId)?.gripBrandModel}
        onClose={closeModal}
        onSubmit={handleChangeGrip}
      />
      <AddRacketModal
        isOpen={modal.kind === 'add_racket'}
        today={today}
        onClose={closeModal}
        onAddRacket={handleAddRacket}
      />
      <AddShuttleTubeModal
        isOpen={modal.kind === 'add_tube'}
        onClose={closeModal}
        onAddTube={handleAddTube}
      />
    </div>
  );
};
