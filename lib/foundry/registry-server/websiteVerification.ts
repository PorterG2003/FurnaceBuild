import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomainKey, normalizeNameKey } from './ingestion/normalizeSourceRecord.js';
import { canonicalizeWebsiteUrl, preprocessWebsiteInputString } from './searchDomain.js';

export const WEBSITE_VERIFIER_VERSION = 'foundry_website_verifier_v1';
export const WEBSITE_VERIFICATION_BANDS = ['usable', 'uncertain', 'not_usable'] as const;
export type WebsiteVerificationBand = (typeof WEBSITE_VERIFICATION_BANDS)[number];
export const WEBSITE_VERIFICATION_PAGE_KINDS = [
  'home',
  'contact',
  'about',
  'team',
  'locations',
  'policy',
  'services',
  'project',
  'blog',
  'listing',
  'other',
] as const;
export type WebsiteVerificationPageKind = (typeof WEBSITE_VERIFICATION_PAGE_KINDS)[number];
export const WEBSITE_VERIFICATION_SCORE_THRESHOLDS = {
  usable: 72,
  uncertain: 48,
} as const;
export const WEBSITE_VERIFICATION_DIMENSION_WEIGHTS = {
  legal_brand_match: 30,
  geography: 20,
  phone: 15,
  registry_owner: 10,
  source_link_prior: 10,
  domain_page_sanity: 10,
  cross_source_domain_agreement: 5,
  identifier_alignment_bonus: 5,
} as const;

type JsonObject = Record<string, unknown>;

function supabaseQueryErrorMessage(
  ctx: string,
  err: { message: string; details?: string | null; hint?: string | null; code?: string | null },
): string {
  const bits = [err.message, err.details, err.hint, err.code].filter(
    (x) => x != null && String(x).trim() !== '',
  );
  if (bits.length > 0) return `${ctx}: ${bits.join(' | ')}`;
  try {
    return `${ctx}: ${JSON.stringify(err)}`;
  } catch {
    return `${ctx}: unknown Supabase error`;
  }
}

/** PostgREST returns 400 if `.in()` blows the URL; keep batches conservative. */
const WEBSITE_VERIFICATION_ID_IN_BATCH = 120;

async function selectByIdBatches(
  leadsClient: SupabaseClient,
  ctxLabel: string,
  ids: string[],
  fetchBatch: (batch: string[]) => Promise<{
    data: unknown[] | null;
    error: { message: string; details?: string | null; hint?: string | null; code?: string | null } | null;
  }>,
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += WEBSITE_VERIFICATION_ID_IN_BATCH) {
    const batch = ids.slice(i, i + WEBSITE_VERIFICATION_ID_IN_BATCH);
    const { data, error } = await fetchBatch(batch);
    if (error) throw new Error(supabaseQueryErrorMessage(ctxLabel, error));
    out.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return out;
}

export interface WebsiteVerificationSourceRecord {
  source_business_record_id: string;
  link_status: string;
  link_score: number | null;
  website: string | null;
  phone: string | null;
  address_raw: string | null;
  line1: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  categories: unknown[];
  raw_payload: JsonObject;
  resolution_meta: JsonObject;
}

export interface WebsiteVerificationRegistryEntity {
  id: string;
  registry_state: string;
  legal_name: string | null;
  raw_parsed: JsonObject;
}

export interface WebsiteVerificationOwner {
  id: string;
  state_entity_id: string;
  owner_name: string;
  title_role: string | null;
}

export interface WebsiteVerificationLocation {
  id: string;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country: string | null;
  is_primary: boolean;
}

export interface WebsiteVerificationBundle {
  company_id: string;
  legal_name: string;
  normalized_key: string | null;
  notes: string | null;
  shell_domain_key?: string | null;
  is_flux_domain_shell?: boolean;
  flux_seed_website?: string | null;
  contact_website?: string | null;
  locations: WebsiteVerificationLocation[];
  source_records: WebsiteVerificationSourceRecord[];
  registry_entities: WebsiteVerificationRegistryEntity[];
  owners: WebsiteVerificationOwner[];
}

export interface WebsiteVerificationExtractedPage {
  url: string;
  depth: number;
  final_url: string;
  page_kind?: WebsiteVerificationPageKind;
  title: string | null;
  meta_description: string | null;
  og_title: string | null;
  og_site_name: string | null;
  twitter_title: string | null;
  h1: string | null;
  visible_text: string;
  json_ld_types: string[];
  json_ld_names: string[];
  json_ld_legal_names: string[];
  json_ld_phones: string[];
  json_ld_emails: string[];
  json_ld_addresses: string[];
  same_as: string[];
  mailto_domains: string[];
  tel_numbers: string[];
  social_links: string[];
  map_links: string[];
  footer_text: string | null;
  footer_copyright_hit: boolean;
  parent_organization_names: string[];
  canonical_url: string | null;
  parse_ok: boolean;
  error?: string | null;
}

