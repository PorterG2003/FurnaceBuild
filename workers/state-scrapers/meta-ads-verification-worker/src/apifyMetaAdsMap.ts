import {
  buildMetaAdLibrarySearchUrl,
  pickSearchTypeForTerm,
  type MetaAdLibrarySearchType,
} from './metaAdLibraryUrl.js';
import {
  classifyMetaAdResults,
  pickMatchedAdsForSignals,
  shouldTryCompanyNameFallback,
  type MetaAdLibraryMatchedAd,
  type MetaAdLibraryPageSnapshot,
  type MetaAdLibraryResultCard,
  type MetaAdsVerificationResult,
} from './metaAdLibraryParse.js';
import {
  buildWebinarScanSignals,
  filterRecentDomainMatchedAds,
  META_ADS_WEBINAR_SCAN_DAYS_DEFAULT,
} from './metaAdLibraryWebinarScan.js';
import type { ApifySearchTarget } from './apifyMetaAdsClient.js';

export interface ApifyMetaAdRecord {
  adArchiveID?: string | null;
  sourceUrl?: string | null;
  pageID?: string | null;
  pageName?: string | null;
  pageURL?: string | null;
  adText?: string | null;
  adCreativeBodies?: string[] | null;
  publisherPlatforms?: string[] | null;
  adStatus?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  adCreationTime?: string | null;
  ctaDomain?: string | null;
  ctaHeadline?: string | null;
  ctaDescription?: string | null;
  adSnapshotUrl?: string | null;
  [key: string]: unknown;
}

export interface ApifySearchAttempt {
  search_term: string;
  search_type: MetaAdLibrarySearchType;
  search_url: string;
  result: MetaAdsVerificationResult;
  matched_via: string | null;
  reason: string | null;
  result_card_count: number;
  apify_total_count: number;
}

export interface ApifyCompanyLookupResult {
  result: MetaAdsVerificationResult;
  matched_page_name: string | null;
  matched_via: string | null;
  matched_ad_count: number;
  matched_ads: MetaAdLibraryMatchedAd[];
  top_ad: MetaAdLibraryMatchedAd | null;
  search_attempts: ApifySearchAttempt[];
  webinar_scan: ReturnType<typeof buildWebinarScanSignals>;
  apify_total_count: number;
  classification_reason: string | null;
}

