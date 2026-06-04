import {
  getCurrentMstMonthDayCount,
  getElapsedMstBillingDays,
  getNextMonthlyAnchorDate,
} from './calendar';

export interface UpgradeBillingPlan {
  deltaCents: number;
  dueTodaySubtotalCents: number;
  anchorDateIso: string;
  elapsedDays: number;
  daysInMonth: number;
  nextInvoiceBaseCreditCents: number;
  nextInvoiceBaseAmountCents: number;
}

export function buildUpgradeBillingPlan(
  effectiveAt: Date,
  oldMonthlyRetainerCents: number,
  newMonthlyRetainerCents: number,
): UpgradeBillingPlan {
  if (!Number.isFinite(oldMonthlyRetainerCents) || oldMonthlyRetainerCents <= 0) {
    throw new Error('oldMonthlyRetainerCents must be positive');
  }
  if (!Number.isFinite(newMonthlyRetainerCents) || newMonthlyRetainerCents <= 0) {
    throw new Error('newMonthlyRetainerCents must be positive');
  }
  if (newMonthlyRetainerCents <= oldMonthlyRetainerCents) {
    throw new Error('newMonthlyRetainerCents must exceed oldMonthlyRetainerCents for upgrades');
  }

  const deltaCents = newMonthlyRetainerCents - oldMonthlyRetainerCents;
  const anchorDate = getNextMonthlyAnchorDate(effectiveAt);
  const elapsedDays = getElapsedMstBillingDays(effectiveAt);
  const daysInMonth = getCurrentMstMonthDayCount(effectiveAt);
  const nextInvoiceBaseCreditCents =
    elapsedDays <= 0 ? 0 : Math.round((deltaCents * elapsedDays) / daysInMonth);
  const nextInvoiceBaseAmountCents = Math.max(
    newMonthlyRetainerCents - nextInvoiceBaseCreditCents,
    0,
  );

  return {
    deltaCents,
    dueTodaySubtotalCents: deltaCents,
    anchorDateIso: anchorDate.toISOString(),
    elapsedDays,
    daysInMonth,
    nextInvoiceBaseCreditCents,
    nextInvoiceBaseAmountCents,
  };
}