export interface WebsiteVerificationCrawlResult {
  input_url: string;
  final_url: string | null;
  normalized_domain_key: string | null;
  pages: WebsiteVerificationExtractedPage[];
  failed_urls: string[];
  pages_visited: number;
  max_depth_reached: number;
  parked: boolean;
}

export interface WebsiteVerificationScoredResult {
  score: number;
  band: WebsiteVerificationBand;
  signals: JsonObject;
  crawl_stats: JsonObject;
}

export interface WebsiteVerificationInsertRow {
  company_id: string;
  foundry_job_id?: string | null;
  source_ingestion_run_id?: string | null;
  input_url: string;
  final_url?: string | null;
  score?: number | null;
  band?: WebsiteVerificationBand | null;
  signals?: JsonObject;
  error?: string | null;
  verifier_version: string;
  crawl_stats?: JsonObject;
  verified_at?: string;
}

export { canonicalizeWebsiteUrl, preprocessWebsiteInputString } from './searchDomain.js';

export function normalizeComparableText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactComparableText(value: string | null | undefined): string {
  return normalizeComparableText(value).replace(/\s+/g, '');
}

function tokenize(value: string | null | undefined): string[] {
  const norm = normalizeComparableText(value);
  if (!norm) return [];
  return norm.split(/\s+/).filter((token) => token.length >= 2);
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D+/g, '');
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

const STATE_CODE_TO_NAME: Record<string, string> = {
  al: 'alabama',
  ak: 'alaska',
  az: 'arizona',
  ar: 'arkansas',
  ca: 'california',
  co: 'colorado',
  ct: 'connecticut',
  de: 'delaware',
  fl: 'florida',
  ga: 'georgia',
  hi: 'hawaii',
  id: 'idaho',
  il: 'illinois',
  in: 'indiana',
  ia: 'iowa',
  ks: 'kansas',
  ky: 'kentucky',
  la: 'louisiana',
  me: 'maine',
  md: 'maryland',
  ma: 'massachusetts',
  mi: 'michigan',
  mn: 'minnesota',
  ms: 'mississippi',
  mo: 'missouri',
  mt: 'montana',
  ne: 'nebraska',
  nv: 'nevada',
  nh: 'new hampshire',
  nj: 'new jersey',
  nm: 'new mexico',
  ny: 'new york',
  nc: 'north carolina',
  nd: 'north dakota',
  oh: 'ohio',
  ok: 'oklahoma',
  or: 'oregon',
  pa: 'pennsylvania',
  ri: 'rhode island',
  sc: 'south carolina',
  sd: 'south dakota',
  tn: 'tennessee',
  tx: 'texas',
  ut: 'utah',
  vt: 'vermont',
  va: 'virginia',
  wa: 'washington',
  wv: 'west virginia',
  wi: 'wisconsin',
  wy: 'wyoming',
  dc: 'district of columbia',
};
const STATE_ALIASES = Object.entries(STATE_CODE_TO_NAME).flatMap(([code, name]) => [
  { code, alias: code },
  { code, alias: name },
]);
const HOSTED_SITE_DOMAINS = ['google.com', 'sites.google.com', 'wixsite.com', 'weebly.com', 'squarespace.com', 'webflow.io'];
const SOCIAL_PROFILE_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
];

function hostMatchesAnyDomain(host: string | null | undefined, domains: string[]): boolean {
  const normalizedHost = host?.trim().toLowerCase() ?? '';
  if (!normalizedHost) return false;
  return domains.some((candidate) => normalizedHost === candidate || normalizedHost.endsWith(`.${candidate}`));
}

function pageKindWeight(page: WebsiteVerificationExtractedPage): number {
  switch (page.page_kind) {
    case 'home':
      return 1;
    case 'contact':
    case 'about':
    case 'services':
    case 'team':
    case 'locations':
      return 0.95;
    case 'listing':
      return 0.75;
    case 'project':
      return 0.65;
    case 'blog':
    case 'policy':
      return 0.3;
    default:
      return page.depth === 0 ? 0.9 : 0.6;
  }
}

function isHighSignalPage(page: WebsiteVerificationExtractedPage): boolean {
  return page.depth === 0 || ['home', 'contact', 'about', 'services', 'team', 'locations'].includes(page.page_kind ?? 'other');
}

function pageNameCandidates(page: WebsiteVerificationExtractedPage): string[] {
  return uniq(
    [
      page.og_site_name,
      ...page.json_ld_legal_names,
      ...page.json_ld_names,
      page.h1,
      page.title,
      page.og_title,
      page.twitter_title,
      page.footer_text,
    ].filter(Boolean) as string[],
  );
}

