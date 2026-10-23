import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  LogOut,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import {
  Club,
  OutstandingDebtItem,
  PermissionTier,
  Player,
  PlayerBenefitWallet,
} from '../types';
import { formatClubCurrency, getPlayerClubWallet } from '../utils/badmintonLogic';
import { ConfirmModal, FormAlertBanner, StyledInput } from './ui/FormControls';

export type SettingsSectionTab = 'profile' | 'club_policy' | 'payment' | 'invites';

interface SettingsViewProps {
  activePlayer: Player;
  activeClub: Club;
  joinedClubs: Club[];
  activePlayerDebts?: OutstandingDebtItem[];
  walletsMap?: Record<string, PlayerBenefitWallet>;
  permissionTier: PermissionTier;
  onUpdateOwnProfile: (updates: {
    name: string;
  }) => Promise<void>;
  onLeaveClub?: (clubId: string) => Promise<void>;
  onDeleteOwnAccount?: (options?: { password?: string }) => Promise<void>;
  /** How the account proves it is really the owner before deletion. */
  reauthMethod?: 'password' | 'google' | 'unknown';
  onOpenClubsView?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activePlayer,
  activeClub,
  joinedClubs,
  activePlayerDebts = [],
  walletsMap,
  permissionTier,
  onUpdateOwnProfile,
  onLeaveClub,
  onDeleteOwnAccount,
  reauthMethod = 'unknown',
  onOpenClubsView,
}) => {
  const hasRealActiveClub =
    Boolean(activeClub) && activeClub.id !== 'club_empty_placeholder';
  const [profileName, setProfileName] = useState(activePlayer.name);
  const [profileNameError, setProfileNameError] = useState<string | undefined>(
    undefined
  );
  const [profileSavedToast, setProfileSavedToast] = useState(false);
  const [pendingLeaveClub, setPendingLeaveClub] = useState<Club | null>(null);
  const [leaveClubError, setLeaveClubError] = useState<string | null>(null);
  const [isLeavingClub, setIsLeavingClub] = useState(false);
  const [confirmDeleteAccountOpen, setConfirmDeleteAccountOpen] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);

  useEffect(() => {
    setProfileName(activePlayer.name);
    setProfileNameError(undefined);
  }, [activePlayer.id]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) {
      setProfileNameError('Please enter your display name.');
      return;
    }
    setProfileNameError(undefined);
    try {
      await onUpdateOwnProfile({
        name: profileName.trim(),
      });
    } catch (err) {
      // The name was rolled back by the caller; say why instead of claiming success.
      setProfileNameError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save your name. Please try again.'
      );
      return;
    }
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

      <form noValidate onSubmit={handleSaveProfile} className="space-y-6">
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
                  Your public display name and unique identifier across session player lists and scoreboards.
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-emerald-700">
              {roleLabel}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <StyledInput
              label="Display Name"
              type="text"
              value={profileName}
              error={profileNameError}
              helperText="Shown on court lineups, standings, and fee split ledgers."
              onChange={(e) => {
                setProfileName(e.target.value);
                if (profileNameError) setProfileNameError(undefined);
              }}
            />

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

          {hasRealActiveClub &&
            (() => {
              const activeWallet = getPlayerClubWallet(
                activePlayer,
                activeClub.id,
                walletsMap
              );
              return (
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">
                      {activeClub.name} Wallet Benefits Status
                    </span>
                    <span className="font-mono font-bold text-emerald-700">
                      {activeWallet.waiveAllFees
                        ? 'VIP Fee Waiver Active'
                        : `${activeWallet.freeSessionPasses || 0} Passes · ${formatClubCurrency(
                            activeWallet.creditBalance || 0,
                            activeClub
                          )} Credit`}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Each club maintains an independent wallet and balance. Available passes and credits in a club are automatically applied before any out-of-pocket fee share is billed.
                  </p>
                </div>
              );
            })()}
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
                {joinedClubs.length > 0 && hasRealActiveClub ? (
                  <>
                    You are a member of {joinedClubs.length} club(s). Current active workspace:{' '}
                    <strong className="text-slate-800">{activeClub.name}</strong>.
                  </>
                ) : (
                  'You have not joined any clubs yet.'
                )}
              </p>
            </div>
          </div>
        </div>

        {leaveClubError && (
          <FormAlertBanner
            variant="error"
            message={leaveClubError}
            onDismiss={() => setLeaveClubError(null)}
          />
        )}

        {joinedClubs.length === 0 ? (
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-5 text-center space-y-2.5">
            <p className="text-xs text-slate-600">
              Once you join a club, your club memberships and benefit wallets will appear here.
            </p>
            {onOpenClubsView && (
              <button
                type="button"
                onClick={onOpenClubsView}
                className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
              >
                Browse Clubs
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {joinedClubs.map((club) => {
              const isOwner = club.clubOwnerPlayerId === activePlayer.id;
              const isActive = club.id === activeClub.id;
              const clubWallet = getPlayerClubWallet(
                activePlayer,
                club.id,
                walletsMap
              );
              const clubUnpaidAmount = activePlayerDebts
                .filter(
                  (d) =>
                    d.rsvp.clubId === club.id &&
                    (d.rsvp.paidStatus === 'unpaid' ||
                      d.rsvp.paidStatus === 'pending_approval')
                )
                .reduce((acc, d) => acc + d.rsvp.feeShare, 0);
              return (
                <div
                  key={club.id}
                  className={`rounded-xl border p-3.5 text-xs space-y-2 flex flex-col justify-between ${
                    isActive
                      ? 'border-slate-900 bg-slate-50/70'
                      : 'border-slate-200/80 bg-white'
                  }`}
                >
                  <div className="space-y-1.5">
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
                    <p className="text-[11px] font-mono text-emerald-700 font-semibold truncate">
                      {clubWallet.waiveAllFees
                        ? 'VIP Fee Waiver Active'
                        : `Wallet: ${formatClubCurrency(clubWallet.creditBalance || 0, club)} · ${
                            clubWallet.freeSessionPasses || 0
                          } Free Pass(es)`}
                    </p>
                  </div>

                  {!isOwner && onLeaveClub && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      {clubUnpaidAmount > 0 ? (
                        <span className="text-[11px] font-mono font-semibold text-amber-700">
                          {formatClubCurrency(clubUnpaidAmount, club)} unsettled
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          Balance settled
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={clubUnpaidAmount > 0}
                        title={
                          clubUnpaidAmount > 0
                            ? `Settle ${formatClubCurrency(clubUnpaidAmount, club)} in unpaid session fees before leaving`
                            : `Leave ${club.name}`
                        }
                        onClick={() => {
                          setLeaveClubError(null);
                          setPendingLeaveClub(club);
                        }}
                        className="h-7 px-2.5 rounded-lg border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-rose-700 disabled:opacity-45 disabled:cursor-not-allowed text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Leave Club</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {onDeleteOwnAccount && (
        <section className="bg-white border border-rose-200/80 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 font-display">
                Account &amp; Data Deletion
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Permanently delete your player profile, open RSVPs, and gear locker once all club balances are settled and no clubs are owned by you.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDeleteAccountError(null);
                setDeleteModalError(null);
                setDeletePassword('');
                setConfirmDeleteAccountOpen(true);
              }}
              className="h-9 px-3.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete My Account</span>
            </button>
          </div>
          {deleteAccountError && (
            <FormAlertBanner
              variant="error"
              message={deleteAccountError}
              onDismiss={() => setDeleteAccountError(null)}
            />
          )}
        </section>
      )}

      {onLeaveClub && (
        <ConfirmModal
          open={Boolean(pendingLeaveClub)}
          title={
            pendingLeaveClub ? `Leave ${pendingLeaveClub.name}?` : 'Leave Club?'
          }
          description={
            pendingLeaveClub ? (
              <div className="space-y-1.5">
                <p>
                  Are you sure you want to leave{' '}
                  <strong className="font-semibold text-slate-900">
                    {pendingLeaveClub.name}
                  </strong>
                  ?
                </p>
                <p className="text-slate-600">
                  Any upcoming session RSVPs in this club will be withdrawn. You can rejoin later if it is public or request to join again if private.
                </p>
              </div>
            ) : null
          }
          confirmLabel={isLeavingClub ? 'Leaving...' : 'Confirm Leave Club'}
          variant="danger"
          onCancel={() => setPendingLeaveClub(null)}
          onConfirm={async () => {
            if (!pendingLeaveClub) return;
            const target = pendingLeaveClub;
            setIsLeavingClub(true);
            setLeaveClubError(null);
            try {
              await onLeaveClub(target.id);
              setPendingLeaveClub(null);
            } catch (err) {
              setLeaveClubError(
                err instanceof Error ? err.message : 'Unable to leave club.'
              );
              setPendingLeaveClub(null);
            } finally {
              setIsLeavingClub(false);
            }
          }}
        />
      )}

      {onDeleteOwnAccount && (
        <ConfirmModal
          open={confirmDeleteAccountOpen}
          title="Delete Your Account & Profile?"
          description={
            <div className="space-y-1.5">
              <p>
                Are you sure you want to permanently delete{' '}
                <strong className="font-semibold text-slate-900">
                  {activePlayer.name} ({activePlayer.playerTag})
                </strong>
                ?
              </p>
              <p className="text-slate-600">
                This removes your player profile, club memberships, open RSVPs, join requests, and gear locker, then deletes your sign-in. Unpaid session fees must be settled first, and a club you own must be transferred or deleted by a site admin first.
              </p>
              <p className="text-slate-600">
                Past session records and any club wallet balance stay with the club: only the club owner can remove a wallet, so ask them if you want it cleared.
              </p>
              {reauthMethod === 'password' && (
                <StyledInput
                  label="Confirm your password"
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => {
                    setDeletePassword(e.target.value);
                    if (deleteModalError) setDeleteModalError(null);
                  }}
                  helperText="Required to confirm it is really you."
                />
              )}
              {reauthMethod === 'google' && (
                <p className="text-slate-600">
                  You will be asked to confirm with Google in a pop-up.
                </p>
              )}
              {deleteModalError && (
                <FormAlertBanner variant="error" message={deleteModalError} />
              )}
            </div>
          }
          confirmLabel={isDeletingAccount ? 'Deleting...' : 'Delete My Account'}
          variant="danger"
          onCancel={() => setConfirmDeleteAccountOpen(false)}
          onConfirm={async () => {
            if (reauthMethod === 'password' && !deletePassword) {
              setDeleteModalError('Enter your password to continue.');
              return;
            }
            setIsDeletingAccount(true);
            setDeleteAccountError(null);
            setDeleteModalError(null);
            try {
              await onDeleteOwnAccount(
                reauthMethod === 'password' ? { password: deletePassword } : undefined
              );
              setDeletePassword('');
              setConfirmDeleteAccountOpen(false);
            } catch (err) {
              // Keep the dialog open so a wrong password can be corrected right away.
              setDeleteModalError(
                err instanceof Error && err.message
                  ? err.message
                  : 'Unable to delete account.'
              );
            } finally {
              setIsDeletingAccount(false);
            }
          }}
        />
      )}
    </div>
  );
};
