import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  CreditCard,
  Eye,
  ShieldCheck,
  Sliders,
  Sparkles,
  User,
  Wallet,
} from 'lucide-react';
import {
  Club,
  ClubPaymentDetails,
  Handedness,
  PermissionTier,
  Player,
} from '../types';
import {
  buildShareableClubAndSessionUrl,
  formatClubPaymentInfo,
  parseClubPaymentDetails,
} from '../utils/badmintonLogic';
import { SegmentedControl, StyledSelect } from './ui/FormControls';

export type SettingsSectionTab = 'profile' | 'club_policy' | 'payment' | 'invites';

interface SettingsViewProps {
  activePlayer: Player;
  preferredPaymentMethod: string;
  activeClub: Club;
  manageableClubs: Club[];
  permissionTier: PermissionTier;
  canManageActiveClub: boolean;
  initialSection?: SettingsSectionTab;
  onSelectClub: (clubId: string) => void;
  onUpdateOwnProfile: (updates: {
    name: string;
    handedness: Handedness;
    playStyle: string;
    preferredPaymentMethod?: string;
  }) => Promise<void>;
  onUpdateClubSettings: (
    clubId: string,
    updates: {
      name: string;
      description: string;
      paymentInfo: string;
      paymentDetails?: ClubPaymentDetails;
      freeCancelHours: number;
      lockCancelHours: number;
      lateCancelFeePercent: number;
      noShowFeePercent: number;
      excludeOwnerFromBilling?: boolean;
    }
  ) => Promise<void>;
  onTriggerClubJoinPromptPreview: (clubId: string) => void;
}