function pageLocationText(page: WebsiteVerificationExtractedPage): string {
  return normalizeComparableText(
    [page.footer_text, ...page.json_ld_addresses, ...page.map_links, page.h1, page.title].filter(Boolean).join(' '),
  );
}

function pagePhoneCandidates(page: WebsiteVerificationExtractedPage): string[] {
  return uniq(
    [...page.tel_numbers, ...page.json_ld_phones].map((value) => normalizePhoneDigits(value)).filter(Boolean) as string[],
  );
}

function domainBrandScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const candidates = uniq([
    crawl.normalized_domain_key,
    normalizeDomainKey(crawl.final_url ?? crawl.input_url),
    ...bundle.source_records.map((row) => normalizeDomainKey(row.website)).filter(Boolean),
  ]).filter(Boolean) as string[];
  if (candidates.length === 0) return 0;
  const expected = uniq([
    ...(bundle.normalized_key ? [bundle.normalized_key.replace(/_/g, ' ')] : []),
    ...nameCandidates(bundle),
  ]);
  let best = 0;
  for (const host of candidates) {
    const hostNorm = normalizeComparableText(host.replace(/\.[a-z]+$/i, '').replace(/\./g, ' '));
    const hostCompact = compactComparableText(host.replace(/\.[a-z]+$/i, '').replace(/\./g, ' '));
    if (!hostNorm) continue;
    for (const expectedName of expected) {
      const expectedNorm = normalizeComparableText(expectedName);
      const expectedCompact = compactComparableText(expectedName).replace(/(llc|inc|corp|co|company)$/g, '');
      if (!expectedNorm) continue;
      let score = tokenOverlapScore(expectedNorm, hostNorm);
      if (hostNorm.includes(expectedNorm) || expectedNorm.includes(hostNorm)) {
        score = Math.max(score, 0.9);
      }
      const normalizedNameKey = normalizeNameKey(expectedName);
      const normalizedHostKey = normalizeNameKey(host.replace(/\.[a-z]+$/i, '').replace(/\./g, ' '));
      if (normalizedNameKey && normalizedNameKey === normalizedHostKey) {
        score = Math.max(score, 1);
      }
      if (hostCompact && expectedCompact && (hostCompact.includes(expectedCompact) || expectedCompact.includes(hostCompact))) {
        score = Math.max(score, 0.95);
      }
      if (bundle.normalized_key && normalizeComparableText(bundle.normalized_key.replace(/_/g, ' ')) === hostNorm) {
        score = 1;
      }
      best = Math.max(best, score);
    }
  }
  return best;
}

function stateCodesForValue(value: string | null | undefined): string[] {
  const normalized = normalizeComparableText(value);
  if (!normalized) return [];
  const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
  return uniq(
    STATE_ALIASES.filter(({ code, alias }) => tokens.has(alias) || normalized.includes(alias)).map(({ code }) => code),
  );
}

function expectedStateCodes(bundle: WebsiteVerificationBundle): string[] {
  return uniq([
    ...bundle.locations.flatMap((loc) => stateCodesForValue(loc.state_region)),
    ...bundle.registry_entities.flatMap((entity) => stateCodesForValue(entity.registry_state)),
    ...bundle.source_records.flatMap((row) => stateCodesForValue(row.state_region)),
  ]);
}

