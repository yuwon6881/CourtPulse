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
import { Club, OutstandingDebtItem, Player } from '../types';
import { parseClubPaymentDetails } from '../utils/badmintonLogic';
import { SegmentedControl, StyledSelect } from './ui/FormControls';

interface PaymentRequestBannerAndModalProps {
  activeClub: Club;
  clubs: Club[];
  activePlayer: Player | null;
  outstandingDebts: OutstandingDebtItem[];
  canManageClub: boolean;
  onNotifyPaymentSentAll: (paymentMethod: string) => Promise<void>;
  onNotifyPaymentSentSingle?: (
    rsvpId: string,
    paymentMethod: string
  ) => Promise<void>;
  onAcceptOrClearAll: (paymentMethod: string) => Promise<void>;
  onAcceptOrClearSingle: (rsvpId: string, paymentMethod: string) => Promise<void>;
  onRejectSingle: (rsvpId: string) => Promise<void>;
  autoPromptOpen: boolean;
  onCloseAutoPrompt: () => void;
  onOpenPrompt: () => void;
  onGoToLedger?: () => void;
}

const PAYMENT_METHODS = [
  'Phone / PayNow',
  'Bank Account Transfer',
  'Cash',
];

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
  const [selectedMethod, setSelectedMethod] =
    useState<string>('Phone / PayNow');
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
        await onAcceptOrClearAll(selectedMethod);
        setConfirmationMessage(
          `Confirmed payment received ($${totalOwed.toFixed(2)}) via ${selectedMethod}.`
        );
      } else {
        await onNotifyPaymentSentAll(selectedMethod);
        setConfirmationMessage(
          `Submitted $${totalOwed.toFixed(2)} via ${selectedMethod}. Club Owner / Admin will verify and mark as received.`
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
      {outstandingDebts.length > 0 && (
        <section
          aria-label="Outstanding Session Balance"
          className={`${
            allPendingVerification
              ? 'bg-blue-50/85 border-b border-blue-200/80'
              : 'bg-amber-50/90 border-b border-amber-200/80'
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
              {onGoToLedger && (
                <button
                  type="button"
                  onClick={onGoToLedger}
                  className="h-8 w-28 px-2.5 text-xs font-semibold text-slate-700 bg-white/80 hover:bg-white border border-slate-200/90 rounded-lg inline-flex items-center justify-center transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open Ledger
                </button>
              )}
              <button
                type="button"
                onClick={onOpenPrompt}
                className="h-8 w-36 px-3 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
        </section>
      )}

      {/* Payment Info & Settlement Modal */}
      {autoPromptOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-modal-title"
        >
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <h2
                  id="payment-modal-title"
                  className="text-sm font-bold text-slate-900"
                >
                  Make Payment &amp; Settlement Status
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Transfer via Phone Number or Bank Account, then notify the Club Owner/Admin.
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseAutoPrompt}
                className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {confirmationMessage !== null ? (
              <div className="p-8 text-center space-y-2">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
                <p className="text-sm font-bold text-slate-900">
                  {canManageClub
                    ? 'Payment Confirmed Received'
                    : 'Payment Notice Sent'}
                </p>
                <p className="text-xs text-slate-500">{confirmationMessage}</p>
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
                  <p className="text-xs text-slate-500">
                    {activePlayer.name} ({activePlayer.playerTag}) has no unpaid session fees across any club.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onCloseAutoPrompt}
                    className="h-9 w-28 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 inline-flex items-center justify-center"
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
                      className="h-9 w-36 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center justify-center"
                    >
                      View Full Ledger
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                {/* Summary Strip + Tab Switcher (Payment Info Tab vs Session Bills Tab) */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <span className="text-xs text-slate-500 block">
                      Total Amount Due ({activePlayer.name})
                    </span>
                    <span className="font-mono tabular-nums text-lg font-bold text-slate-900">
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
                  <div className="space-y-3.5">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3 text-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200/70">
                        <span className="font-bold text-slate-900">
                          {primaryDebtClub.name} — Payment Details
                        </span>
                        <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          Recipient: {paymentDetails.recipientName}
                        </span>
                      </div>

                      {/* Phone Number Field (PayNow / Mobile Transfer) */}
                      <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-lg border border-slate-200/70">
                        <div className="space-y-0.5 min-w-0">
                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>Phone Number (PayNow / Mobile Transfer)</span>
                          </span>
                          <p className="font-mono tabular-nums font-bold text-sm text-slate-900">
                            {paymentDetails.phoneNumber}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyValue('phone', paymentDetails.phoneNumber)
                          }
                          className="h-8 w-24 px-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                        >
                          {copiedField === 'phone' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Bank Account Field */}
                      <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-lg border border-slate-200/70">
                        <div className="space-y-0.5 min-w-0">
                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-slate-400" />
                            <span>
                              Bank Account ({paymentDetails.bankName})
                            </span>
                          </span>
                          <p className="font-mono tabular-nums font-bold text-sm text-slate-900">
                            {paymentDetails.bankAccountNumber}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Account Name: {paymentDetails.recipientName}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyValue(
                              'bank',
                              paymentDetails.bankAccountNumber
                            )
                          }
                          className="h-8 w-24 px-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
                        >
                          {copiedField === 'bank' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Transfer Note */}
                      <div className="text-[11px] text-slate-500 pt-0.5">
                        <span className="font-semibold text-slate-700">
                          Reference Note:
                        </span>{' '}
                        {paymentDetails.paymentNotes}
                      </div>
                    </div>

                    <StyledSelect
                      label="Payment Method Used"
                      value={selectedMethod}
                      onChange={(e) => setSelectedMethod(e.target.value)}
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </StyledSelect>
                  </div>
                )}

                {/* TAB 2: SESSION BILLS & ADMIN VERIFICATION */}
                {modalTab === 'bills' && (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto">
                    {outstandingDebts.map(({ rsvp, session }) => (
                      <div
                        key={rsvp.id}
                        className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-semibold text-slate-900 truncate">
                            {session.title}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {session.sessionDate} · {session.venue}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Status:{' '}
                            {rsvp.paidStatus === 'pending_approval' ? (
                              <span className="font-semibold text-blue-700">
                                Pending Admin/Owner Verification ({rsvp.paidMethod})
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
                          <span className="font-bold font-mono tabular-nums text-sm text-slate-900">
                            ${rsvp.feeShare.toFixed(2)}
                          </span>

                          {canManageClub ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() =>
                                  onAcceptOrClearSingle(rsvp.id, selectedMethod)
                                }
                                className="h-8 w-24 px-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center justify-center gap-1 transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Received</span>
                              </button>
                              {rsvp.paidStatus === 'pending_approval' && (
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => onRejectSingle(rsvp.id)}
                                  className="h-8 w-24 px-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center gap-1 transition-colors"
                                >
                                  <X className="w-3.5 h-3.5 text-red-600" />
                                  <span>Reject</span>
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
                                    selectedMethod
                                  )
                                }
                                className="h-8 w-24 px-2 text-xs font-semibold text-slate-900 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center justify-center transition-colors"
                              >
                                <span>Paid This</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Modal Footer Actions */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    {canManageClub
                      ? 'Admin/Owner: Confirm whether payment was received.'
                      : 'Admin/Owner will verify receipt and clear your balance.'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={onCloseAutoPrompt}
                      className="h-9 w-24 px-3 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center transition-colors"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handlePrimaryAction}
                      className="h-9 w-48 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
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
          </div>
        </div>
      )}
    </>
  );
};