const PLAY_STYLE_PRESETS = [
  'All-Court Tactician',
  'Rear-Court Smash',
  'Front-Court Net',
  'Counter Defense',
  'Control & Drop',
  'Flat Drive',
  'Baseline Rally',
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  activePlayer,
  preferredPaymentMethod,
  activeClub,
  manageableClubs,
  permissionTier,
  canManageActiveClub,
  initialSection = 'profile',
  onSelectClub,
  onUpdateOwnProfile,
  onUpdateClubSettings,
  onTriggerClubJoinPromptPreview,
}) => {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionTab>(initialSection);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  // Personal Profile state
  const [profileName, setProfileName] = useState(activePlayer.name);
  const [handedness, setHandedness] = useState<Handedness>(
    activePlayer.handedness || 'right'
  );
  const [playStyle, setPlayStyle] = useState(
    activePlayer.playStyle || 'All-Court Tactician'
  );
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState(
    preferredPaymentMethod || 'PayNow'
  );
  const [profileSavedToast, setProfileSavedToast] = useState(false);

  useEffect(() => {
    setProfileName(activePlayer.name);
    setHandedness(activePlayer.handedness || 'right');
    setPlayStyle(activePlayer.playStyle || 'All-Court Tactician');
  }, [activePlayer]);

  useEffect(() => {
    if (preferredPaymentMethod) {
      setDefaultPaymentMethod(preferredPaymentMethod);
    }
  }, [preferredPaymentMethod]);

  // Club Policy & Billing state
  const initialPayDetails =
    activeClub.paymentDetails ||
    parseClubPaymentDetails(
      activeClub.paymentInfo,
      activeClub.clubOwnerName || 'Alex Tan'
    );

  const [clubName, setClubName] = useState(activeClub.name);
  const [clubDesc, setClubDesc] = useState(activeClub.description);
  const [freeCancelHours, setFreeCancelHours] = useState(
    activeClub.freeCancelHours
  );
  const [lockCancelHours, setLockCancelHours] = useState(
    activeClub.lockCancelHours
  );
  const [lateCancelPct, setLateCancelPct] = useState(
    activeClub.lateCancelFeePercent
  );
  const [noShowPct, setNoShowPct] = useState(activeClub.noShowFeePercent);
  const [excludeOwnerFromBilling, setExcludeOwnerFromBilling] = useState(
    Boolean(activeClub.excludeOwnerFromBilling)
  );
  const [policySavedToast, setPolicySavedToast] = useState(false);

  // Club Payment Details state
  const [recipientName, setRecipientName] = useState(
    initialPayDetails.recipientName
  );
  const [phoneNumber, setPhoneNumber] = useState(initialPayDetails.phoneNumber);
  const [bankName, setBankName] = useState(initialPayDetails.bankName);
  const [bankAccountNumber, setBankAccountNumber] = useState(
    initialPayDetails.bankAccountNumber
  );
  const [paymentNotes, setPaymentNotes] = useState(
    initialPayDetails.paymentNotes
  );
  const [paymentSavedToast, setPaymentSavedToast] = useState(false);

  // Invite copy state
  const [copiedInvite, setCopiedInvite] = useState(false);

  useEffect(() => {
    const details =
      activeClub.paymentDetails ||
      parseClubPaymentDetails(
        activeClub.paymentInfo,
        activeClub.clubOwnerName || 'Alex Tan'
      );
    setClubName(activeClub.name);
    setClubDesc(activeClub.description);
    setFreeCancelHours(activeClub.freeCancelHours);
    setLockCancelHours(activeClub.lockCancelHours);
    setLateCancelPct(activeClub.lateCancelFeePercent);
    setNoShowPct(activeClub.noShowFeePercent);
    setExcludeOwnerFromBilling(Boolean(activeClub.excludeOwnerFromBilling));
    setRecipientName(details.recipientName);
    setPhoneNumber(details.phoneNumber);
    setBankName(details.bankName);
    setBankAccountNumber(details.bankAccountNumber);
    setPaymentNotes(details.paymentNotes);
  }, [activeClub]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) return;
    await onUpdateOwnProfile({
      name: profileName.trim(),
      handedness,
      playStyle: playStyle.trim() || 'All-Court Tactician',
      preferredPaymentMethod: defaultPaymentMethod,
    });
    setProfileSavedToast(true);
    setTimeout(() => setProfileSavedToast(false), 2500);
  };

  const handleSaveClubPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageActiveClub) return;
    const details: ClubPaymentDetails = {
      recipientName:
        recipientName.trim() || activeClub.clubOwnerName || 'Club Owner',
      phoneNumber: phoneNumber.trim() || '+65 9123 4567',
      bankName: bankName.trim() || 'DBS Bank',
      bankAccountNumber: bankAccountNumber.trim() || '018-902341-2',
      paymentNotes:
        paymentNotes.trim() || 'Include your name & session date in reference',
    };
    await onUpdateClubSettings(activeClub.id, {
      name: clubName.trim() || activeClub.name,
      description: clubDesc.trim() || activeClub.description,
      paymentInfo: formatClubPaymentInfo(details),
      paymentDetails: details,
      freeCancelHours: Number(freeCancelHours) || 0,
      lockCancelHours: Number(lockCancelHours) || 0,
      lateCancelFeePercent: Number(lateCancelPct) || 0,
      noShowFeePercent: Number(noShowPct) || 0,
      excludeOwnerFromBilling,
    });
    setPolicySavedToast(true);
    setTimeout(() => setPolicySavedToast(false), 2500);
  };

  const handleSavePaymentDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageActiveClub) return;
    const details: ClubPaymentDetails = {
      recipientName:
        recipientName.trim() || activeClub.clubOwnerName || 'Club Owner',
      phoneNumber: phoneNumber.trim() || '+65 9123 4567',
      bankName: bankName.trim() || 'DBS Bank',
      bankAccountNumber: bankAccountNumber.trim() || '018-902341-2',
      paymentNotes:
        paymentNotes.trim() || 'Include your name & session date in reference',
    };
    await onUpdateClubSettings(activeClub.id, {
      name: clubName.trim() || activeClub.name,
      description: clubDesc.trim() || activeClub.description,
      paymentInfo: formatClubPaymentInfo(details),
      paymentDetails: details,
      freeCancelHours: Number(freeCancelHours) || 0,
      lockCancelHours: Number(lockCancelHours) || 0,
      lateCancelFeePercent: Number(lateCancelPct) || 0,
      noShowFeePercent: Number(noShowPct) || 0,
      excludeOwnerFromBilling,
    });
    setPaymentSavedToast(true);
    setTimeout(() => setPaymentSavedToast(false), 2500);
  };

  const shareableClubUrl = buildShareableClubAndSessionUrl(activeClub.id);

  const handleCopyInviteUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareableClubUrl);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Settings &amp; Preferences
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Centralized configuration for your player profile, club billing rules, payment recipient details, and member invites.
          </p>
        </div>

        {/* Target Club Selector when viewing Club settings */}
        {manageableClubs.length > 1 && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
              Active Club:
            </span>
            <div className="w-56">
              <StyledSelect
                aria-label="Select club to configure"
                value={activeClub.id}
                onChange={(e) => onSelectClub(e.target.value)}
                className="h-9 text-xs"
              >
                {manageableClubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </div>
        )}
      </div>

      {/* Layout: Sidebar Navigation on Desktop + Main Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        {/* Settings Navigation Menu */}
        <aside className="bg-white border border-slate-200/90 rounded-2xl p-2 shadow-xs flex lg:flex-col gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSection('profile')}
            className={`h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeSection === 'profile'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>Personal Profile</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('club_policy')}
            className={`h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeSection === 'club_policy'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-4 h-4 shrink-0" />
            <span>Club &amp; Billing Policy</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('payment')}
            className={`h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeSection === 'payment'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-4 h-4 shrink-0" />
            <span>Payment Recipient</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('invites')}
            className={`h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer ${
              activeSection === 'invites'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-4 h-4 shrink-0" />
            <span>Club Invite &amp; Onboarding</span>
          </button>
        </aside>

        {/* Active Settings Section Content */}
        <div className="space-y-6">
          {/* SECTION 1: PERSONAL PROFILE & PAYMENT PREFERENCES */}
          {activeSection === 'profile' && (
            <form
              onSubmit={handleSaveProfile}
              className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Personal Profile &amp; Court Preferences
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Update your display name, handedness, court play style, and default payment method.
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                  Tag: {activePlayer.playerTag}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Display Name
                  </label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Dominant Hand
                  </label>
                  <SegmentedControl
                    className="w-full"
                    size="md"
                    value={handedness}
                    onChange={setHandedness}
                    options={[
                      { value: 'right', label: 'Right-Handed' },
                      { value: 'left', label: 'Left-Handed' },
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Preferred Court Play Style
                  </label>
                  <StyledSelect
                    value={playStyle}
                    onChange={(e) => setPlayStyle(e.target.value)}
                    className="h-10 text-xs"
                  >
                    {PLAY_STYLE_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}
                      </option>
                    ))}
                  </StyledSelect>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Default Settlement Method
                  </label>
                  <SegmentedControl
                    className="w-full"
                    size="md"
                    value={defaultPaymentMethod}
                    onChange={setDefaultPaymentMethod}
                    options={[
                      { value: 'PayNow', label: 'PayNow' },
                      { value: 'Bank Transfer', label: 'Bank Transfer' },
                      { value: 'Cash', label: 'Cash' },
                    ]}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {profileSavedToast ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                      <Check className="w-4 h-4" />
                      Profile preferences saved!
                    </span>
                  ) : (
                    <span>Changes apply immediately across all joined clubs.</span>
                  )}
                </div>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Save Profile Settings
                </button>
              </div>
            </form>
          )}

          {/* SECTION 2: CLUB & BILLING POLICY (INCLUDING EXCLUDE OWNER FROM BILLING) */}
          {activeSection === 'club_policy' && (
            <form
              onSubmit={handleSaveClubPolicy}
              className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs space-y-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Club Rules &amp; Session Billing Policy
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configuring <span className="font-semibold text-slate-800">{activeClub.name}</span> · Owner: {activeClub.clubOwnerName || 'Alex Tan'}
                  </p>
                </div>
                {!canManageActiveClub && (
                  <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                    Read-Only (Club Owner / Admin required to edit)
                  </span>
                )}
              </div>

              {/* Club Identity */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Club Name
                  </label>
                  <input
                    type="text"
                    disabled={!canManageActiveClub}
                    value={clubName}
                    onChange={(e) => setClubName(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Schedule &amp; Venue Description
                  </label>
                  <input
                    type="text"
                    disabled={!canManageActiveClub}
                    value={clubDesc}
                    onChange={(e) => setClubDesc(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>

              {/* Owner Billing Rule Card */}
              <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-emerald-700 shrink-0" />
                      <h3 className="text-sm font-bold text-slate-900">
                        Exclude Club Owner from Session Fee Calculations
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      When enabled, the club owner (<span className="font-semibold text-slate-900">{activeClub.clubOwnerName || 'Club Owner'}</span>) is exempt from court and shuttle charges (<span className="font-mono font-semibold">$0.00</span>), and the total session cost is split among the remaining attending players.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Note: Even when disabled, the club owner&apos;s own share is automatically marked as <span className="font-semibold text-emerald-700">Received</span> upon finalizing a session so the owner never has to manually mark themselves received.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 cursor-pointer shrink-0 select-none">
                    <input
                      type="checkbox"
                      disabled={!canManageActiveClub}
                      checked={excludeOwnerFromBilling}
                      onChange={(e) =>
                        setExcludeOwnerFromBilling(e.target.checked)
                      }
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                    />
                    <span className="text-xs font-bold text-slate-900">
                      {excludeOwnerFromBilling ? 'Owner Excluded ($0)' : 'Owner Included'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Tap-Out & Penalty Rules */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Tap-Out Cutoffs &amp; Penalty Weights
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Free Cancel Window (hrs)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={168}
                      disabled={!canManageActiveClub}
                      value={freeCancelHours}
                      onChange={(e) =>
                        setFreeCancelHours(Number(e.target.value))
                      }
                      className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Lock Cutoff (hrs prior)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={72}
                      disabled={!canManageActiveClub}
                      value={lockCancelHours}
                      onChange={(e) =>
                        setLockCancelHours(Number(e.target.value))
                      }
                      className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Late Tap-Out Fee (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={!canManageActiveClub}
                      value={lateCancelPct}
                      onChange={(e) => setLateCancelPct(Number(e.target.value))}
                      className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      No-Show Fee (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={!canManageActiveClub}
                      value={noShowPct}
                      onChange={(e) => setNoShowPct(Number(e.target.value))}
                      className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-sm font-mono text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                    />
                  </div>
                </div>
              </div>

              {canManageActiveClub && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    {policySavedToast ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                        <Check className="w-4 h-4" />
                        Club billing &amp; policy settings updated!
                      </span>
                    ) : (
                      <span>
                        Updating owner billing rules immediately recalculates session fee shares.
                      </span>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Save Club Policy
                  </button>
                </div>
              )}
            </form>
          )}

          {/* SECTION 3: PAYMENT RECIPIENT & BANK DETAILS */}
          {activeSection === 'payment' && (
            <form
              onSubmit={handleSavePaymentDetails}
              className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Club Payment Recipient &amp; Bank Details
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Displayed to members of <span className="font-semibold text-slate-800">{activeClub.name}</span> when settling session fees.
                  </p>
                </div>
                {!canManageActiveClub && (
                  <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                    Read-Only
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Recipient Name (PayNow / Bank)
                  </label>
                  <input
                    type="text"
                    disabled={!canManageActiveClub}
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g., Alex Tan"
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    PayNow Phone Number
                  </label>
                  <input
                    type="text"
                    disabled={!canManageActiveClub}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+65 9123 4567"
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm font-mono text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    disabled={!canManageActiveClub}
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="DBS Bank / OCBC / UOB"
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Bank Account Number
                  </label>
                  <input
                    type="text"
                    disabled={!canManageActiveClub}
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    placeholder="018-902341-2"
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm font-mono text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Transfer Reference Instructions
                  </label>
                  <input
                    type="text"
                    disabled={!canManageActiveClub}
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Include your name & session date in transfer reference"
                    className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-sm text-slate-900 disabled:opacity-60 focus:outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>
              </div>

              {canManageActiveClub && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    {paymentSavedToast ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                        <Check className="w-4 h-4" />
                        Payment recipient details saved!
                      </span>
                    ) : (
                      <span>Shown in member payment modals and session ledgers.</span>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Save Payment Details
                  </button>
                </div>
              )}
            </form>
          )}

          {/* SECTION 4: CLUB INVITE LINK & ONBOARDING */}
          {activeSection === 'invites' && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-base font-bold text-slate-900">
                  Club Invite Link &amp; Member Onboarding
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Share this direct link with new players so they are automatically prompted to join <span className="font-semibold text-slate-800">{activeClub.name}</span> upon signing in.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Direct Club Invite URL
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareableClubUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 h-10 bg-slate-50 border border-slate-300 rounded-xl px-3.5 text-xs font-mono text-slate-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyInviteUrl}
                    className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {copiedInvite ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Invite Link Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Invite Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    Test Member Join Invitation Modal
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Preview the onboarding modal that appears when a player opens your club invite link.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onTriggerClubJoinPromptPreview(activeClub.id)}
                  className="h-9 px-3.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                  <span>Preview Join Modal</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