function observedStateCounts(crawl: WebsiteVerificationCrawlResult): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of crawl.pages.filter(isHighSignalPage)) {
    for (const code of stateCodesForValue(pageLocationText(page))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

function geographicEvidence(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult) {
  const primary = [...bundle.locations].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0];
  const observedText = normalizeComparableText(
    crawl.pages
      .filter(isHighSignalPage)
      .flatMap((page) => [page.footer_text, ...page.json_ld_addresses, ...page.map_links, page.h1, page.title])
      .filter(Boolean)
      .join(' '),
  );
  const expectedStates = stateCodesForValue(primary?.state_region);
  const matchedStates = expectedStates.filter(
    (code) => observedText.includes(code) || observedText.includes(STATE_CODE_TO_NAME[code] ?? ''),
  );
  const city = normalizeComparableText(primary?.city);
  const postal = normalizeComparableText(primary?.postal_code);
  return {
    observed_text: observedText,
    expected_states: expectedStates,
    matched_states: matchedStates,
    matched_city: Boolean(city && observedText.includes(city)),
    matched_postal: Boolean(postal && observedText.includes(postal)),
    has_primary_location: Boolean(primary),
  };
}

function phoneMatch(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const expected = uniq(
    bundle.source_records
      .map((row) => normalizePhoneDigits(row.phone))
      .filter((value): value is string => Boolean(value)),
  );
  if (expected.length === 0) return 0;
  const actual = new Set(crawl.pages.flatMap((page) => pagePhoneCandidates(page)));
  return expected.some((value) => actual.has(value)) ? 1 : 0;
}

function locationTexts(bundle: WebsiteVerificationBundle): string[] {
  const locations = [...bundle.locations].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return locations.flatMap((loc) => [loc.line1, loc.city, loc.state_region, loc.postal_code]).filter(Boolean) as string[];
}

function nameCandidates(bundle: WebsiteVerificationBundle): string[] {
  return uniq(
    [
      bundle.legal_name,
      ...bundle.registry_entities.map((entity) => entity.legal_name).filter(Boolean),
      ...(bundle.normalized_key ? [bundle.normalized_key.replace(/_/g, ' ')] : []),
      ...(bundle.notes ? [bundle.notes] : []),
    ].filter(Boolean) as string[],
  );
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const denom = Math.max(leftSet.size, rightSet.size);
  return denom > 0 ? intersection / denom : 0;
}

function bestPageNameScore(bundle: WebsiteVerificationBundle, page: WebsiteVerificationExtractedPage): number {
  const expected = nameCandidates(bundle);
  const observed = pageNameCandidates(page);
  let best = 0;
  for (const left of expected) {
    const leftNorm = normalizeComparableText(left);
    if (!leftNorm) continue;
    for (const right of observed) {
      const rightNorm = normalizeComparableText(right);
      if (!rightNorm) continue;
      let score = tokenOverlapScore(leftNorm, rightNorm);
      if (rightNorm.includes(leftNorm) || leftNorm.includes(rightNorm)) {
        score = Math.max(score, 0.95);
      }
      if (normalizeNameKey(left) === normalizeNameKey(right)) {
        score = 1;
      }
      best = Math.max(best, score);
    }
  }
  return best;
}

function fuzzyNameScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  let best = 0;
  for (const page of crawl.pages) {
    const pageScore = bestPageNameScore(bundle, page);
    const weighted = pageScore * (0.7 + 0.3 * pageKindWeight(page));
    best = Math.max(best, weighted);
  }
  best = Math.max(best, domainBrandScore(bundle, crawl) * 0.9);
  return best;
}

function geographicScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const evidence = geographicEvidence(bundle, crawl);
  if (!evidence.has_primary_location || !evidence.observed_text) return 0;
  const checks = [
    evidence.expected_states.length > 0 ? (evidence.matched_states.length > 0 ? 1 : 0) : null,
    bundle.locations.some((loc) => Boolean(loc.city)) ? (evidence.matched_city ? 1 : 0) : null,
    bundle.locations.some((loc) => Boolean(loc.postal_code)) ? (evidence.matched_postal ? 1 : 0) : null,
  ].filter((value): value is number => value != null);
  if (checks.length === 0) return 0;
  return clamp(checks.reduce((sum, value) => sum + value, 0) / checks.length, 0, 1);
}

function ownerScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const owners = uniq(bundle.owners.map((owner) => owner.owner_name).filter(Boolean));
  if (owners.length === 0) return 0;
  const observedText = normalizeComparableText(
    crawl.pages.flatMap((page) => [page.visible_text, page.footer_text]).filter(Boolean).join(' '),
  );
  if (!observedText) return 0;
  const hits = owners.filter((owner) => {
    const target = normalizeComparableText(owner);
    return target.length >= 4 && observedText.includes(target);
  }).length;
  return clamp(hits / Math.max(1, Math.min(owners.length, 2)), 0, 1);
}

function sourcePriorScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const chosen = crawl.normalized_domain_key;
  if (!chosen) return 0;
  const candidates = bundle.source_records.filter((row) => normalizeDomainKey(row.website) === chosen);
  if (candidates.length === 0) return 0;
  const best = candidates.reduce((max, row) => Math.max(max, Number(row.link_score ?? 0)), 0);
  const linked = candidates.some((row) => row.link_status === 'linked');
  return clamp((linked ? 0.5 : 0.2) + clamp(best, 0, 1) * 0.5, 0, 1);
}

function crossSourceAgreementScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const chosen = crawl.normalized_domain_key;
  if (!chosen) return 0;
  const linked = bundle.source_records.filter((row) => row.link_status === 'linked');
  if (linked.length === 0) return 0;
  const matches = linked.filter((row) => normalizeDomainKey(row.website) === chosen).length;
  return matches >= 2 ? 1 : matches === 1 ? 0.5 : 0;
}

function identifierAlignmentScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const fromPayload = uniq(
    bundle.source_records.flatMap((row) => extractUrlsFromUnknown(row.raw_payload)).map(normalizeDomainKey).filter(Boolean) as string[],
  );
  if (fromPayload.length === 0) return 0;
  const fromPage = uniq(
    crawl.pages
      .flatMap((page) => [...page.same_as, ...page.social_links, ...page.map_links])
      .map(normalizeDomainKey)
      .filter(Boolean) as string[],
  );
  if (fromPage.length === 0) return 0;
  const hits = fromPayload.filter((host) => fromPage.includes(host)).length;
  return clamp(hits / Math.max(1, Math.min(fromPayload.length, 2)), 0, 1);
}

