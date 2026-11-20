import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Phone,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Club,
  ClubPaymentDetails,
  OutstandingDebtItem,
  Player,
} from '../types';
import {
  formatClubCurrency,
  getClubCurrencyCode,
  getRsvpWalletLedger,
  parseClubPaymentDetails,
} from '../utils/badmintonLogic';
import { buildPaymentReference } from '../utils/sessionFlowHelpers';
import { SegmentedControl } from './ui/FormControls';
import { backdropClose } from '../utils/backdropClose';

interface PaymentRequestBannerAndModalProps {
  activeClub: Club;
  clubs: Club[];
  activePlayer: Player | null;
  outstandingDebts: OutstandingDebtItem[];
  canManageClub: boolean;
  /** Resolves to false when the report was not saved. */
  onNotifyPaymentSentAll: (
    paymentMethod?: string,
    clubId?: string
  ) => Promise<boolean>;
  onNotifyPaymentSentSingle?: (
    rsvpId: string,
    paymentMethod?: string
  ) => Promise<boolean>;
  onAcceptOrClearAll: (
    paymentMethod?: string,
    clubId?: string
  ) => Promise<void>;
  onAcceptOrClearSingle: (
    rsvpId: string,
    paymentMethod?: string
  ) => Promise<void>;
  onRejectSingle: (rsvpId: string) => Promise<void>;
  autoPromptOpen: boolean;
  onCloseAutoPrompt: () => void;
  onOpenPrompt: () => void;
  onGoToLedger?: () => void;
}

interface ClubDebtGroup {
  club: Club;
  paymentDetails: ClubPaymentDetails;
  debts: OutstandingDebtItem[];
  unpaidDebts: OutstandingDebtItem[];
  pendingDebts: OutstandingDebtItem[];
  unpaidAmount: number;
  pendingAmount: number;
  totalAmount: number;
  isUnavailable?: boolean;
}

export const PaymentRequestBannerAndModal: React.FC<
  PaymentRequestBannerAndModalProps
