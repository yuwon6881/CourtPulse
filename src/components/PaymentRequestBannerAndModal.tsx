import React, { useEffect, useState } from 'react';
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
import { Club, OutstandingDebtItem, Player } from '../types';
import { parseClubPaymentDetails } from '../utils/badmintonLogic';
import { SegmentedControl } from './ui/FormControls';

interface PaymentRequestBannerAndModalProps {
  activeClub: Club;
  clubs: Club[];
  activePlayer: Player | null;
  outstandingDebts: OutstandingDebtItem[];
  canManageClub: boolean;
  onNotifyPaymentSentAll: (paymentMethod?: string) => Promise<void>;
  onNotifyPaymentSentSingle?: (
    rsvpId: string,
    paymentMethod?: string
  ) => Promise<void>;
  onAcceptOrClearAll: (paymentMethod?: string) => Promise<void>;
  onAcceptOrClearSingle: (rsvpId: string, paymentMethod?: string) => Promise<void>;
  onRejectSingle: (rsvpId: string) => Promise<void>;
  autoPromptOpen: boolean;
  onCloseAutoPrompt: () => void;
  onOpenPrompt: () => void;
  onGoToLedger?: () => void;
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
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(
    null
  );

  // When modal opens, default to Payment Info tab for users paying, or Bills tab if Admin/Owner reviewing
  useEffect(() => {
    if (autoPromptOpen) {
      setModalTab('info');
    }
  }, [autoPromptOpen]);

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

  const allPendingVerification =
    outstandingDebts.length > 0 &&
    outstandingDebts.every((d) => d.rsvp.paidStatus === 'pending_approval');

  // Resolve payment details from the primary club of the outstanding debt (or activeClub)
  const primaryDebtClub =
    outstandingDebts.length > 0
      ? clubs.find((c) => c.id === outstandingDebts[0].session.clubId) ||
        activeClub
      : activeClub;

  const paymentDetails =
    primaryDebtClub.paymentDetails ||
    parseClubPaymentDetails(
      primaryDebtClub.paymentInfo,
      primaryDebtClub.clubOwnerName || 'Alex Tan'
    );