function sanityScore(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): number {
  const finalUrl = crawl.final_url ?? crawl.input_url;
  const https = finalUrl.startsWith('https://') ? 1 : 0.6;
  const hasContent = crawl.pages.some((page) => page.visible_text.trim().length >= 200) ? 1 : 0.3;
  const parentBrandMismatch = crawl.pages.some((page) =>
    page.parent_organization_names.some((name) => fuzzyNameScore(bundle, { ...crawl, pages: [{ ...page }] }) < 0.2),
  );
  return clamp((https + hasContent + (parentBrandMismatch ? 0 : 1)) / 3, 0, 1);
}

function detectStrongNameMismatch(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult, nameScore: number): boolean {
  if (nameScore >= 0.72 || domainBrandScore(bundle, crawl) >= 0.8) return false;
  const strongPages = crawl.pages.filter(isHighSignalPage);
  if (strongPages.length === 0) return false;
  const mismatches = strongPages.filter((page) => bestPageNameScore(bundle, page) < 0.2).length;
  return mismatches >= Math.max(1, Math.ceil(strongPages.length * 0.7));
}

function detectStrongGeoMismatch(bundle: WebsiteVerificationBundle, crawl: WebsiteVerificationCrawlResult): boolean {
  const expectedStates = expectedStateCodes(bundle);
  if (expectedStates.length === 0) return false;
  const observed = observedStateCounts(crawl);
  if (observed.size === 0) return false;
  if (expectedStates.some((code) => observed.has(code))) return false;
  return Math.max(...observed.values()) >= 2;
}

function isHostedSite(crawl: WebsiteVerificationCrawlResult): boolean {
  const host = crawl.normalized_domain_key ?? normalizeDomainKey(crawl.final_url ?? crawl.input_url) ?? '';
  return hostMatchesAnyDomain(host, HOSTED_SITE_DOMAINS);
}

function isSocialProfileSite(crawl: WebsiteVerificationCrawlResult): boolean {
  const host = crawl.normalized_domain_key ?? normalizeDomainKey(crawl.final_url ?? crawl.input_url) ?? '';
  return hostMatchesAnyDomain(host, SOCIAL_PROFILE_DOMAINS);
}

function isDisallowedWebsiteTargetHost(host: string | null | undefined): boolean {
  return hostMatchesAnyDomain(host, SOCIAL_PROFILE_DOMAINS);
}

function hasStrongIdentitySignal(name: number, phone: number, geo: number, identifiers: number): boolean {
  return name >= 0.72 || phone > 0 || geo >= 0.55 || identifiers >= 0.5;
}

function hasBrandConfidentSignal(
  name: number,
  domainBrand: number,
  sourcePrior: number,
  sanity: number,
  contradictions: {
    strong_name_mismatch: boolean;
    strong_geo_mismatch: boolean;
    hosted_site: boolean;
    social_profile: boolean;
  },
): boolean {
  return (
    name >= 0.9 &&
    domainBrand >= 0.8 &&
    sourcePrior >= 0.5 &&
    sanity >= 0.65 &&
    !contradictions.strong_name_mismatch &&
    !contradictions.strong_geo_mismatch &&
    !contradictions.hosted_site &&
    !contradictions.social_profile
  );
}

