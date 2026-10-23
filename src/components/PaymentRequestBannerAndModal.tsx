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
import { SegmentedControl } from './ui/FormControls';
import { backdropClose } from '../utils/backdropClose';

interface PaymentRequestBannerAndModalProps {
  activeClub: Club;
  clubs: Club[];
  activePlayer: Player | null;
  outstandingDebts: OutstandingDebtItem[];
  canManageClub: boolean;
  onNotifyPaymentSentAll: (
    paymentMethod?: string,
    clubId?: string
  ) => Promise<void>;
  onNotifyPaymentSentSingle?: (
    rsvpId: string,
    paymentMethod?: string
  ) => Promise<void>;
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
        await onNotifyPaymentSentAll('Submitted', targetClubId);
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
                ? 'bg-blue-50/90 border-b border-blue-200/80'
                : 'bg-amber-50/95 border-b border-amber-200/80'
            } px-4 sm:px-8 py-2.5`}
          >
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-800">
                <span
                  className={`font-mono tabular-nums font-bold ${
                    allPendingVerification ? 'text-blue-950' : 'text-amber-950'
                  }`}
                >
                  {allPendingVerification
                    ? `Pending Club Owner Verification: ${combinedMoney(pendingAmount)}`
                    : `Unpaid Balance: ${combinedMoney(unpaidAmount)}`}
                </span>
                {pendingAmount > 0 && unpaidAmount > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-mono tabular-nums text-blue-800 font-medium">
                      +{combinedMoney(pendingAmount)} awaiting verification
                    </span>
                  </>
                )}
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                {clubDebtGroups.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-slate-700 font-medium">
                      Across {clubDebtGroups.length} clubs:
                    </span>
                    {clubDebtGroups.map((group) => (
                      <button
                        key={group.club.id}
                        type="button"
                        onClick={() => {
                          setSelectedClubId(group.club.id);
                          onOpenPrompt();
                        }}
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                          group.unpaidAmount > 0
                            ? 'bg-white border-amber-300 text-amber-950 hover:bg-amber-100/70'
                            : 'bg-white border-blue-200 text-blue-900 hover:bg-blue-100/70'
                        }`}
                      >
                        <span>{group.club.name}:</span>
                        <span className="font-mono tabular-nums font-bold">
                          {group.unpaidAmount > 0
                            ? `${formatClubCurrency(group.unpaidAmount, group.club)} due`
                            : `${formatClubCurrency(group.pendingAmount, group.club)} pending`}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-700">
                    {outstandingDebts.length}{' '}
                    {outstandingDebts.length === 1
                      ? 'session bill'
                      : 'session bills'}{' '}
                    in{' '}
                    <strong className="font-semibold text-slate-900">
                      {clubDebtGroups[0]?.isUnavailable
                        ? 'Club details unavailable'
                        : clubDebtGroups[0]?.club.name || activeClub.name}
                    </strong>{' '}
                    {clubDebtGroups[0]?.isUnavailable ? null : (
                      <>
                        (Pay to{' '}
                        <strong className="font-semibold text-slate-900">
                          {clubDebtGroups[0]?.paymentDetails.recipientName ||
                            'Club Owner'}
                        </strong>
                        )
                      </>
                    )}
                  </span>
                )}
                {allPendingVerification && (
                  <>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 text-blue-800 font-medium">
                      <Clock className="w-3 h-3" />
                      Club Owner will confirm once payment is received
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenPrompt}
                  className="h-8 px-3.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                >
                  <CreditCard className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {canManageClub
                      ? `Verify ${combinedMoney(totalOwed)}`
                      : allPendingVerification
                      ? 'Payment Info'
                      : clubDebtGroups.length > 1
                      ? `Settle Balances (${clubDebtGroups.length} Clubs)`
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
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-modal-title"
            {...backdropClose(onCloseAutoPrompt)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full sm:max-w-xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-x-hidden"
            >
              {/* Modal Header */}
              <div className="px-5 sm:px-6 py-4 border-b border-slate-200/80 flex items-center justify-between gap-3">
                <div>
                  <h2
                    id="payment-modal-title"
                    className="text-base sm:text-lg font-bold text-slate-950 font-display"
                  >
                    Make Payment &amp; Settlement Status
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                    {clubDebtGroups.length > 1
                      ? `You have balances across ${clubDebtGroups.length} clubs. Transfer to each Club Owner's account separately.`
                      : selectedGroup?.isUnavailable
                      ? 'Club payment details are unavailable for this bill.'
                      : transferHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCloseAutoPrompt}
                  className="h-8 w-8 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl shrink-0 cursor-pointer"
                  aria-label="Close dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {confirmationMessage !== null ? (
                <div className="p-8 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                  <p className="text-sm font-bold text-slate-900">
                    {canManageClub
                      ? 'Payment Confirmed Received'
                      : 'Payment Notice Sent'}
                  </p>
                  <p className="text-xs text-slate-600">{confirmationMessage}</p>
                </div>
              ) : outstandingDebts.length === 0 || !selectedGroup ? (
                <div className="p-6 text-center space-y-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-900">
                      $0.00 Owed · All Bills Settled
                    </p>
                    <p className="text-xs text-slate-600">
                      {activePlayer.name} ({activePlayer.playerTag}) has no unpaid session fees across any club.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={onCloseAutoPrompt}
                      className="h-9 px-4 text-xs font-semibold text-slate-700 hover:text-slate-900 rounded-xl border border-slate-300 inline-flex items-center justify-center cursor-pointer"
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
                        className="h-9 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center justify-center cursor-pointer"
                      >
                        View Full Ledger
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-5 sm:p-6 space-y-4">
                  {partialClubPaidNotice && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 font-medium flex items-center justify-between gap-2">
                      <span>{partialClubPaidNotice}</span>
                      <button
                        type="button"
                        onClick={() => setPartialClubPaidNotice(null)}
                        className="text-emerald-700 hover:text-emerald-950 shrink-0 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Multi-Club Switcher when user owes money / has pending bills at more than one club */}
                  {clubDebtGroups.length > 1 && (
                    <div className="space-y-2 pb-3 border-b border-slate-200/80">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">
                          Select Club to Settle ({clubDebtGroups.length} Clubs)
                        </span>
                        <span className="font-mono tabular-nums text-slate-600">
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
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                  : 'bg-slate-50 hover:bg-slate-100 text-slate-900 border-slate-200'
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
                                      ? 'text-slate-300'
                                      : 'text-slate-500'
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
                                      ? 'text-amber-800'
                                      : 'text-blue-700'
                                  }`}
                                >
                                  {group.unpaidAmount > 0
                                    ? `${formatClubCurrency(group.unpaidAmount, group.club)} due`
                                    : `${formatClubCurrency(group.pendingAmount, group.club)} pend`}
                                </span>
                                <span
                                  className={`text-[10px] ${
                                    isSelected
                                      ? 'text-slate-300'
                                      : 'text-slate-500'
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
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
                    <div>
                      <span className="text-xs font-semibold text-slate-600 block">
                        {selectedGroup.isUnavailable
                          ? 'Club details unavailable'
                          : `Amount Due to ${selectedGroup.club.name} (${selectedGroup.paymentDetails.recipientName})`}
                      </span>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono tabular-nums text-lg sm:text-xl font-bold text-slate-950">
                          $
                          {(selectedGroup.unpaidAmount > 0
                            ? selectedGroup.unpaidAmount
                            : selectedGroup.totalAmount
                          ).toFixed(2)}
                        </span>
                        {selectedGroup.pendingAmount > 0 &&
                          selectedGroup.unpaidAmount > 0 && (
                            <span className="text-xs font-mono text-blue-700 font-semibold">
                              (+{formatClubCurrency(selectedGroup.pendingAmount, selectedGroup.club)}{' '}
                              pending)
                            </span>
                          )}
                      </div>
                    </div>

                    <SegmentedControl
                      size="sm"
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

                  {/* TAB 1: PAYMENT METHOD INFO FOR SELECTED CLUB */}
                  {modalTab === 'info' &&
                    (selectedGroup.isUnavailable ? (
                      <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-2">
                        <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
                        <p className="text-sm font-bold text-slate-900">
                          Club details unavailable
                        </p>
                        <p className="text-xs text-slate-600 max-w-sm mx-auto">
                          Payment details for this club could not be loaded. Please contact the club organizer directly to settle this session bill.
                        </p>
                      </div>
                    ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                          <span className="font-bold text-slate-950 text-xs sm:text-sm">
                            {selectedGroup.club.name} — Payment Details
                          </span>
                          <span className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span>
                              Recipient:{' '}
                              {selectedGroup.paymentDetails.recipientName}
                            </span>
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Phone Number Field (PayNow / Mobile Transfer) */}
                          {hasPhoneDetails && (
                          <div className="flex flex-col justify-between gap-2.5 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
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
                                className="h-7 px-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                              >
                                {copiedField ===
                                `phone_${selectedGroup.club.id}` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-slate-600" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="space-y-0.5">
                              <p className="font-mono tabular-nums font-bold text-base sm:text-lg text-slate-950 break-all">
                                {selectedGroup.paymentDetails.phoneNumber}
                              </p>
                              <p className="text-xs font-medium text-slate-700">
                                Recipient:{' '}
                                <span className="font-semibold text-slate-900">
                                  {selectedGroup.paymentDetails.recipientName}
                                </span>
                              </p>
                            </div>
                          </div>
                          )}

                          {/* Bank Account Field (hidden when the club stored no bank details) */}
                          {hasBankDetails && (
                          <div className="flex flex-col justify-between gap-2.5 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
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
                                className="h-7 px-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                              >
                                {copiedField ===
                                `bank_${selectedGroup.club.id}` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5 text-slate-600" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="space-y-0.5">
                              <p className="font-mono tabular-nums font-bold text-base sm:text-lg text-slate-950 break-all">
                                {selectedGroup.paymentDetails.bankAccountNumber}
                              </p>
                              <p className="text-xs font-medium text-slate-700">
                                Holder:{' '}
                                <span className="font-semibold text-slate-900">
                                  {selectedGroup.paymentDetails.recipientName}
                                </span>
                              </p>
                            </div>
                          </div>
                          )}
                        </div>

                        {/* Transfer Note */}
                        <div className="text-xs text-slate-700 pt-1">
                          <span className="font-bold text-slate-900">
                            Reference Note:
                          </span>{' '}
                          {selectedGroup.paymentDetails.paymentNotes}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* TAB 2: SESSION BILLS FOR SELECTED CLUB */}
                  {modalTab === 'bills' && (
                    <div className="space-y-2.5 max-h-64 overflow-y-auto">
                      {selectedGroup.debts.map(({ rsvp, session }) => (
                        <div
                          key={rsvp.id}
                          className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-bold text-slate-900 break-words">
                                {session.title}
                              </p>
                              <span className="text-[11px] font-semibold text-slate-500">
                                · {selectedGroup.club.name}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 font-mono tabular-nums">
                              {session.sessionDate} · {session.venue}
                            </p>
                            <p className="text-xs text-slate-700">
                              Status:{' '}
                              {rsvp.paidStatus === 'pending_approval' ? (
                                <span className="font-semibold text-blue-700">
                                  Pending Club Owner Verification
                                </span>
                              ) : rsvp.paidMethod === 'Rejected' ? (
                                <span className="font-semibold text-red-600">
                                  Not Received — Please Verify Transfer
                                </span>
                              ) : (
                                <span className="font-semibold text-amber-700">
                                  Unpaid
                                </span>
                              )}
                            </p>
                            {(() => {
                              // The amount on the right (feeShare) is what is still payable;
                              // explain any wallet credit that already covered part of the share.
                              const ledger = getRsvpWalletLedger(rsvp);
                              return ledger.walletCreditApplied > 0 ? (
                                <p className="text-[11px] text-sky-700 font-medium font-mono tabular-nums">
                                  Share{' '}
                                  {formatClubCurrency(ledger.grossFeeShare, selectedGroup.club)} − club
                                  credit{' '}
                                  {formatClubCurrency(ledger.walletCreditApplied, selectedGroup.club)}
                                </p>
                              ) : null;
                            })()}
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                            {canManageClub ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    onAcceptOrClearSingle(rsvp.id, 'Received')
                                  }
                                  className="h-8 px-3 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl inline-flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Received</span>
                                </button>
                                {rsvp.paidStatus === 'pending_approval' && (
                                  <button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() => onRejectSingle(rsvp.id)}
                                    className="h-8 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl inline-flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5 text-red-600" />
                                    <span>Not Received</span>
                                  </button>
                                )}
                              </div>
                            ) : (
                              rsvp.paidStatus === 'unpaid' &&
                              onNotifyPaymentSentSingle && (
                                <button
                                  type="button"
                                  disabled={
                                    isSubmitting || selectedGroup.isUnavailable
                                  }
                                  onClick={() =>
                                    onNotifyPaymentSentSingle(
                                      rsvp.id,
                                      'Submitted'
                                    )
                                  }
                                  className="h-8 px-3 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl inline-flex items-center justify-center transition-colors cursor-pointer"
                                >
                                  <span>Paid This</span>
                                </button>
                              )
                            )}

                            <span className="w-20 text-right font-bold font-mono tabular-nums text-sm text-slate-950 shrink-0">
                              {formatClubCurrency(rsvp.feeShare, selectedGroup.club)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Modal Footer Actions (Scoped to Selected Club) */}
                  <div className="pt-3 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-600">
                      {selectedGroup.isUnavailable
                        ? 'Club details unavailable. Contact the club organizer directly to settle.'
                        : canManageClub
                        ? `Confirm whether payment was received for ${selectedGroup.club.name}.`
                        : `${selectedGroup.paymentDetails.recipientName} (${selectedGroup.club.name}) will verify receipt and clear your balance.`}
                    </span>
                    <div className="flex items-center justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={onCloseAutoPrompt}
                        className="h-9 px-3.5 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center transition-colors cursor-pointer"
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
                        className="h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
                      >
                        {selectedGroup.isUnavailable ? (
                          <span>Club Details Unavailable</span>
                        ) : canManageClub ? (
                          <>
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Confirm Received ($
                              {selectedGroup.totalAmount.toFixed(2)})
                            </span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {selectedGroup.unpaidAmount === 0
                                ? `Awaiting ${selectedGroup.paymentDetails.recipientName}'s Approval`
                                : `I Have Paid ${formatClubCurrency(selectedGroup.unpaidAmount, selectedGroup.club)} to ${selectedGroup.paymentDetails.recipientName}`}
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

