import type { PaymentTiming } from '../types';

/** Sessions created before this setting existed (and any unreadable value) collect after the match. */
export function normalizePaymentTiming(value: unknown): PaymentTiming {
  return value === 'before' ? 'before' : 'after';
}

export const PAYMENT_TIMING_OPTIONS: { value: PaymentTiming; label: string }[] = [
  { value: 'after', label: 'After the match' },
  { value: 'before', label: 'Before the match' },
];

export function describePaymentTiming(timing: PaymentTiming): string {
  return timing === 'before'
    ? 'Players pay their estimated share before play. The final split is still calculated after the match.'
    : 'Fees are split and collected after the match, once the host finalizes the split.';
}
