import { formatRelativeTime } from '@/lib/formatRelativeTime';

export const ENRICH_COPY = {
  title: 'Enrich lead',
  sectionTitle: 'Lead enrichment',
  loading: 'Looking up lead…',
  loadingInitial: 'Loading…',
  enrichButton: 'Enrich',
  reviewButton: 'Review',
  reEnrichButton: 'Re-enrich',
  retryButton: 'Retry',
  companyPhoneLabel: 'Company phone',
  mobileLabel: 'Mobile',
  mobileLoading: 'Looking up mobile number…',
  mobileNotFound: 'No mobile number was found.',
  wasEmpty: 'was empty',
} as const;

function savedPrefix(enrichedAt: string): string {
  return `Saved ${formatRelativeTime(enrichedAt)}.`;
}

function creditLine(creditsRemaining: number, { forReEnrich = false }: { forReEnrich?: boolean } = {}): string {
  if (creditsRemaining <= 0) return 'No credits left this month.';
  if (forReEnrich) return 'Re-enrich uses 1 credit when a match is found.';
  return 'Uses 1 credit when a match is found.';
}

function joinParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part) => part && part.trim() !== '').join(' ');
}

export function enrichIdleInfo(creditsRemaining: number): string {
  return joinParts([
    'Look up lead, company, and personalization details for this person.',
    creditLine(creditsRemaining),
  ]);
}

export function enrichNoMatchInfo(
  creditsRemaining: number,
  options: { isCached?: boolean; enrichedAt?: string } = {},
): string {
  const { isCached = false, enrichedAt } = options;
  return joinParts([
    isCached && enrichedAt ? savedPrefix(enrichedAt) : null,
    'No match found for this lead.',
    isCached ? 'No credit was used.' : 'No credit was used for this lookup.',
    creditLine(creditsRemaining, { forReEnrich: true }),
  ]);
}

export function enrichNothingToApplyInfo(
  creditsRemaining: number,
  options: {
    isCached?: boolean;
    enrichedAt?: string;
  } = {},
): string {
  const { isCached = false, enrichedAt } = options;
  return joinParts([
    isCached && enrichedAt ? savedPrefix(enrichedAt) : null,
    isCached
      ? 'Saved enrichment results already match this profile.'
      : 'No new information was found for this lead.',
    isCached ? 'Reviewing saved results does not use a credit.' : null,
    creditLine(creditsRemaining, { forReEnrich: true }),
  ]);
}

export function enrichMatchInfo(
  creditsRemaining: number,
  options: {
    isCached?: boolean;
    enrichedAt?: string;
  } = {},
): string {
  const { isCached = false, enrichedAt } = options;
  return joinParts([
    isCached && enrichedAt ? savedPrefix(enrichedAt) : null,
    isCached
      ? 'Review suggested updates and choose which fields to apply. Reviewing saved results does not use a credit.'
      : 'Review suggested updates and choose which fields to apply.',
    creditLine(creditsRemaining, { forReEnrich: true }),
  ]);
}

export function enrichRetryInfo(creditsRemaining: number): string {
  return creditLine(creditsRemaining, { forReEnrich: true });
}

export function enrichErrorInfo(
  message: string,
  creditsRemaining: number,
  code?: string,
): string {
  if (code === 'NO_CREDITS') return message;
  if (code === 'APOLLO_UPSTREAM') {
    if (creditsRemaining > 0) {
      return `${message} You still have ${creditsRemaining} enrichment credits this month.`;
    }
    return message;
  }
  const retry = enrichRetryInfo(creditsRemaining);
  return retry ? `${message} ${retry}` : message;
}