> = ({
  activeClub,
  clubs,
  activePlayer,
  outstandingDebts,
  canManageClub,
  onNotifyPaymentSentAll,
  onNotifyPaymentSentSingle,
  onAcceptOrClearAll,
  onAcceptOrClearSingle,
  onRejectSingle,
  autoPromptOpen,
  onCloseAutoPrompt,
  onOpenPrompt,
  onGoToLedger,
}) => {
  const [modalTab, setModalTab] = useState<'info' | 'bills'>('info');
  const [selectedClubId, setSelectedClubId] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submittingRsvpId, setSubmittingRsvpId] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(
    null
  );
  const [partialClubPaidNotice, setPartialClubPaidNotice] = useState<
    string | null
  >(null);

  // Group outstanding debts by club so a player owing money at multiple clubs
  // sees each club's exact amount, recipient, phone/bank account, and settles each club separately.
  const clubDebtGroups = useMemo<ClubDebtGroup[]>(() => {
    const map = new Map<string, OutstandingDebtItem[]>();
    for (let i = 0; i < outstandingDebts.length; i++) {
      const item = outstandingDebts[i];
      const cId = item.session.clubId || item.rsvp.clubId;
      const existing = map.get(cId);
      if (existing) {
        existing.push(item);
      } else {
        map.set(cId, [item]);
      }
    }

    const groups: ClubDebtGroup[] = [];
    map.forEach((items, clubId) => {
      const matchedClub =
        clubs.find((c) => c.id === clubId) ||
        (activeClub.id === clubId ? activeClub : undefined);
      const isUnavailable = !matchedClub;
      const club: Club = matchedClub || {
        id: clubId,
        name: 'Club details unavailable',
        description: '',
        paymentInfo: items[0]?.session.paymentInfo || '',
        freeCancelHours: 0,
        lockCancelHours: 0,
        lateCancelFeePercent: 0,
        noShowFeePercent: 0,
        ownerId: '',
      };
      const paymentDetails = matchedClub
        ? matchedClub.paymentDetails ||
          parseClubPaymentDetails(
            matchedClub.paymentInfo,
            matchedClub.clubOwnerName || 'Club Owner'
          )
        : {
            recipientName: 'Unavailable',
            phoneNumber: '',
            bankName: '',
            bankAccountNumber: '',
            paymentNotes: '',
          };
      const unpaidDebts = items.filter((d) => d.rsvp.paidStatus === 'unpaid');
      const pendingDebts = items.filter(
        (d) => d.rsvp.paidStatus === 'pending_approval'
      );
      const unpaidAmount = Number(
        unpaidDebts
          .reduce((sum, item) => sum + item.rsvp.feeShare, 0)
          .toFixed(2)
      );
      const pendingAmount = Number(
        pendingDebts
          .reduce((sum, item) => sum + item.rsvp.feeShare, 0)
          .toFixed(2)
      );
      const totalAmount = Number((unpaidAmount + pendingAmount).toFixed(2));
      groups.push({
        club,
        paymentDetails,
        debts: items,
        unpaidDebts,
        pendingDebts,
        unpaidAmount,
        pendingAmount,
        totalAmount,
        isUnavailable,
      });
    });

    // Sort clubs with unpaid balances first, then by largest unpaid amount
    return groups.sort((a, b) => {
      if (a.unpaidAmount > 0 && b.unpaidAmount === 0) return -1;
      if (a.unpaidAmount === 0 && b.unpaidAmount > 0) return 1;
      return b.unpaidAmount - a.unpaidAmount;
    });
  }, [outstandingDebts, clubs, activeClub]);

  const selectedGroup: ClubDebtGroup | null = useMemo(() => {
    if (clubDebtGroups.length === 0) return null;
    return (
      clubDebtGroups.find((g) => g.club.id === selectedClubId) ||
      clubDebtGroups[0]
    );
  }, [clubDebtGroups, selectedClubId]);

  useEffect(() => {
    if (autoPromptOpen) {
      setModalTab('info');
      setPartialClubPaidNotice(null);
      if (
        clubDebtGroups.length > 0 &&
        !clubDebtGroups.some((g) => g.club.id === selectedClubId)
      ) {
        setSelectedClubId(clubDebtGroups[0].club.id);
      }
    }
  }, [autoPromptOpen, clubDebtGroups, selectedClubId]);

  // Only show the payment methods the club has actually stored.
  const hasPhoneDetails = Boolean(
    selectedGroup?.paymentDetails.phoneNumber?.trim()
  );
  const hasBankDetails = Boolean(
    selectedGroup?.paymentDetails.bankName?.trim() ||
      selectedGroup?.paymentDetails.bankAccountNumber?.trim()
  );
  const transferHint =
    hasPhoneDetails && hasBankDetails
      ? 'Transfer via Phone Number or Bank Account, then notify the Club Owner.'
      : hasPhoneDetails
      ? 'Transfer via PayNow / mobile number, then notify the Club Owner.'
      : hasBankDetails
      ? "Transfer to the club's bank account, then notify the Club Owner."
      : 'Pay as the Club Owner instructs, then notify them.';

  const totalOwed = outstandingDebts.reduce(
    (sum, item) => sum + item.rsvp.feeShare,
    0
  );
  const unpaidAmount = outstandingDebts
    .filter((d) => d.rsvp.paidStatus === 'unpaid')
    .reduce((sum, item) => sum + item.rsvp.feeShare, 0);
  const pendingAmount = outstandingDebts
    .filter((d) => d.rsvp.paidStatus === 'pending_approval')
    .reduce((sum, item) => sum + item.rsvp.feeShare, 0);

  // Debts at clubs with different currencies cannot be added into one meaningful figure, so the
  // combined amounts only carry a symbol when every club owed to uses the same currency.
  const sharedCurrencyCode = (() => {
    const codes = new Set(clubDebtGroups.map((g) => getClubCurrencyCode(g.club)));
    return codes.size === 1 ? Array.from(codes)[0] : null;
  })();
  const combinedMoney = (amount: number) =>
    sharedCurrencyCode
      ? formatClubCurrency(amount, sharedCurrencyCode)
      : amount.toFixed(2);

  const allPendingVerification =
    outstandingDebts.length > 0 &&
    outstandingDebts.every((d) => d.rsvp.paidStatus === 'pending_approval');

  const handleCopyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      // ignore
    }
  };

  const handleSingleBillAction = async (
    rsvpId: string,
    action: () => Promise<unknown>
  ) => {
    if (isSubmitting || submittingRsvpId) return;
    setSubmittingRsvpId(rsvpId);
    try {
      await action();
    } finally {
      setSubmittingRsvpId(null);
    }
  };

  const handlePrimaryActionForSelectedClub = async () => {
    if (
      !selectedGroup ||
      selectedGroup.debts.length === 0 ||
      selectedGroup.isUnavailable
    )
      return;
    setIsSubmitting(true);
    try {
      const targetClubId = selectedGroup.club.id;
      const targetClubName = selectedGroup.club.name;
      const targetRecipient = selectedGroup.paymentDetails.recipientName;
      const amountToSettle =
        selectedGroup.unpaidAmount > 0
          ? selectedGroup.unpaidAmount
          : selectedGroup.totalAmount;

      if (canManageClub) {
        await onAcceptOrClearAll('Received', targetClubId);
        setConfirmationMessage(
          `Confirmed payment received (${formatClubCurrency(amountToSettle, selectedGroup.club)}) for ${targetClubName}.`
        );
      } else {
        if (!(await onNotifyPaymentSentAll('Submitted', targetClubId))) return;
        const otherUnpaidGroups = clubDebtGroups.filter(
          (g) => g.club.id !== targetClubId && g.unpaidAmount > 0
        );
        if (otherUnpaidGroups.length > 0) {
          setPartialClubPaidNotice(
            `Submitted ${formatClubCurrency(amountToSettle, selectedGroup.club)} for ${targetClubName} (${targetRecipient}). Switched to ${otherUnpaidGroups[0].club.name} (${formatClubCurrency(otherUnpaidGroups[0].unpaidAmount, otherUnpaidGroups[0].club)} due).`
          );
          setSelectedClubId(otherUnpaidGroups[0].club.id);
          return;
        }
        setConfirmationMessage(
          `Submitted ${formatClubCurrency(amountToSettle, selectedGroup.club)} to ${targetRecipient} (${targetClubName}). The Club Owner will verify and mark as received.`
        );
      }
      setTimeout(() => {
        setConfirmationMessage(null);
        setPartialClubPaidNotice(null);
        onCloseAutoPrompt();
      }, 1500);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!activePlayer) return null;

  return (
    <>
      {/* Persistent Unpaid / Pending Balance Banner across the app */}
      <AnimatePresence>
        {outstandingDebts.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            aria-label="Outstanding Session Balance"
            className={`${
              allPendingVerification
                ? 'bg-blue-50/90 dark:bg-blue-950/60 border-b border-blue-200/80 dark:border-blue-900/80'
                : 'bg-amber-50/95 dark:bg-amber-950/60 border-b border-amber-200/80 dark:border-amber-900/80'
            } px-3 sm:px-8 py-2.5`}
          >
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-800 dark:text-slate-200 min-w-0">
                <span
                  className={`font-mono tabular-nums font-bold ${
                    allPendingVerification
                      ? 'text-blue-950 dark:text-blue-200'
                      : 'text-amber-950 dark:text-amber-200'
                  }`}
                >
                  {allPendingVerification
                    ? `Pending Verification: ${combinedMoney(pendingAmount)}`
                    : `Unpaid: ${combinedMoney(unpaidAmount)}`}
                </span>
                {pendingAmount > 0 && unpaidAmount > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                      ·
                    </span>
                    <span className="font-mono tabular-nums text-blue-800 dark:text-blue-300 font-medium">
                      +{combinedMoney(pendingAmount)} pending
                    </span>
                  </>
                )}
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600 hidden sm:inline">
                  ·
                </span>
                {clubDebtGroups.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {clubDebtGroups.map((group) => (
                      <button
                        key={group.club.id}
                        type="button"
                        onClick={() => {
                          setSelectedClubId(group.club.id);
                          onOpenPrompt();
                        }}
                        className={`px-2 py-0.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                          group.unpaidAmount > 0
                            ? 'bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700 text-amber-950 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-950/80'
                            : 'bg-white dark:bg-slate-900 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 hover:bg-blue-100/70 dark:hover:bg-blue-950/80'
                        }`}
                      >
                        <span>{group.club.name}</span>
                        <span className="font-mono tabular-nums font-bold">
                          {group.unpaidAmount > 0
                            ? formatClubCurrency(group.unpaidAmount, group.club)
                            : `${formatClubCurrency(group.pendingAmount, group.club)} pend`}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-600 dark:text-slate-300 truncate">
                    {outstandingDebts.length}{' '}
                    {outstandingDebts.length === 1 ? 'bill' : 'bills'} ·{' '}
                    <strong className="font-semibold text-slate-900 dark:text-white">
                      {clubDebtGroups[0]?.isUnavailable
                        ? 'Club unavailable'
                        : clubDebtGroups[0]?.club.name || activeClub.name}
                    </strong>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <button
                  type="button"
                  onClick={onOpenPrompt}
                  className="w-full sm:w-auto h-9 sm:h-8 px-3.5 text-xs font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                >
                  <CreditCard className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {canManageClub
                      ? `Verify ${combinedMoney(totalOwed)}`
                      : allPendingVerification
                      ? 'Payment Info'
                      : clubDebtGroups.length > 1
                      ? `Settle (${clubDebtGroups.length} Clubs)`
                      : `Pay ${combinedMoney(unpaidAmount)}`}
                  </span>
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Payment Info & Settlement Modal */}
      <AnimatePresence>
        {autoPromptOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 bg-slate-950/55 dark:bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-modal-title"
            {...backdropClose(onCloseAutoPrompt)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16, transition: { duration: 0.12, ease: 'easeIn' } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-slate-900 w-full sm:max-w-xl max-h-[90dvh] rounded-t-3xl sm:rounded-2xl border-t sm:border border-slate-200/90 dark:border-slate-800 shadow-2xl shadow-slate-950/20 dark:shadow-black/60 flex flex-col overflow-hidden"
            >
              {/* Mobile Drag Handle */}
              <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0" aria-hidden="true">
                <span className="w-9 h-1 rounded-full bg-slate-300/90 dark:bg-slate-700" />
              </div>

              {/* Modal Header */}
              <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800/90 flex items-start justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <h2
                    id="payment-modal-title"
                    className="text-base sm:text-lg font-bold text-slate-950 dark:text-white font-display"
                  >
                    Payment &amp; Settlement
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {clubDebtGroups.length > 1
                      ? `Balances across ${clubDebtGroups.length} clubs — settle each separately.`
                      : selectedGroup?.isUnavailable
                      ? 'Club payment details are unavailable.'
                      : transferHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCloseAutoPrompt}
                  className="h-9 w-9 sm:h-8 sm:w-8 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl shrink-0 cursor-pointer"
                  aria-label="Close dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {confirmationMessage !== null ? (
                <div className="p-8 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {canManageClub
                      ? 'Payment Confirmed Received'
                      : 'Payment Notice Sent'}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">{confirmationMessage}</p>
                </div>
              ) : outstandingDebts.length === 0 || !selectedGroup ? (
                <div className="p-4 sm:p-6 text-center space-y-4 overflow-y-auto flex-1">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {combinedMoney(0)} Owed · All Bills Settled
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {activePlayer.name} ({activePlayer.playerTag}) has no unpaid session fees across any club.
                    </p>
                  </div>
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-center gap-2 pt-2 pb-[env(safe-area-inset-bottom)]">
                    <button
                      type="button"
                      onClick={onCloseAutoPrompt}
                      className="w-full sm:w-auto h-10 sm:h-9 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl border border-slate-300 dark:border-slate-700 inline-flex items-center justify-center cursor-pointer"
                    >
                      Close
                    </button>
                    {onGoToLedger && (
                      <button
                        type="button"
                        onClick={() => {
                          onCloseAutoPrompt();
                          onGoToLedger();
                        }}
                        className="w-full sm:w-auto h-10 sm:h-9 px-4 text-xs font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 rounded-xl inline-flex items-center justify-center cursor-pointer"
                      >
                        View Full Ledger
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-4">
                  {partialClubPaidNotice && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-950 dark:text-emerald-200 font-medium flex items-center justify-between gap-2">
                      <span>{partialClubPaidNotice}</span>
                      <button
                        type="button"
                        onClick={() => setPartialClubPaidNotice(null)}
                        className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-white shrink-0 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Multi-Club Switcher when user owes money / has pending bills at more than one club */}
                  {clubDebtGroups.length > 1 && (
                    <div className="space-y-2 pb-3 border-b border-slate-200/80 dark:border-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          Select Club to Settle ({clubDebtGroups.length} Clubs)
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          Combined Total: {combinedMoney(totalOwed)}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {clubDebtGroups.map((group) => {
                          const isSelected =
                            group.club.id === selectedGroup.club.id;
                          return (
                            <button
                              key={group.club.id}
                              type="button"
                              onClick={() => setSelectedClubId(group.club.id)}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                isSelected
                                  ? 'bg-slate-900 dark:bg-emerald-950/80 text-white border-slate-900 dark:border-emerald-500 shadow-xs'
                                  : 'bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold truncate">
                                  {group.isUnavailable
                                    ? 'Club details unavailable'
                                    : group.club.name}
                                </p>
                                <p
                                  className={`text-[11px] truncate ${
                                    isSelected
                                      ? 'text-slate-300 dark:text-emerald-200/80'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {group.isUnavailable
                                    ? 'Payment details unavailable'
                                    : `Pay to ${group.paymentDetails.recipientName}`}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <span
                                  className={`font-mono tabular-nums text-xs font-bold block ${
                                    isSelected
                                      ? 'text-amber-300'
                                      : group.unpaidAmount > 0
                                      ? 'text-amber-800 dark:text-amber-300'
                                      : 'text-blue-700 dark:text-blue-300'
                                  }`}
                                >
                                  {group.unpaidAmount > 0
                                    ? `${formatClubCurrency(group.unpaidAmount, group.club)} due`
                                    : `${formatClubCurrency(group.pendingAmount, group.club)} pend`}
                                </span>
                                <span
                                  className={`text-[10px] ${
                                    isSelected
                                      ? 'text-slate-300 dark:text-emerald-200/80'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {group.debts.length}{' '}
                                  {group.debts.length === 1
                                    ? 'session'
                                    : 'sessions'}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Summary Strip for Selected Club + Tab Switcher */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800">
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 block">
                        {selectedGroup.isUnavailable
                          ? 'Club details unavailable'
                          : `Amount Due to ${selectedGroup.club.name} (${selectedGroup.paymentDetails.recipientName})`}
                      </span>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono tabular-nums text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                          {formatClubCurrency(
                            selectedGroup.unpaidAmount > 0
                              ? selectedGroup.unpaidAmount
                              : selectedGroup.totalAmount,
                            selectedGroup.club
                          )}
                        </span>
                        {selectedGroup.pendingAmount > 0 &&
                          selectedGroup.unpaidAmount > 0 && (
                            <span className="text-xs font-mono text-blue-700 dark:text-blue-300 font-semibold">
                              (+{formatClubCurrency(selectedGroup.pendingAmount, selectedGroup.club)}{' '}
                              pending)
                            </span>
                          )}
                      </div>
                    </div>

                    <SegmentedControl
                      size="sm"
                      fullWidth
                      className="sm:w-auto"
                      options={[
                        { value: 'info', label: 'Payment Info' },
                        {
                          value: 'bills',
                          label: 'Session Bills',
                          count: selectedGroup.debts.length,
                        },
                      ]}
                      value={modalTab}
                      onChange={setModalTab}
                    />
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                  {/* TAB 1: PAYMENT METHOD INFO FOR SELECTED CLUB */}
                  {modalTab === 'info' &&
                    (selectedGroup.isUnavailable ? (
                      <motion.div
                        key="pay-tab-unavailable"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                        className="p-6 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center space-y-2"
                      >
                        <Building2 className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          Club details unavailable
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
                          Payment details for this club could not be loaded. Please contact the club organizer directly to settle this session bill.
                        </p>
                      </motion.div>
                    ) : (
                    <motion.div
                      key="pay-tab-info"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                      className="space-y-3.5"
                    >
                      {/* Quick Copy Amount & Transfer Reference Strip */}
                      {(() => {
                        const transferAmt =
                          selectedGroup.unpaidAmount > 0
                            ? selectedGroup.unpaidAmount
                            : selectedGroup.totalAmount;
                        const transferRef = buildPaymentReference(
                          activePlayer.name,
                          selectedGroup.debts.length === 1
                            ? selectedGroup.debts[0].session.sessionDate
                            : selectedGroup.club.name
                        );
                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyValue(
                                  `amt_${selectedGroup.club.id}`,
                                  transferAmt.toFixed(2)
                                )
                              }
                              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 hover:border-emerald-400 dark:hover:border-emerald-600 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer shadow-2xs"
                            >
                              <div className="min-w-0">
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block">
                                  Exact Amount
                                </span>
                                <span className="font-mono tabular-nums font-bold text-sm text-slate-950 dark:text-white">
                                  {formatClubCurrency(transferAmt, selectedGroup.club)}
                                </span>
                              </div>
                              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 shrink-0">
                                {copiedField === `amt_${selectedGroup.club.id}` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleCopyValue(
                                  `ref_${selectedGroup.club.id}`,
                                  transferRef
                                )
                              }
                              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 hover:border-emerald-400 dark:hover:border-emerald-600 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer shadow-2xs"
                            >
                              <div className="min-w-0">
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block">
                                  Suggested Reference
                                </span>
                                <span className="font-mono font-bold text-xs text-slate-900 dark:text-white truncate block">
                                  {transferRef}
                                </span>
                              </div>
                              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 shrink-0">
                                {copiedField === `ref_${selectedGroup.club.id}` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </span>
                            </button>
                          </div>
                        );
                      })()}

                      <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/75 space-y-3 text-xs">
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-700/80">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                            <span>{selectedGroup.paymentDetails.recipientName}</span>
                          </span>
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                            {selectedGroup.club.name}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Phone Number Field (PayNow / Mobile Transfer) */}
                          {hasPhoneDetails && (
                          <div className="flex flex-col justify-between gap-2 bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-700/80 shadow-2xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                <Phone className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                                <span>PayNow / Mobile</span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyValue(
                                    `phone_${selectedGroup.club.id}`,
                                    selectedGroup.paymentDetails.phoneNumber
                                  )
                                }
                                className="h-8 sm:h-7 px-2.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                              >
                                {copiedField ===
                                `phone_${selectedGroup.club.id}` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="font-mono tabular-nums font-bold text-base sm:text-lg text-slate-950 dark:text-white break-all">
                              {selectedGroup.paymentDetails.phoneNumber}
                            </p>
                          </div>
                          )}

                          {/* Bank Account Field (hidden when the club stored no bank details) */}
                          {hasBankDetails && (
                          <div className="flex flex-col justify-between gap-2 bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-700/80 shadow-2xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                                <span>
                                  {selectedGroup.paymentDetails.bankName}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyValue(
                                    `bank_${selectedGroup.club.id}`,
                                    selectedGroup.paymentDetails
                                      .bankAccountNumber
                                  )
                                }
                                className="h-8 sm:h-7 px-2.5 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                              >
                                {copiedField ===
                                `bank_${selectedGroup.club.id}` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="font-mono tabular-nums font-bold text-base sm:text-lg text-slate-950 dark:text-white break-all">
                              {selectedGroup.paymentDetails.bankAccountNumber}
                            </p>
                          </div>
                          )}
                        </div>

                        {/* Transfer Note */}
                        {selectedGroup.paymentDetails.paymentNotes && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">Note:</span>{' '}
                            {selectedGroup.paymentDetails.paymentNotes}
                          </p>
                        )}
                      </div>

                      {/* Compact Inline Bill Breakdown so users see what they are paying without switching tabs */}
                      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">
                            Included Sessions ({selectedGroup.debts.length})
                          </span>
                          {selectedGroup.debts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setModalTab('bills')}
                              className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                            >
                              Pay individually →
                            </button>
                          )}
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {selectedGroup.debts.slice(0, 3).map(({ rsvp, session }) => (
                            <div
                              key={rsvp.id}
                              className="py-1.5 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <span className="font-semibold text-slate-900 dark:text-white truncate block">
                                  {session.title}
                                </span>
                                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                  {session.sessionDate}
                                  {rsvp.paidStatus === 'pending_approval'
                                    ? ' · Pending verification'
                                    : ''}
                                </span>
                              </div>
                              <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white shrink-0">
                                {formatClubCurrency(rsvp.feeShare, selectedGroup.club)}
                              </span>
                            </div>
                          ))}
                          {selectedGroup.debts.length > 3 && (
                            <button
                              type="button"
                              onClick={() => setModalTab('bills')}
                              className="pt-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                              + {selectedGroup.debts.length - 3} more sessions in Session Bills
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {/* TAB 2: SESSION BILLS FOR SELECTED CLUB */}
                  {modalTab === 'bills' && (
                    <motion.div
                      key="pay-tab-bills"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                      className="divide-y divide-slate-200/80 dark:divide-slate-800 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-950/35 overflow-hidden"
                    >
                      <AnimatePresence initial={false}>
                        {selectedGroup.debts.map(({ rsvp, session }) => {
                          const ledger = getRsvpWalletLedger(rsvp);
                          const isPending =
                            rsvp.paidStatus === 'pending_approval';
                          const isRejected =
                            !isPending && rsvp.paidMethod === 'Rejected';
                          const isBusy =
                            isSubmitting || submittingRsvpId !== null;
                          const isThisRowSubmitting =
                            submittingRsvpId === rsvp.id;
                          const hasRowAction =
                            canManageClub ||
                            (rsvp.paidStatus === 'unpaid' &&
                              Boolean(onNotifyPaymentSentSingle));

                          return (
                            <motion.div
                              key={rsvp.id}
                              layout
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                              className="px-4 py-3.5 hover:bg-slate-50/75 dark:hover:bg-slate-800/30 transition-colors space-y-2.5"
                            >
                              {/* Top Row: Session Title & Meta (Left) + Payable Amount (Right) */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-0.5">
                                  <p className="text-[13px] sm:text-sm font-bold text-slate-950 dark:text-white leading-snug break-words">
                                    {session.title}
                                  </p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-relaxed">
                                    <span className="font-mono tabular-nums text-[11px] sm:text-xs text-slate-600 dark:text-slate-300">
                                      {session.sessionDate}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className="text-slate-300 dark:text-slate-600"
                                    >
                                      ·
                                    </span>
                                    <span className="break-words">
                                      {session.venue}
                                    </span>
                                  </p>
                                  {ledger.walletCreditApplied > 0 && (
                                    <p className="text-[11px] text-sky-700 dark:text-sky-400 font-medium font-mono tabular-nums pt-0.5">
                                      Share{' '}
                                      {formatClubCurrency(
                                        ledger.grossFeeShare,
                                        selectedGroup.club
                                      )}{' '}
                                      − club credit{' '}
                                      {formatClubCurrency(
                                        ledger.walletCreditApplied,
                                        selectedGroup.club
                                      )}
                                    </p>
                                  )}
                                </div>

                                <div className="shrink-0 text-right pl-1">
                                  <span className="font-bold font-mono tabular-nums text-base text-slate-950 dark:text-white leading-tight block">
                                    {formatClubCurrency(
                                      rsvp.feeShare,
                                      selectedGroup.club
                                    )}
                                  </span>
                                </div>
                              </div>

                              {/* Bottom Row: Status (Left) + Right-Aligned Action Button(s) */}
                              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                                <div className="min-w-0">
                                  {isPending ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400">
                                      <Clock className="w-3.5 h-3.5 shrink-0" />
                                      <span>Pending verification</span>
                                    </span>
                                  ) : isRejected ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
                                      <X className="w-3.5 h-3.5 shrink-0" />
                                      <span>Not received — verify transfer</span>
                                    </span>
                                  ) : (
                                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                                      Unpaid
                                    </span>
                                  )}
                                </div>

                                {hasRowAction && (
                                  <div className="flex items-center justify-end gap-2 shrink-0 ml-auto">
                                    {canManageClub ? (
                                      <>
                                        {isPending && (
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() =>
                                              handleSingleBillAction(rsvp.id, () =>
                                                onRejectSingle(rsvp.id)
                                              )
                                            }
                                            className="h-9 sm:h-8 px-3 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-white dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all duration-150 active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                                          >
                                            <X className="w-3.5 h-3.5 shrink-0" />
                                            <span>Not Received</span>
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          disabled={isBusy}
                                          onClick={() =>
                                            handleSingleBillAction(rsvp.id, () =>
                                              onAcceptOrClearSingle(
                                                rsvp.id,
                                                'Received'
                                              )
                                            )
                                          }
                                          className="h-9 sm:h-8 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50/90 dark:bg-emerald-500/12 hover:bg-emerald-600 dark:hover:bg-emerald-600 hover:text-white dark:hover:text-white border border-emerald-200/90 dark:border-emerald-500/35 hover:border-emerald-600 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all duration-150 active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                                        >
                                          <Check className="w-3.5 h-3.5 shrink-0" />
                                          <span>Confirm Received</span>
                                        </button>
                                      </>
                                    ) : (
                                      rsvp.paidStatus === 'unpaid' &&
                                      onNotifyPaymentSentSingle && (
                                        <button
                                          type="button"
                                          disabled={
                                            isBusy || selectedGroup.isUnavailable
                                          }
                                          onClick={() =>
                                            handleSingleBillAction(rsvp.id, () =>
                                              onNotifyPaymentSentSingle(
                                                rsvp.id,
                                                'Submitted'
                                              )
                                            )
                                          }
                                          className="h-9 sm:h-8 px-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 hover:bg-emerald-600 hover:text-white dark:bg-emerald-500/15 dark:hover:bg-emerald-600 dark:hover:text-white border border-emerald-300/90 dark:border-emerald-500/45 hover:border-emerald-600 rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all duration-150 active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                                        >
                                          <Check className="w-3.5 h-3.5 shrink-0" />
                                          <span>
                                            {isThisRowSubmitting
                                              ? 'Submitting…'
                                              : 'Paid This'}
                                          </span>
                                        </button>
                                      )
                                    )}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </motion.div>
                  )}
                  </AnimatePresence>
                </div>

                {/* Sticky Modal Footer Actions (Scoped to Selected Club) */}
                <div className="px-4 sm:px-6 py-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-slate-100 dark:border-slate-800/90 bg-slate-50/75 dark:bg-slate-950/60 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {selectedGroup.isUnavailable
                      ? 'Contact the club organizer directly to settle.'
                      : canManageClub
                      ? `Confirm receipt for ${selectedGroup.club.name}.`
                      : `${selectedGroup.paymentDetails.recipientName} will confirm receipt.`}
                  </span>
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 w-full sm:w-auto shrink-0">
                    <button
                      type="button"
                      onClick={onCloseAutoPrompt}
                      className="w-full sm:w-auto h-11 sm:h-9 px-3.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white bg-white dark:bg-slate-800 sm:bg-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 sm:border-transparent rounded-xl inline-flex items-center justify-center transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      disabled={
                        isSubmitting ||
                        selectedGroup.isUnavailable ||
                        (!canManageClub && selectedGroup.unpaidAmount === 0)
                      }
                      onClick={handlePrimaryActionForSelectedClub}
                      className="w-full sm:w-auto min-h-[44px] sm:min-h-0 sm:h-9 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 text-center leading-snug cursor-pointer shadow-xs"
                    >
                      {selectedGroup.isUnavailable ? (
                        <span>Club Details Unavailable</span>
                      ) : canManageClub ? (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Confirm Received (
                            {formatClubCurrency(
                              selectedGroup.totalAmount,
                              selectedGroup.club
                            )}
                            )
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {isSubmitting
                              ? 'Submitting…'
                              : selectedGroup.unpaidAmount === 0
                              ? `Awaiting ${selectedGroup.paymentDetails.recipientName}'s Approval`
                              : `I Have Paid ${formatClubCurrency(selectedGroup.unpaidAmount, selectedGroup.club)} to ${selectedGroup.paymentDetails.recipientName}`}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