export function scoreWebsiteVerification(
  bundle: WebsiteVerificationBundle,
  crawl: WebsiteVerificationCrawlResult,
): WebsiteVerificationScoredResult {
  const name = fuzzyNameScore(bundle, crawl);
  const geoEvidence = geographicEvidence(bundle, crawl);
  const geo = geographicScore(bundle, crawl);
  const phone = phoneMatch(bundle, crawl);
  const owners = ownerScore(bundle, crawl);
  const sourcePrior = sourcePriorScore(bundle, crawl);
  const crossSource = crossSourceAgreementScore(bundle, crawl);
  const identifiers = identifierAlignmentScore(bundle, crawl);
  const sanity = sanityScore(bundle, crawl);
  const domainBrand = domainBrandScore(bundle, crawl);
  const namePoints = Math.round(name * WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.legal_brand_match);
  const geoPoints = Math.round(geo * WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.geography);
  const phonePoints = phone > 0 ? WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.phone : 0;
  const ownerPoints = Math.round(owners * WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.registry_owner);
  const sourcePoints = Math.round(sourcePrior * WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.source_link_prior);
  const sanityPoints = Math.round(sanity * WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.domain_page_sanity);
  const crossSourcePoints = Math.round(
    crossSource * WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.cross_source_domain_agreement,
  );
  const identifierBonus = Math.round(
    identifiers * WEBSITE_VERIFICATION_DIMENSION_WEIGHTS.identifier_alignment_bonus,
  );
  const parked = crawl.parked;
  const nameMismatch = detectStrongNameMismatch(bundle, crawl, name);
  const geoMismatch = detectStrongGeoMismatch(bundle, crawl);
  let score = namePoints + geoPoints + phonePoints + ownerPoints + sourcePoints + sanityPoints + crossSourcePoints;
  score += identifierBonus;
  const contradictions = {
    strong_name_mismatch: nameMismatch,
    strong_geo_mismatch: geoMismatch,
    parked_like: parked,
    hosted_site: isHostedSite(crawl),
    social_profile: isSocialProfileSite(crawl),
  };
  const brandConfident = hasBrandConfidentSignal(name, domainBrand, sourcePrior, sanity, contradictions);
  if (contradictions.strong_name_mismatch) score -= 16;
  if (contradictions.strong_geo_mismatch) score -= 12;
  if (contradictions.hosted_site && !hasStrongIdentitySignal(name, phone, geo, identifiers)) score -= 6;
  if (contradictions.social_profile) score -= 25;
  if (contradictions.parked_like && !hasStrongIdentitySignal(name, phone, geo, identifiers)) score -= 18;
  if (brandConfident) score += 10;
  score = clamp(score, 0, 100);

  const hardStops = {
    fetch_failed: crawl.pages.length === 0 || Boolean(crawl.failed_urls.length && crawl.pages_visited === 0),
    social_profile: contradictions.social_profile,
    parked_domain:
      contradictions.parked_like &&
      !hasStrongIdentitySignal(name, phone, geo, identifiers) &&
      domainBrand < 0.45 &&
      sourcePrior < 0.5,
  };
  const vetoes = {
    ...hardStops,
    strong_name_mismatch: contradictions.strong_name_mismatch,
    strong_geo_mismatch: contradictions.strong_geo_mismatch,
  };

  let band: WebsiteVerificationBand;
  if (hardStops.fetch_failed || hardStops.social_profile || hardStops.parked_domain) {
    band = 'not_usable';
    score = Math.min(score, 40);
  } else if (brandConfident) {
    band = 'usable';
    score = Math.max(score, WEBSITE_VERIFICATION_SCORE_THRESHOLDS.usable);
  } else if (score >= WEBSITE_VERIFICATION_SCORE_THRESHOLDS.usable) {
    band = 'usable';
  } else if (score >= WEBSITE_VERIFICATION_SCORE_THRESHOLDS.uncertain) {
    band = 'uncertain';
  } else {
    band = 'not_usable';
  }

  return {
    score,
    band,
    signals: {
      dimensions: {
        legal_brand_match: namePoints,
        geography: geoPoints,
        phone: phonePoints,
        registry_owner: ownerPoints,
        source_link_prior: sourcePoints,
        domain_page_sanity: sanityPoints,
        cross_source_domain_agreement: crossSourcePoints,
        identifier_alignment_bonus: identifierBonus,
      },
      contradictions,
      vetoes,
      brand_confident: brandConfident,
      pages: crawl.pages.map((page) => ({
        url: page.url,
        depth: page.depth,
        page_kind: page.page_kind ?? 'other',
        title_snippet: page.title?.slice(0, 120) ?? null,
        parse_ok: page.parse_ok,
        json_ld_types: page.json_ld_types,
        sameAs_count: page.same_as.length,
        mailto_domain_matches_seed:
          crawl.normalized_domain_key != null
            ? page.mailto_domains.some((domain) => domain === crawl.normalized_domain_key)
            : null,
        footer_copyright_hit: page.footer_copyright_hit,
      })),
      chosen_domain: crawl.normalized_domain_key,
      domain_brand_score: domainBrand,
      geographic_evidence: geoEvidence,
      expected_name_candidates: nameCandidates(bundle),
      owner_name_count: bundle.owners.length,
    },
    crawl_stats: {
      pages_visited: crawl.pages_visited,
      max_depth_reached: crawl.max_depth_reached,
      failed_urls: crawl.failed_urls,
    },
  };
}

export function countWebsiteVerificationBands(
  rows: Array<{ band: string | null; error?: string | null }>,
): Record<WebsiteVerificationBand | 'error' | 'skipped', number> {
  const counts: Record<WebsiteVerificationBand | 'error' | 'skipped', number> = {
    usable: 0,
    uncertain: 0,
    not_usable: 0,
    error: 0,
    skipped: 0,
  };
  for (const row of rows) {
    if (row.error) {
      counts.error += 1;
      continue;
    }
    if (row.band === 'usable' || row.band === 'uncertain' || row.band === 'not_usable') {
      counts[row.band] += 1;
      continue;
    }
    counts.skipped += 1;
  }
  return counts;
}

