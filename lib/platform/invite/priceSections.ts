import type { PlatformCheckoutQuote } from '@/lib/services/platformCommerce';

export type InvitePriceRowRole = 'line_item' | 'total';

export interface InvitePriceRow {
  label: string;
  /** Signed cents. Credits are negative so a section's line items always sum to its total. */
  amountCents: number;
  role: InvitePriceRowRole;
}

export interface InvitePriceSection {
  title: string;
  rows: InvitePriceRow[];
}

/** True when the due-today charge covers less than the whole signup month. */
export function isQuoteDueTodayProrated(quote: PlatformCheckoutQuote): boolean {
  return quote.dueTodayCoveredDays < quote.dueTodayMonthDays;
}

function buildDueTodaySection(
  quote: PlatformCheckoutQuote,
  routeLabel: string,
): InvitePriceSection {
  const rows: InvitePriceRow[] = [
    {
      label: isQuoteDueTodayProrated(quote)
        ? `Partial month (${quote.dueTodayCoveredDays} of ${quote.dueTodayMonthDays} days)`
        : 'Monthly retainer',
      amountCents: quote.subtotalCents,
      role: 'line_item',
    },
  ];

  if (quote.routeFeeCents > 0) {
    rows.push({
      label: `${routeLabel} processing fee`,
      amountCents: quote.routeFeeCents,
      role: 'line_item',
    });
  }

  rows.push({
    label: 'Total due today',
    amountCents: quote.totalDueTodayCents,
    role: 'total',
  });

  return { title: 'Due today', rows };
}

function buildOngoingRows(quote: PlatformCheckoutQuote, routeLabel: string): InvitePriceRow[] {
  const rows: InvitePriceRow[] = [
    {
      label: 'Monthly retainer',
      amountCents: quote.ongoingMonthlyRetainerCents,
      role: 'line_item',
    },
  ];

  if (quote.ongoingMonthlyRouteFeeCents > 0) {
    rows.push({
      label: `${routeLabel} processing fee`,
      amountCents: quote.ongoingMonthlyRouteFeeCents,
      role: 'line_item',
    });
  }

  rows.push({
    label: 'Monthly total',
    amountCents: quote.ongoingMonthlyTotalCents,
    role: 'total',
  });

  return rows;
}

function buildFirstInvoiceRows(
  quote: PlatformCheckoutQuote,
  routeLabel: string,
  anchorLabel: string,
): InvitePriceRow[] {
  const rows: InvitePriceRow[] = [
    {
      label: 'Monthly retainer',
      amountCents: quote.monthlyRetainerCents,
      role: 'line_item',
    },
  ];

  if (quote.firstRecurringDiscountCents > 0) {
    rows.push({
      label: 'Credit for days already paid',
      amountCents: -quote.firstRecurringDiscountCents,
      role: 'line_item',
    });
  }

  if (quote.firstRecurringRouteFeeCents > 0) {
    rows.push({
      label: `${routeLabel} processing fee`,
      amountCents: quote.firstRecurringRouteFeeCents,
      role: 'line_item',
    });
  }

  rows.push({
    label: `Total due on ${anchorLabel}`,
    amountCents: quote.firstRecurringInvoiceCents,
    role: 'total',
  });

  return rows;
}

export function buildInvitePriceSections(input: {
  quote: PlatformCheckoutQuote;
  routeLabel: string;
  recurringAnchorLabel: string;
}): InvitePriceSection[] {
  const { quote, routeLabel, recurringAnchorLabel } = input;
  const sections: InvitePriceSection[] = [buildDueTodaySection(quote, routeLabel)];

  // When the first recurring invoice already matches the standard monthly amount there is
  // nothing special about it, so showing a separate "first invoice" block would just repeat
  // the same numbers back to the customer.
  if (quote.firstRecurringInvoiceCents === quote.ongoingMonthlyTotalCents) {
    sections.push({
      title: `Monthly, starting ${recurringAnchorLabel}`,
      rows: buildOngoingRows(quote, routeLabel),
    });
    return sections;
  }

  sections.push({
    title: `First invoice on ${recurringAnchorLabel}`,
    rows: buildFirstInvoiceRows(quote, routeLabel, recurringAnchorLabel),
  });
  sections.push({
    title: 'Ongoing monthly',
    rows: buildOngoingRows(quote, routeLabel),
  });

  return sections;
}

export function formatInvitePriceAmount(
  amountCents: number,
  formatAmount: (cents: number) => string,
): string {
  return amountCents < 0
    ? `-${formatAmount(Math.abs(amountCents))}`
    : formatAmount(amountCents);
}
