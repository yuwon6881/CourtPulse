import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  Plus,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Player, RankedPlayer, Session, SessionRsvp, TierRank } from '../types';
import { getSessionGoingHeadcount, hasPlayerJoinedClub } from '../utils/badmintonLogic';
import { Button } from './ui/Button';
import { FormAlertBanner, StyledInput } from './ui/FormControls';
import { Modal } from './ui/Modal';

export interface AddPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: Session;
  players: Player[];
  sessionRsvps: SessionRsvp[];
  rankedPlayers?: (Player | RankedPlayer)[];
  onAddPlayer: (
    player: Player,
    guestCount: number,
    allowCapacityOverride?: boolean
  ) => Promise<{ ok: boolean; reason?: string }>;
}

const TIER_BADGE_STYLES: Record<TierRank, string> = {
  S: 'bg-purple-50 text-purple-700 border-purple-200',
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-sky-50 text-sky-700 border-sky-200',
  C: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const AddPlayerModal: React.FC<AddPlayerModalProps> = ({
  isOpen,
  onClose,
  session,
  players,
  sessionRsvps,
  rankedPlayers,
  onAddPlayer,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState<number>(0);
  const [allowCapacityOverride, setAllowCapacityOverride] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filter to active club members
  const clubMembers = useMemo(() => {
    return players.filter((p) => hasPlayerJoinedClub(p, session.clubId));
  }, [players, session.clubId]);

  // Lookup map for existing RSVPs in this session
  const rsvpByPlayerId = useMemo(() => {
    const map = new Map<string, SessionRsvp>();
    for (const r of sessionRsvps) {
      map.set(r.playerId, r);
    }
    return map;
  }, [sessionRsvps]);

  // Lookup map for ranked player metadata (tiers, form, ratings)
  const rankedMap = useMemo(() => {
    const map = new Map<string, RankedPlayer>();
    if (rankedPlayers) {
      for (const rp of rankedPlayers) {
        if ('tier' in rp && typeof rp.tier === 'string') {
          map.set(rp.id, rp as RankedPlayer);
        }
      }
    }
    return map;
  }, [rankedPlayers]);

  // Filtered members based on search query (name or #tag)
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clubMembers;
    return clubMembers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.playerTag.toLowerCase().includes(q)
    );
  }, [clubMembers, searchQuery]);

  const selectedPlayer = useMemo(
    () => clubMembers.find((p) => p.id === selectedPlayerId) || null,
    [clubMembers, selectedPlayerId]
  );

  const selectedPlayerRsvp = selectedPlayer
    ? rsvpByPlayerId.get(selectedPlayer.id)
    : undefined;
  const isSelectedEnrolled = selectedPlayerRsvp?.status === 'going';
  const isSelectedCancelled =
    selectedPlayerRsvp?.status === 'out' || selectedPlayerRsvp?.status === 'late_out';

  // Capacity calculations
  const goingHeadcount = useMemo(
    () => getSessionGoingHeadcount(sessionRsvps),
    [sessionRsvps]
  );
  const maxPlayers = session.maxPlayers;
  const spotsOpen = Math.max(0, maxPlayers - goingHeadcount);
  const isRosterFull = spotsOpen <= 0;
  const partySizeToAdd = selectedPlayer ? 1 + guestCount : 0;
  const wouldExceedCapacity =
    selectedPlayer !== null && goingHeadcount + partySizeToAdd > maxPlayers;
  const spotsOverLimit = Math.max(0, goingHeadcount + partySizeToAdd - maxPlayers);

  const handleClose = () => {
    if (isSubmitting) return;
    setSearchQuery('');
    setSelectedPlayerId(null);
    setGuestCount(0);
    setAllowCapacityOverride(false);
    setErrorMessage(null);
    onClose();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedPlayer || isSubmitting) return;

    if (isSelectedEnrolled) {
      setErrorMessage(`${selectedPlayer.name} is already enrolled in this session.`);
      return;
    }

    if (wouldExceedCapacity && !allowCapacityOverride) {
      setErrorMessage(
        `This session is at capacity (${goingHeadcount}/${maxPlayers}). Please check the manager capacity override below to proceed.`
      );
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const result = await onAddPlayer(selectedPlayer, guestCount, allowCapacityOverride);
      if (result.ok) {
        handleClose();
      } else {
        setErrorMessage(result.reason || 'Failed to add player to session.');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : 'An unexpected error occurred while adding the player.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Add Player to Session"
      description={`Add an existing club member directly into ${session.title}`}
      icon={<UserPlus className="w-5 h-5 text-emerald-700" />}
      onClose={handleClose}
      onSubmit={handleSubmit}
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="text-[11px] text-slate-500 truncate">
            {selectedPlayer ? (
              <span>
                Adding <strong className="text-slate-800">{selectedPlayer.name}</strong>
                {guestCount > 0 ? ` +${guestCount} guest(s)` : ''}
              </span>
            ) : (
              <span>Select a member from the list</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isSubmitting}
              onClick={handleClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={
                !selectedPlayer ||
                isSelectedEnrolled ||
                isSubmitting ||
                (wouldExceedCapacity && !allowCapacityOverride)
              }
              className="min-w-[110px]"
            >
              {isSubmitting ? (
                <span>Adding...</span>
              ) : wouldExceedCapacity ? (
                <span>Add (Override)</span>
              ) : (
                <span>Add Player</span>
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {errorMessage && (
          <FormAlertBanner
            variant="error"
            message={errorMessage}
            onDismiss={() => setErrorMessage(null)}
          />
        )}

        {/* Capacity Indicator Pill */}
        <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/90 bg-slate-50/70 text-xs">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="font-semibold text-slate-800">
              Session Capacity
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono tabular-nums text-slate-600">
              {goingHeadcount} / {maxPlayers} spots
            </span>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                isRosterFull
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : spotsOpen <= 2
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {isRosterFull ? 'Full' : `${spotsOpen} open`}
            </span>
          </div>
        </div>

        {/* Search Input */}
        <div>
          <StyledInput
            id="member-search-input"
            label="Search Club Member"
            icon={<Search className="w-4 h-4 text-slate-400" />}
            placeholder="Search by name or #tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isSubmitting}
            autoFocus
          />
        </div>

        {/* Member Candidate List */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
            <span>Club Members ({filteredMembers.length})</span>
            {selectedPlayer && (
              <span className="text-emerald-700 font-medium">
                1 member selected
              </span>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-200/90 rounded-xl bg-white shadow-2xs">
            {filteredMembers.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {searchQuery
                  ? `No club members match "${searchQuery}".`
                  : 'No club members found.'}
              </div>
            ) : (
              filteredMembers.map((member) => {
                const existingRsvp = rsvpByPlayerId.get(member.id);
                const isEnrolled = existingRsvp?.status === 'going';
                const isCancelled =
                  existingRsvp?.status === 'out' || existingRsvp?.status === 'late_out';
                const isSelected = selectedPlayerId === member.id;
                const ranked = rankedMap.get(member.id);

                return (
                  <div
                    key={member.id}
                    onClick={() => {
                      if (isEnrolled || isSubmitting) return;
                      setSelectedPlayerId(isSelected ? null : member.id);
                      setErrorMessage(null);
                    }}
                    role="button"
                    tabIndex={isEnrolled ? -1 : 0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!isEnrolled && !isSubmitting) {
                          setSelectedPlayerId(isSelected ? null : member.id);
                          setErrorMessage(null);
                        }
                      }
                    }}
                    className={`w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left transition-colors select-none ${
                      isEnrolled
                        ? 'opacity-40 bg-slate-50/70 cursor-not-allowed'
                        : isSelected
                        ? 'bg-emerald-50/80 ring-1 ring-emerald-500/30 cursor-pointer'
                        : 'hover:bg-slate-50/80 cursor-pointer'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : isEnrolled
                            ? 'border-slate-300 bg-slate-200 text-slate-400'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {member.name}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {member.playerTag}
                          </span>
                          {ranked && ranked.tier && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                TIER_BADGE_STYLES[ranked.tier] || TIER_BADGE_STYLES.C
                              }`}
                              title={ranked.tierTitle}
                            >
                              Tier {ranked.tier}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isEnrolled ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Enrolled</span>
                        </span>
                      ) : isCancelled ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700">
                          {existingRsvp.status === 'late_out' ? 'Late Out' : 'Cancelled'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Member Details & Guest Stepper */}
        {selectedPlayer && !isSelectedEnrolled && (
          <div className="space-y-3 pt-1 border-t border-slate-100">
            {isSelectedCancelled && (
              <div className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/70 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>{selectedPlayer.name}</strong> previously cancelled their spot. Adding them will reactivate their enrollment and reset their attendance to present.
                </span>
              </div>
            )}

            <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/90 bg-slate-50/50">
              <div>
                <span className="text-xs font-semibold text-slate-900 block">
                  Additional Guests (+1 to +4)
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Billed to {selectedPlayer.name} ({partySizeToAdd} total spot{partySizeToAdd > 1 ? 's' : ''})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={guestCount <= 0 || isSubmitting}
                  onClick={() => setGuestCount((prev) => Math.max(0, prev - 1))}
                  aria-label="Decrease guest count"
                  className="w-8 h-8 p-0"
                >
                  <Minus className="w-3.5 h-3.5" />
                </Button>
                <span className="w-10 text-center text-xs font-bold font-mono tabular-nums text-slate-900">
                  +{guestCount}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={guestCount >= 4 || isSubmitting}
                  onClick={() => setGuestCount((prev) => Math.min(4, prev + 1))}
                  aria-label="Increase guest count"
                  className="w-8 h-8 p-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Capacity Warning & Manager Override Checkbox */}
            {wouldExceedCapacity && (
              <div className="space-y-2 p-3 rounded-xl border border-amber-200 bg-amber-50/60">
                <div className="flex items-start gap-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Capacity Warning</span>
                    <span>
                      Adding this party ({partySizeToAdd} player{partySizeToAdd > 1 ? 's' : ''}) exceeds the session capacity by {spotsOverLimit} spot{spotsOverLimit > 1 ? 's' : ''} ({goingHeadcount + partySizeToAdd}/{maxPlayers}).
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2 pt-1 border-t border-amber-200/70 text-xs text-amber-950 font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allowCapacityOverride}
                    onChange={(e) => setAllowCapacityOverride(e.target.checked)}
                    disabled={isSubmitting}
                    className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500/20 cursor-pointer"
                  />
                  <span>Confirm Manager Capacity Override</span>
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