export function pickWebsiteVerificationTarget(bundle: WebsiteVerificationBundle): string | null {
  if (bundle.is_flux_domain_shell) {
    const seeded = canonicalizeWebsiteUrl(bundle.flux_seed_website);
    const seededDomain = normalizeDomainKey(seeded);
    if (seeded && !isDisallowedWebsiteTargetHost(seededDomain)) {
      return seeded;
    }
  }
  const scored = bundle.source_records
    .map((row) => {
      const normalizedUrl = canonicalizeWebsiteUrl(row.website);
      if (!normalizedUrl) return null;
      const domain = normalizeDomainKey(normalizedUrl);
      if (isDisallowedWebsiteTargetHost(domain)) return null;
      return {
        url: normalizedUrl,
        domain,
        points: (row.link_status === 'linked' ? 10 : 0) + clamp(Number(row.link_score ?? 0), 0, 1) * 5,
      };
    })
    .filter(Boolean) as Array<{ url: string; domain: string | null; points: number }>;
  if (scored.length > 0) {
    scored.sort((a, b) => b.points - a.points || a.url.localeCompare(b.url));
    const best = scored[0]?.url ?? null;
    if (best) return best;
  }
  const projectionUrl = canonicalizeWebsiteUrl(bundle.contact_website);
  const projectionDomain = normalizeDomainKey(projectionUrl);
  if (projectionUrl && !isDisallowedWebsiteTargetHost(projectionDomain)) {
    return projectionUrl;
  }
  return null;
}

