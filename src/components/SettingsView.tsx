import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  Club,
  PermissionTier,
  Player,
} from '../types';

export type SettingsSectionTab = 'profile' | 'club_policy' | 'payment' | 'invites';

interface SettingsViewProps {
  activePlayer: Player;
  activeClub: Club;
  joinedClubs: Club[];
  permissionTier: PermissionTier;
  onUpdateOwnProfile: (updates: {
    name: string;
  }) => Promise<void>;
  onOpenClubsView?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activePlayer,
  activeClub,
  joinedClubs,
  permissionTier,
  onUpdateOwnProfile,
}) => {
  const [profileName, setProfileName] = useState(activePlayer.name);
  const [profileSavedToast, setProfileSavedToast] = useState(false);

  useEffect(() => {
    setProfileName(activePlayer.name);
  }, [activePlayer]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) return;
    await onUpdateOwnProfile({
      name: profileName.trim(),
    });
    setProfileSavedToast(true);
    setTimeout(() => setProfileSavedToast(false), 2500);
  };

  const roleLabel =
    permissionTier === 'admin'
      ? 'Platform Site Admin'
      : permissionTier === 'club_owner'
      ? 'Club Owner'
      : 'Club Member';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight font-display">
            Personal Settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage your player display name and view your joined club workspaces.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 font-mono shrink-0">
          <span>Player Tag:</span>
          <span className="font-bold text-slate-900">{activePlayer.playerTag}</span>
        </div>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* SECTION 1: PLAYER IDENTITY */}
        <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display">
                  Player Identity
                </h2>
                <p className="text-xs text-slate-500">
                  Your public display name and unique identifier across session rosters and scoreboards.
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-emerald-700">
              {roleLabel}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                required
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Shown on court lineups, standings, and fee split ledgers.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                Unique Player Tag &amp; Rating
              </label>
              <div className="h-10 bg-slate-100 border border-slate-200 rounded-xl px-3.5 flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-slate-800">
                  {activePlayer.playerTag}
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  Rating: <strong className="text-slate-900">{activePlayer.ratingScore}</strong> pts ({activePlayer.wins}W–{activePlayer.losses}L)
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Calibrated automatically from logged singles and doubles matches.
              </p>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Wallet Benefits Status</span>
              <span className="font-mono font-bold text-emerald-700">
                {activePlayer.waiveAllFees
                  ? 'VIP Fee Waiver Active'
                  : `${activePlayer.freeSessionPasses || 0} Passes · $${(
                      activePlayer.creditBalance || 0
                    ).toFixed(2)} Credit`}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Available passes and club credits are automatically applied before any out-of-pocket fee share is billed.
            </p>
          </div>
        </section>

        {/* SAVE ACTION BAR */}
        <div className="bg-white border border-slate-200/90 rounded-2xl px-5 py-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {profileSavedToast ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                <Check className="w-4 h-4" />
                Personal profile saved!
              </span>
            ) : (
              <span>
                Your personal profile updates apply immediately across all {joinedClubs.length} joined club(s).
              </span>
            )}
          </div>
          <button
            type="submit"
            className="h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs self-start sm:self-auto"
          >
            Save Personal Settings
          </button>
        </div>
      </form>

      {/* SECTION 4: SEPARATED CLUB MEMBERSHIP OVERVIEW */}
      <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display">
                Joined Clubs &amp; Active Workspace
              </h2>
              <p className="text-xs text-slate-500">
                You are a member of {joinedClubs.length} club(s). Current active workspace: <strong className="text-slate-800">{activeClub.name}</strong>.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {joinedClubs.map((club) => {
            const isOwner = club.clubOwnerPlayerId === activePlayer.id;
            const isActive = club.id === activeClub.id;
            return (
              <div
                key={club.id}
                className={`rounded-xl border p-3.5 text-xs space-y-1 ${
                  isActive
                    ? 'border-slate-900 bg-slate-50/70'
                    : 'border-slate-200/80 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 truncate">
                    {club.name}
                  </span>
                  {isOwner ? (
                    <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1 shrink-0">
                      <ShieldCheck className="w-3 h-3" />
                      Owner
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 shrink-0">
                      Member
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate">
                  Free cancel &gt;{club.freeCancelHours}h · Late {club.lateCancelFeePercent}%
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