  const handleCopyValue = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      // ignore
    }
  };

  const handlePrimaryAction = async () => {
    if (outstandingDebts.length === 0) return;
    setIsSubmitting(true);
    try {
      if (canManageClub) {
        await onAcceptOrClearAll('Received');
        setConfirmationMessage(
          `Confirmed payment received ($${totalOwed.toFixed(2)}).`
        );
      } else {
        await onNotifyPaymentSentAll('Submitted');
        setConfirmationMessage(
          `Submitted $${totalOwed.toFixed(2)}. Club Owner / Admin will verify and mark as received.`
        );
      }
      setTimeout(() => {
        setConfirmationMessage(null);
        onCloseAutoPrompt();
      }, 1400);
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
                    ? `Pending Admin/Owner Verification: $${pendingAmount.toFixed(2)}`
                    : `Unpaid Balance: $${unpaidAmount.toFixed(2)}`}
                </span>
                {pendingAmount > 0 && unpaidAmount > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-mono tabular-nums text-blue-800 font-medium">
                      +${pendingAmount.toFixed(2)} awaiting verification
                    </span>
                  </>
                )}
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-slate-600">
                  {outstandingDebts.length}{' '}
                  {outstandingDebts.length === 1 ? 'session bill' : 'session bills'}
                </span>
                {allPendingVerification && (
                  <>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 text-blue-800 font-medium">
                      <Clock className="w-3 h-3" />
                      Admin/Owner will confirm once payment is received
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
                      ? `Verify $${totalOwed.toFixed(2)}`
                      : allPendingVerification
                      ? 'Payment Info'
                      : `Pay $${unpaidAmount.toFixed(2)}`}
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
            onClick={onCloseAutoPrompt}
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
                    Transfer via Phone Number or Bank Account, then notify the Club Owner/Admin.
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
              ) : outstandingDebts.length === 0 ? (
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
                  {/* Summary Strip + Tab Switcher (Payment Info Tab vs Session Bills Tab) */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
                    <div>
                      <span className="text-xs font-semibold text-slate-600 block">
                        Total Amount Due ({activePlayer.name})
                      </span>
                      <span className="font-mono tabular-nums text-lg sm:text-xl font-bold text-slate-950">
                        ${totalOwed.toFixed(2)}
                      </span>
                    </div>

                    <SegmentedControl
                      size="sm"
                      options={[
                        { value: 'info', label: 'Payment Info' },
                        {
                          value: 'bills',
                          label: 'Session Bills',
                          count: outstandingDebts.length,
                        },
                      ]}
                      value={modalTab}
                      onChange={setModalTab}
                    />
                  </div>

                  {/* TAB 1: PAYMENT METHOD INFO (Phone Number & Bank Account Fields) */}
                  {modalTab === 'info' && (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                          <span className="font-bold text-slate-950 text-xs sm:text-sm">
                            {primaryDebtClub.name} — Payment Details
                          </span>
                          <span className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span>Recipient: {paymentDetails.recipientName}</span>
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Phone Number Field (PayNow / Mobile Transfer) */}
                          <div className="flex flex-col justify-between gap-2.5 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                <span>PayNow / Mobile</span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyValue('phone', paymentDetails.phoneNumber)
                                }
                                className="h-7 px-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                              >
                                {copiedField === 'phone' ? (
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
                                {paymentDetails.phoneNumber}
                              </p>
                              <p className="text-xs font-medium text-slate-700">
                                Recipient: <span className="font-semibold text-slate-900">{paymentDetails.recipientName}</span>
                              </p>
                            </div>
                          </div>

                          {/* Bank Account Field */}
                          <div className="flex flex-col justify-between gap-2.5 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                <span>{paymentDetails.bankName}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyValue(
                                    'bank',
                                    paymentDetails.bankAccountNumber
                                  )
                                }
                                className="h-7 px-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                              >
                                {copiedField === 'bank' ? (
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
                                {paymentDetails.bankAccountNumber}
                              </p>
                              <p className="text-xs font-medium text-slate-700">
                                Holder: <span className="font-semibold text-slate-900">{paymentDetails.recipientName}</span>
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Transfer Note */}
                        <div className="text-xs text-slate-700 pt-1">
                          <span className="font-bold text-slate-900">
                            Reference Note:
                          </span>{' '}
                          {paymentDetails.paymentNotes}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: SESSION BILLS & ADMIN VERIFICATION */}
                  {modalTab === 'bills' && (
                    <div className="space-y-2.5 max-h-64 overflow-y-auto">
                      {outstandingDebts.map(({ rsvp, session }) => (
                        <div
                          key={rsvp.id}
                          className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <p className="font-bold text-slate-900 break-words">
                              {session.title}
                            </p>
                            <p className="text-xs text-slate-600 font-mono tabular-nums">
                              {session.sessionDate} · {session.venue}
                            </p>
                            <p className="text-xs text-slate-700">
                              Status:{' '}
                              {rsvp.paidStatus === 'pending_approval' ? (
                                <span className="font-semibold text-blue-700">
                                  Pending Admin/Owner Verification
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
                                  disabled={isSubmitting}
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
                              ${rsvp.feeShare.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Modal Footer Actions */}
                  <div className="pt-3 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-600">
                      {canManageClub
                        ? 'Admin/Owner: Confirm whether payment was received.'
                        : 'Admin/Owner will verify receipt and clear your balance.'}
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
                        disabled={isSubmitting}
                        onClick={handlePrimaryAction}
                        className="h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
                      >
                        {canManageClub ? (
                          <>
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>Confirm Received (${totalOwed.toFixed(2)})</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {allPendingVerification
                                ? 'Resubmit Payment Sent'
                                : `I Have Paid ($${totalOwed.toFixed(2)})`}
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