function formatStartedRunning(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value.trim();
  return new Date(parsed).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function landingUrlFromRecord(record: ApifyMetaAdRecord): string | null {
  const domain = record.ctaDomain?.trim();
  if (!domain) return null;
  if (/^https?:\/\//i.test(domain)) return domain;
  return `https://${domain.replace(/^\/+/, '')}`;
}

function linkUrlsFromRecord(record: ApifyMetaAdRecord): string[] {
  const urls = new Set<string>();
  const landing = landingUrlFromRecord(record);
  if (landing) urls.add(landing);
  for (const body of record.adCreativeBodies ?? []) {
    if (!body) continue;
    const matches = body.match(/https?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi) ?? [];
    for (const match of matches) urls.add(match);
  }
  if (record.adText) {
    const matches = record.adText.match(/https?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi) ?? [];
    for (const match of matches) urls.add(match);
  }
  return [...urls];
}

export function mapApifyAdToCard(record: ApifyMetaAdRecord): MetaAdLibraryResultCard {
  const primaryText = record.adText?.trim() || record.adCreativeBodies?.[0]?.trim() || null;
  const landingUrl = landingUrlFromRecord(record);
  const linkUrls = linkUrlsFromRecord(record);
  return {
    page_name: record.pageName?.trim() || null,
    page_id: record.adArchiveID?.trim() || record.pageID?.trim() || null,
    page_url: record.pageURL?.trim() || null,
    link_urls: linkUrls,
    body_text: [primaryText, record.ctaHeadline, record.ctaDescription, ...linkUrls].filter(Boolean).join(' '),
    primary_text: primaryText,
    headline: record.ctaHeadline?.trim() || null,
    landing_url: landingUrl,
    cta: record.ctaDescription?.trim() || null,
    started_running: formatStartedRunning(record.startDate ?? record.adCreationTime),
  };
}

export function buildSnapshotFromApifyAds(
  ads: ApifyMetaAdRecord[],
  totalCount: number,
): MetaAdLibraryPageSnapshot {
  const cards = ads.map((record) => mapApifyAdToCard(record));
  return {
    page_title: null,
    body_text: cards.map((card) => card.body_text ?? '').join('\n'),
    hrefs: cards.flatMap((card) => card.link_urls),
    cards,
    blocker: null,
    no_results: totalCount === 0 && cards.length === 0,
  };
}

export function buildSearchTarget(
  domain: string,
  searchTerm: string,
  searchKind: 'domain' | 'name',
): ApifySearchTarget {
  const searchType = pickSearchTypeForTerm(searchTerm);
  const url = buildMetaAdLibrarySearchUrl({
    q: searchTerm,
    country: 'US',
    activeStatus: 'active',
    searchType,
  });
  return { url, domain, searchTerm, searchKind };
}

function classifyAttempt(
  searchDomain: string,
  companyName: string | null,
  searchTerm: string,
  searchType: MetaAdLibrarySearchType,
  searchUrl: string,
  ads: ApifyMetaAdRecord[],
  totalCount: number,
): {
  attempt: ApifySearchAttempt;
  classification: ReturnType<typeof classifyMetaAdResults>;
  snapshot: MetaAdLibraryPageSnapshot;
} {
  const snapshot = buildSnapshotFromApifyAds(ads, totalCount);
  const classification = classifyMetaAdResults({
    searchDomain,
    companyName,
    snapshot,
  });
  return {
    attempt: {
      search_term: searchTerm,
      search_type: searchType,
      search_url: searchUrl,
      result: classification.result,
      matched_via: classification.matched_via,
      reason: classification.reason,
      result_card_count: snapshot.cards.length,
      apify_total_count: totalCount,
    },
    classification,
    snapshot,
  };
}

export function resolveApifyCompanyLookup(options: {
  searchDomain: string;
  companyName?: string | null;
  domainAds: ApifyMetaAdRecord[];
  domainTotalCount: number;
  nameAds?: ApifyMetaAdRecord[];
  nameTotalCount?: number;
  webinarScanDays?: number;
}): ApifyCompanyLookupResult {
  const companyName = options.companyName?.trim() || null;
  const domainTarget = buildSearchTarget(options.searchDomain, options.searchDomain, 'domain');
  const domainAttempt = classifyAttempt(
    options.searchDomain,
    companyName,
    domainTarget.searchTerm,
    pickSearchTypeForTerm(domainTarget.searchTerm),
    domainTarget.url,
    options.domainAds,
    options.domainTotalCount,
  );

  const attempts: ApifySearchAttempt[] = [domainAttempt.attempt];
  let finalClassification = domainAttempt.classification;
  let finalSnapshot = domainAttempt.snapshot;
  let finalTotalCount = options.domainTotalCount;

  if (
    shouldTryCompanyNameFallback(domainAttempt.classification, companyName) &&
    companyName &&
    options.nameAds &&
    options.nameTotalCount != null
  ) {
    const nameTarget = buildSearchTarget(options.searchDomain, companyName, 'name');
    const nameAttempt = classifyAttempt(
      options.searchDomain,
      companyName,
      nameTarget.searchTerm,
      pickSearchTypeForTerm(nameTarget.searchTerm),
      nameTarget.url,
      options.nameAds,
      options.nameTotalCount,
    );
    attempts.push(nameAttempt.attempt);
    if (nameAttempt.classification.result === 'yes' || domainAttempt.classification.result !== 'yes') {
      finalClassification = nameAttempt.classification;
      finalSnapshot = nameAttempt.snapshot;
      finalTotalCount = options.nameTotalCount;
    }
  }

  const matchedAds = pickMatchedAdsForSignals(
    finalSnapshot,
    options.searchDomain,
    finalClassification,
    companyName,
  );
  const webinarScan = buildWebinarScanSignals(
    finalSnapshot,
    options.searchDomain,
    options.webinarScanDays ?? META_ADS_WEBINAR_SCAN_DAYS_DEFAULT,
  );
  const recentAds = filterRecentDomainMatchedAds(
    finalSnapshot.cards,
    options.searchDomain,
    options.webinarScanDays ?? META_ADS_WEBINAR_SCAN_DAYS_DEFAULT,
  );

  return {
    result: finalClassification.result,
    matched_page_name: finalClassification.matched_card?.page_name ?? matchedAds[0]?.page_name ?? null,
    matched_via: finalClassification.matched_via,
    matched_ad_count: matchedAds.length,
    matched_ads: matchedAds,
    top_ad: matchedAds[0] ?? null,
    search_attempts: attempts,
    webinar_scan: webinarScan,
    apify_total_count: finalTotalCount,
    classification_reason: finalClassification.reason,
  };
}

export function mapApifyRecords(items: Record<string, unknown>[]): ApifyMetaAdRecord[] {
  return items.filter((item) => {
    const keys = Object.keys(item);
    return keys.some((key) =>
      ['adArchiveID', 'adText', 'pageName', 'ctaDomain', 'sourceUrl'].includes(key),
    );
  }) as ApifyMetaAdRecord[];
}

export function filterAdsForSourceUrl(
  ads: ApifyMetaAdRecord[],
  sourceUrl: string,
): ApifyMetaAdRecord[] {
  const normalized = sourceUrl.replace(/&amp;/g, '&');
  const filtered = ads.filter((ad) => {
    const adSource = (ad.sourceUrl ?? '').replace(/&amp;/g, '&');
    return adSource === normalized || adSource.includes(normalized) || normalized.includes(adSource);
  });
  return filtered.length > 0 ? filtered : ads;
}
