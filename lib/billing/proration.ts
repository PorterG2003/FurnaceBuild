export interface BillingAnchorPlan {
  anchorDateIso: string;
  firstRecurringAmountDueCents: number;
  overlapCreditCents: number;
}

import {
  daysInMstMonth,
  getMstDateParts,
  getNextMonthlyAnchorDate,
} from './calendar';

export { getNextMonthlyAnchorDate } from './calendar';

export function buildBillingAnchorPlan(
  startedAt: Date,
  monthlyRetainerCents: number
): BillingAnchorPlan {
  if (!Number.isFinite(monthlyRetainerCents) || monthlyRetainerCents <= 0) {
    throw new Error('monthlyRetainerCents must be positive');
  }

  const anchorDate = getNextMonthlyAnchorDate(startedAt);
  const { day: startedDay } = getMstDateParts(startedAt);
  const { year: anchorYear, monthIndex: anchorMonthIndex } = getMstDateParts(anchorDate);
  const anchorMonthDays = daysInMstMonth(anchorYear, anchorMonthIndex);
  const overlapCoveredDays = Math.min(Math.max(startedDay - 1, 0), anchorMonthDays);
  const overlapCreditCents = Math.round(
    (monthlyRetainerCents * overlapCoveredDays) / anchorMonthDays
  );
  const firstRecurringAmountDueCents = Math.max(
    monthlyRetainerCents - overlapCreditCents,
    0,
  );

  return {
    anchorDateIso: anchorDate.toISOString(),
    firstRecurringAmountDueCents,
    overlapCreditCents,
  };
}