export async function loadWebsiteVerificationBundles(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<WebsiteVerificationBundle[]> {
  const uniqueIds = [...new Set(companyIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const [companyRows, locationRows, linkRows, matchRows] = await Promise.all([
    selectByIdBatches(leadsClient, 'website verification companies', uniqueIds, async (batch) => {
      const { data, error } = await leadsClient
        .from('companies')
        .select('id, legal_name, normalized_key, notes, shell_domain_key, is_flux_domain_shell')
        .in('id', batch);
      return { data: data as unknown[] | null, error };
    }),
    selectByIdBatches(leadsClient, 'website verification company_locations', uniqueIds, async (batch) => {
      const { data, error } = await leadsClient
        .from('company_locations')
        .select('id, company_id, line1, line2, city, state_region, postal_code, country, is_primary')
        .in('company_id', batch);
      return { data: data as unknown[] | null, error };
    }),
    selectByIdBatches(leadsClient, 'website verification source_business_company_links', uniqueIds, async (batch) => {
      const { data, error } = await leadsClient
        .from('source_business_company_links')
        .select('company_id, source_business_record_id, link_status, link_score, is_current')
        .in('company_id', batch)
        .eq('is_current', true);
      return { data: data as unknown[] | null, error };
    }),
    selectByIdBatches(leadsClient, 'website verification company_entity_matches', uniqueIds, async (batch) => {
      const { data, error } = await leadsClient
        .from('company_entity_matches')
        .select('company_id, state_entity_id, registry_state, is_current')
        .in('company_id', batch)
        .eq('is_current', true);
      return { data: data as unknown[] | null, error };
    }),
  ]);
  const sourceRecordIds = uniq(linkRows.map((row) => String(row.source_business_record_id)));
  const entityIds = uniq(matchRows.map((row) => String(row.state_entity_id)));

  // Omit resolution_meta: older leads DBs without that migration return PostgREST 400; verification uses raw_payload for extra URLs.
  const sourceSelect =
    'id, website, phone, address_raw, line1, city, state_region, postal_code, categories, raw_payload';

  const [sourceRowsList, entityRowsList, ownerRowsList, sourceSeedRows, contactProjectionRows] = await Promise.all([
    selectByIdBatches(leadsClient, 'website verification source_business_records', sourceRecordIds, async (batch) => {
      const { data, error } = await leadsClient.from('source_business_records').select(sourceSelect).in('id', batch);
      return { data: data as unknown[] | null, error };
    }),
    selectByIdBatches(leadsClient, 'website verification state_entities', entityIds, async (batch) => {
      const { data, error } = await leadsClient.from('state_entities').select('id, legal_name, raw_parsed').in('id', batch);
      return { data: data as unknown[] | null, error };
    }),
    selectByIdBatches(leadsClient, 'website verification entity_owners', entityIds, async (batch) => {
      const { data, error } = await leadsClient
        .from('entity_owners')
        .select('id, state_entity_id, owner_name, title_role, is_current')
        .in('state_entity_id', batch)
        .eq('is_current', true);
      return { data: data as unknown[] | null, error };
    }),
    selectByIdBatches(leadsClient, 'website verification flux_company_website_sources', uniqueIds, async (batch) => {
      const { data, error } = await leadsClient
        .from('flux_company_website_sources')
        .select('company_id, input_url, normalized_domain_key')
        .in('company_id', batch);
      return { data: data as unknown[] | null, error };
    }),
    selectByIdBatches(leadsClient, 'website verification company_contact_projection', uniqueIds, async (batch) => {
      const { data, error } = await leadsClient
        .from('company_contact_projection')
        .select('company_id, website')
        .in('company_id', batch);
      return { data: data as unknown[] | null, error };
    }),
  ]);

  const sourceById = new Map<string, Record<string, unknown>>(
    sourceRowsList.map((row) => [String(row.id), row as Record<string, unknown>]),
  );
  const entitiesById = new Map<string, Record<string, unknown>>(
    entityRowsList.map((row) => [String(row.id), row as Record<string, unknown>]),
  );
  const fluxSeedByCompanyId = new Map<string, string | null>(
    sourceSeedRows.map((row) => [String(row.company_id), row.input_url == null ? null : String(row.input_url)]),
  );
  const contactWebsiteByCompanyId = new Map<string, string | null>(
    contactProjectionRows.map((row) => [String(row.company_id), row.website == null ? null : String(row.website)]),
  );
  const ownersByEntityId = new Map<string, WebsiteVerificationOwner[]>();
  for (const row of ownerRowsList) {
    const stateEntityId = String(row.state_entity_id);
    const bucket = ownersByEntityId.get(stateEntityId) ?? [];
    bucket.push({
      id: String(row.id),
      state_entity_id: stateEntityId,
      owner_name: String(row.owner_name ?? ''),
      title_role: row.title_role == null ? null : String(row.title_role),
    });
    ownersByEntityId.set(stateEntityId, bucket);
  }

  return uniqueIds.map((companyId) => {
    const company = companyRows.find((row) => String(row.id) === companyId) as Record<string, unknown> | undefined;
    const companyMatchRows = matchRows.filter((row) => String(row.company_id) === companyId);
    const entityRows = companyMatchRows.map((row) => {
      const entity = entitiesById.get(String(row.state_entity_id)) ?? {};
      return {
        id: String(row.state_entity_id),
        registry_state: String(row.registry_state ?? ''),
        legal_name: entity.legal_name == null ? null : String(entity.legal_name),
        raw_parsed: entity.raw_parsed && typeof entity.raw_parsed === 'object' ? (entity.raw_parsed as JsonObject) : {},
      };
    });
    const owners = entityRows.flatMap((entity) => ownersByEntityId.get(entity.id) ?? []);
    const source_records = linkRows
      .filter((row) => String(row.company_id) === companyId)
      .map((row) => {
        const source = sourceById.get(String(row.source_business_record_id)) ?? {};
        return {
          source_business_record_id: String(row.source_business_record_id),
          link_status: String(row.link_status ?? ''),
          link_score: row.link_score == null ? null : Number(row.link_score),
          website: source.website == null ? null : String(source.website),
          phone: source.phone == null ? null : String(source.phone),
          address_raw: source.address_raw == null ? null : String(source.address_raw),
          line1: source.line1 == null ? null : String(source.line1),
          city: source.city == null ? null : String(source.city),
          state_region: source.state_region == null ? null : String(source.state_region),
          postal_code: source.postal_code == null ? null : String(source.postal_code),
          categories: Array.isArray(source.categories) ? source.categories : [],
          raw_payload: source.raw_payload && typeof source.raw_payload === 'object' ? (source.raw_payload as JsonObject) : {},
          resolution_meta:
            source.resolution_meta && typeof source.resolution_meta === 'object'
              ? (source.resolution_meta as JsonObject)
              : {},
        };
      });
    return {
      company_id: companyId,
      legal_name: String(company?.legal_name ?? ''),
      normalized_key: company?.normalized_key == null ? null : String(company.normalized_key),
      notes: company?.notes == null ? null : String(company.notes),
      shell_domain_key: company?.shell_domain_key == null ? null : String(company.shell_domain_key),
      is_flux_domain_shell: Boolean(company?.is_flux_domain_shell),
      flux_seed_website: fluxSeedByCompanyId.get(companyId) ?? null,
      contact_website: contactWebsiteByCompanyId.get(companyId) ?? null,
      locations: locationRows
        .filter((row) => String(row.company_id) === companyId)
        .map((row) => ({
          id: String(row.id),
          line1: row.line1 == null ? null : String(row.line1),
          line2: row.line2 == null ? null : String(row.line2),
          city: row.city == null ? null : String(row.city),
          state_region: row.state_region == null ? null : String(row.state_region),
          postal_code: row.postal_code == null ? null : String(row.postal_code),
          country: row.country == null ? null : String(row.country),
          is_primary: Boolean(row.is_primary),
        })),
      source_records,
      registry_entities: entityRows,
      owners,
    };
  });
}

function extractUrlsFromUnknown(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) out.push(trimmed);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractUrlsFromUnknown(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) extractUrlsFromUnknown(nested, out);
  }
  return out;
}
