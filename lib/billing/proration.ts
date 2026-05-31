export interface BillingAnchorPlan {
  anchorDateIso: string;
  firstRecurringInvoiceAmountCents: number;
  firstRecurringCreditCents: number;
}

function utcMidday(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return utcMidday(year, monthIndex + 1, 0).getUTCDate();
}

export function getNextMonthlyAnchorDate(startedAt: Date): Date {
  return utcMidday(startedAt.getUTCFullYear(), startedAt.getUTCMonth() + 1, 1);
}

export function buildBillingAnchorPlan(
  startedAt: Date,
  monthlyRetainerCents: number
): BillingAnchorPlan {
  if (!Number.isFinite(monthlyRetainerCents) || monthlyRetainerCents <= 0) {
    throw new Error('monthlyRetainerCents must be positive');
  }

  const anchorDate = getNextMonthlyAnchorDate(startedAt);
  const startedDay = startedAt.getUTCDate();
  const anchorMonthDays = daysInUtcMonth(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth());

  const firstRecurringInvoiceAmountCents =
    startedDay <= 1
      ? monthlyRetainerCents
      : Math.round(
          (monthlyRetainerCents * Math.min(startedDay - 1, anchorMonthDays)) / anchorMonthDays
        );

  return {
    anchorDateIso: anchorDate.toISOString(),
    firstRecurringInvoiceAmountCents,
    firstRecurringCreditCents: monthlyRetainerCents - firstRecurringInvoiceAmountCents,
  };
}
