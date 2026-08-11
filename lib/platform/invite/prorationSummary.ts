import { MST_OFFSET_HOURS } from '@/lib/billing/calendar';
import {
  buildBillingAnchorPlan,
  isBillingAnchorPlanProrated,
  type PlatformInviteProrationMode,
} from '@/lib/billing/proration';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats an instant using the fixed MST offset the billing calendar uses, so the label
 * cannot drift a day for admins in other timezones.
 */
export function formatMstDayLabel(iso: string): string {
  const mstInstant = new Date(new Date(iso).getTime() - MST_OFFSET_HOURS * 60 * 60 * 1000);
  return `${MONTH_LABELS[mstInstant.getUTCMonth()]} ${mstInstant.getUTCDate()}`;
}

/**
 * Plain-English description of what an invite will charge, so the admin sees real amounts
 * instead of an abstract mode name.
 */
export function buildInviteProrationSummary(input: {
  monthlyRetainerCents: number;
  prorationMode: PlatformInviteProrationMode;
  formatAmount: (cents: number) => string;
  startedAt?: Date;
}): string {
  const { monthlyRetainerCents, prorationMode, formatAmount } = input;
  const plan = buildBillingAnchorPlan(
    input.startedAt ?? new Date(),
    monthlyRetainerCents,
    prorationMode,
  );
  const anchorLabel = formatMstDayLabel(plan.anchorDateIso);
  const dueToday = formatAmount(plan.dueTodaySubtotalCents);
  const firstRecurring = formatAmount(plan.firstRecurringAmountDueCents);
  const monthly = formatAmount(monthlyRetainerCents);

  if (prorationMode === 'first_month') {
    const dayNote = isBillingAnchorPlanProrated(plan)
      ? ` (${plan.dueTodayCoveredDays} of ${plan.dueTodayMonthDays} days)`
      : '';
    return `Charges ${dueToday} today${dayNote}, then ${monthly} on ${anchorLabel} and monthly after that.`;
  }

  if (plan.overlapCreditCents > 0) {
    return `Charges ${dueToday} today, then ${firstRecurring} on ${anchorLabel} and ${monthly} monthly after that.`;
  }

  return `Charges ${dueToday} today, then ${monthly} on ${anchorLabel} and monthly after that.`;
}

export function getInviteProrationModeLabel(mode: PlatformInviteProrationMode): string {
  return mode === 'first_month' ? 'Prorated today' : 'Full month today';
}
