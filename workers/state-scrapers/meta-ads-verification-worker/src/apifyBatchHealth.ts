export const KNOWN_ADVERTISER_DOMAINS = [
  'google.com',
  'microsoft.com',
  'supermetrics.com',
  'zendesk.com',
  'deel.com',
  'linkedin.com',
  'nike.com',
] as const;

export const DEFAULT_EMPTY_STREAK_LIMIT = 25;
export const DEFAULT_CANARY_EVERY = 25;
export const DEFAULT_CLIFF_WINDOW = 50;
export const DEFAULT_ROLLING_WINDOW = 100;
export const DEFAULT_CANARY_DOMAIN = 'google.com';
export const DEFAULT_HEALTH_BACKOFF_MS = 5 * 60 * 1000;
/** Light pacing between companies — enough to ease Meta #613 without doubling runtime. */
export const DEFAULT_COMPANY_DELAY_MS = 4_000;
/** Longer pause once Meta #613 is detected in actor logs. */
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 12 * 60 * 1000;

export function isEmptyNoResultRow(row: Record<string, unknown>): boolean {
  return (
    row.meta_ads_result === 'no' &&
    row.classification_reason === 'no_results' &&
    ((row.apify_total_count as number | undefined) ?? 0) === 0
  );
}

export function hasApifyHit(row: Record<string, unknown>): boolean {
  return ((row.apify_total_count as number | undefined) ?? 0) > 0;
}

export interface OrderedResult {
  index: number;
  domain: string;
  result: Record<string, unknown>;
}

export function orderResultsByCompletion(
  completedDomains: string[],
  results: Record<string, unknown>[],
): OrderedResult[] {
  const byDomain = new Map(
    results.map((row) => [(row.company_domain as string | undefined)?.trim() ?? '', row]),
  );
  return completedDomains.map((domain, index) => ({
    index,
    domain,
    result: byDomain.get(domain) ?? {
      company_domain: domain,
      meta_ads_result: 'no',
      classification_reason: 'no_results',
      apify_total_count: 0,
    },
  }));
}

export interface WindowStats {
  from: number;
  to: number;
  yes: number;
  no: number;
  unknown: number;
  apifyHits: number;
  emptyNoResults: number;
  yesPct: number;
}

export function summarizeWindow(rows: OrderedResult[], from: number, to: number): WindowStats {
  const slice = rows.slice(from, to);
  const yes = slice.filter((r) => r.result.meta_ads_result === 'yes').length;
  const no = slice.filter((r) => r.result.meta_ads_result === 'no').length;
  const unknown = slice.filter((r) => r.result.meta_ads_result === 'unknown').length;
  const apifyHits = slice.filter((r) => hasApifyHit(r.result)).length;
  const emptyNoResults = slice.filter((r) => isEmptyNoResultRow(r.result)).length;
  return {
    from: from + 1,
    to,
    yes,
    no,
    unknown,
    apifyHits,
    emptyNoResults,
    yesPct: slice.length > 0 ? (yes / slice.length) * 100 : 0,
  };
}

export function detectCliffIndex(
  ordered: OrderedResult[],
  windowSize = DEFAULT_CLIFF_WINDOW,
): number | null {
  if (ordered.length < windowSize) return null;
  for (let start = 0; start <= ordered.length - windowSize; start += 1) {
    const window = ordered.slice(start, start + windowSize);
    const apifyHits = window.filter((r) => hasApifyHit(r.result)).length;
    if (apifyHits === 0) return start;
  }
  return null;
}

export function countPostCliffEmptyNoResults(ordered: OrderedResult[], cliffIndex: number): number {
  return ordered.slice(cliffIndex).filter((r) => isEmptyNoResultRow(r.result)).length;
}

export function findKnownAdvertiserFalseNegatives(
  ordered: OrderedResult[],
  domains: readonly string[] = KNOWN_ADVERTISER_DOMAINS,
): Array<{ domain: string; index: number; reason: string; apify_total_count: number }> {
  const wanted = new Set(domains);
  return ordered
    .filter((row) => wanted.has(row.domain) && isEmptyNoResultRow(row.result))
    .map((row) => ({
      domain: row.domain,
      index: row.index + 1,
      reason: String(row.result.classification_reason ?? ''),
      apify_total_count: (row.result.apify_total_count as number | undefined) ?? 0,
    }));
}

export function rollingYesPct(results: Record<string, unknown>[], lastN = 50): number {
  const slice = results.slice(-lastN);
  if (slice.length === 0) return 0;
  const yes = slice.filter((r) => r.meta_ads_result === 'yes').length;
  return (yes / slice.length) * 100;
}
