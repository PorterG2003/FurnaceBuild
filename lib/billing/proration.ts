import {
  daysInMstMonth,
  getMstDateParts,
  getNextMonthlyAnchorDate,
} from './calendar';

export { getNextMonthlyAnchorDate } from './calendar';

export type PlatformInviteProrationMode = 'second_month' | 'first_month';

export const DEFAULT_PLATFORM_INVITE_PRORATION_MODE: PlatformInviteProrationMode = 'second_month';

/** Stripe rejects charges below $0.50 USD. */
export const STRIPE_MINIMUM_CHARGE_CENTS = 50;

export interface BillingAnchorPlan {
  anchorDateIso: string;
  prorationMode: PlatformInviteProrationMode;
  dueTodaySubtotalCents: number;
  /** Days of the signup month the due-today charge covers. Equals dueTodayMonthDays when not prorated. */
  dueTodayCoveredDays: number;
  dueTodayMonthDays: number;
  firstRecurringAmountDueCents: number;
  overlapCreditCents: number;
}

export function isPlatformInviteProrationMode(
  value: unknown,
): value is PlatformInviteProrationMode {
  return value === 'second_month' || value === 'first_month';
}

export function normalizePlatformInviteProrationMode(
  value: unknown,
): PlatformInviteProrationMode {
  return isPlatformInviteProrationMode(value) ? value : DEFAULT_PLATFORM_INVITE_PRORATION_MODE;
}

/** True when the charge covers less than the whole calendar month it belongs to. */
export function isBillingAnchorPlanProrated(plan: BillingAnchorPlan): boolean {
  return plan.dueTodayCoveredDays < plan.dueTodayMonthDays;
}

export function buildBillingAnchorPlan(
  startedAt: Date,
  monthlyRetainerCents: number,
  prorationMode: PlatformInviteProrationMode = DEFAULT_PLATFORM_INVITE_PRORATION_MODE,
): BillingAnchorPlan {
  if (!Number.isFinite(monthlyRetainerCents) || monthlyRetainerCents < 0) {
    throw new Error('monthlyRetainerCents must be zero or greater');
  }

  const anchorDate = getNextMonthlyAnchorDate(startedAt);
  const {
    year: startedYear,
    monthIndex: startedMonthIndex,
    day: startedDay,
  } = getMstDateParts(startedAt);
  const startedMonthDays = daysInMstMonth(startedYear, startedMonthIndex);

  if (prorationMode === 'first_month') {
    const remainingDays = Math.min(
      Math.max(startedMonthDays - startedDay + 1, 0),
      startedMonthDays,
    );
    const rawDueTodayCents = Math.round(
      (monthlyRetainerCents * remainingDays) / startedMonthDays,
    );
    // A late-month signup on a small retainer can round below the Stripe minimum, which
    // would fail checkout with an opaque error. Clamping here keeps the quote, the admin
    // preview, and the actual charge in agreement.
    const dueTodaySubtotalCents =
      rawDueTodayCents > 0 && rawDueTodayCents < STRIPE_MINIMUM_CHARGE_CENTS
        ? STRIPE_MINIMUM_CHARGE_CENTS
        : rawDueTodayCents;

    return {
      anchorDateIso: anchorDate.toISOString(),
      prorationMode,
      dueTodaySubtotalCents,
      dueTodayCoveredDays: remainingDays,
      dueTodayMonthDays: startedMonthDays,
      firstRecurringAmountDueCents: monthlyRetainerCents,
      overlapCreditCents: 0,
    };
  }

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
    prorationMode: 'second_month',
    dueTodaySubtotalCents: monthlyRetainerCents,
    dueTodayCoveredDays: startedMonthDays,
    dueTodayMonthDays: startedMonthDays,
    firstRecurringAmountDueCents,
    overlapCreditCents,
  };
}
