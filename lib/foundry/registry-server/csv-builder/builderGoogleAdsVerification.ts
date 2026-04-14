import type { CsvBuilderToolJobConfig } from '../../registry-types.js';
import { canonicalizeWebsiteUrl, preprocessWebsiteInputString } from '../websiteVerification.js';
import { normalizeGoogleAdsSearchDomain } from '../googleAdsVerification.js';

function asString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Cells that are clearly not a website; we skip the row without treating it as a hard failure. */
const WEBSITE_PLACEHOLDER_RE =
  /^(n\/?a|none|null|n\/a|tbd|pending|unknown|no\s*url|no\s*website|\-{1,}|—{1,}|\.{1,})$/i;

function isPlaceholderWebsiteCell(raw: string): boolean {
  const s = preprocessWebsiteInputString(raw);
  return WEBSITE_PLACEHOLDER_RE.test(s);
}

/** First http(s) URL in free text, e.g. "see https://example.com for info". */
const HTTP_URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/i;

function extractFirstHttpUrlFromText(text: string): string | null {
  const m = text.match(HTTP_URL_IN_TEXT_RE);
  return m?.[0]?.trim() ?? null;
}

function tryResolveGoogleAdsFromString(raw: string): { input_url: string; search_domain: string } | null {
  if (isPlaceholderWebsiteCell(raw)) return null;
  let work = preprocessWebsiteInputString(raw);
  if (!work) return null;
  if (!/^https?:\/\//i.test(work)) {
    const extracted = extractFirstHttpUrlFromText(work);
    if (extracted) work = extracted;
  }
  const inputUrl = canonicalizeWebsiteUrl(work);
  const searchDomain = normalizeGoogleAdsSearchDomain(work);
  if (!inputUrl || !searchDomain) return null;
  return { input_url: inputUrl, search_domain: searchDomain };
}

export function resolveCsvBuilderGoogleAdsLookupTarget(
  rowValues: Record<string, unknown>,
  _config: CsvBuilderToolJobConfig,
): { input_url: string; search_domain: string } | null {
  const candidates = [asString(rowValues.website_verification_final_url), asString(rowValues.website)].filter(
    (s): s is string => Boolean(s),
  );
  for (const c of candidates) {
    const target = tryResolveGoogleAdsFromString(c);
    if (target) return target;
  }
  return null;
}

/** Whether a skip is due to empty inputs vs present-but-unparsable values (for clearer row messages). */
export function csvBuilderGoogleAdsSkipReason(rowValues: Record<string, unknown>): 'missing' | 'invalid' {
  const candidates = [asString(rowValues.website_verification_final_url), asString(rowValues.website)].filter(
    (s): s is string => Boolean(s),
  );
  if (candidates.length === 0) return 'missing';
  return 'invalid';
}

export function buildCsvBuilderGoogleAdsRowResult(args: {
  input_url: string;
  search_domain: string;
  result: string;
  matched_advertiser_name: string | null;
  advertiser_url: string | null;
  matched_advertiser_id: string | null;
  signals: Record<string, unknown>;
  lookup_stats: Record<string, unknown>;
  error?: string | null;
}): Record<string, unknown> {
  return {
    result: args.result,
    input_url: args.input_url,
    search_domain: args.search_domain,
    advertiser_name: args.matched_advertiser_name,
    advertiser_url: args.advertiser_url,
    advertiser_id: args.matched_advertiser_id,
    signals: args.signals,
    lookup_stats: args.lookup_stats,
    error: args.error ?? null,
  };
}

export function buildCsvBuilderGoogleAdsSkippedResult(message: string): Record<string, unknown> {
  return {
    result: 'unknown',
    input_url: null,
    search_domain: null,
    advertiser_name: null,
    advertiser_url: null,
    advertiser_id: null,
    signals: {},
    lookup_stats: {},
    error: message,
  };
}
