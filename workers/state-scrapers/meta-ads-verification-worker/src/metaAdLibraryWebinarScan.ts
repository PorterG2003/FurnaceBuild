import {
  cardDomainMatch,
  toMatchedAdPayload,
  type MetaAdLibraryMatchedAd,
  type MetaAdLibraryPageSnapshot,
  type MetaAdLibraryResultCard,
} from './metaAdLibraryParse.js';

import type { ScrollPaginationStats } from './metaAdLibraryPagination.js';

export const META_ADS_WEBINAR_SCAN_DAYS_DEFAULT = 30;
export const META_ADS_MAX_SCROLL_ATTEMPTS = 15;
export const META_ADS_MAX_SCANNED_CARDS = 100;

const WEBINAR_URL_RE = /\/(webinars?|masterclass|virtual-event|live-event|online-workshop)(\/|$|\?)/i;
const WEBINAR_COPY_PATTERNS: Array<{ id: string; re: RegExp; weight: number }> = [
  { id: 'copy_webinar', re: /\bwebinar\b/i, weight: 0.35 },
  { id: 'copy_free_webinar', re: /\bfree webinar\b/i, weight: 0.45 },
  { id: 'copy_register_for', re: /\bregister for\b.*\bwebinar\b/i, weight: 0.5 },
  { id: 'copy_save_your_seat', re: /\bsave your seat\b/i, weight: 0.4 },
  { id: 'copy_rsvp', re: /\brsvp\b.*\bwebinar\b/i, weight: 0.4 },
  { id: 'copy_join_us_live', re: /\bjoin us\b.*\b(live|webinar)\b/i, weight: 0.4 },
  { id: 'copy_online_workshop', re: /\bonline workshop\b/i, weight: 0.35 },
  { id: 'copy_masterclass', re: /\bmasterclass\b/i, weight: 0.35 },
];
const WEBINAR_PAGE_NAME_RE = /\bwebinar/i;
const WEBINAR_CTA_RE = /^(sign up|register|register free)$/i;

export interface MetaAdLibraryWebinarAd extends MetaAdLibraryMatchedAd {
  webinar_score: number;
  webinar_signals: string[];
}

export interface MetaAdLibraryWebinarScanResult {
  enabled: true;
  days: number;
  scanned_card_count: number;
  recent_ad_count: number;
  webinar_ad_count: number;
  webinar_ads: MetaAdLibraryWebinarAd[];
  pagination: ScrollPaginationStats;
}

export function parseStartedRunningDate(text: string | null | undefined): Date | null {
  if (!text?.trim()) return null;
  const parsed = Date.parse(text.trim());
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

export function isAdWithinDays(
  card: MetaAdLibraryResultCard,
  days: number,
  now: Date = new Date(),
): boolean {
  const started = parseStartedRunningDate(card.started_running);
  if (!started) return false;
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const startedDay = new Date(started);
  startedDay.setHours(0, 0, 0, 0);
  return startedDay >= cutoff;
}

function adTextBlob(ad: MetaAdLibraryMatchedAd | MetaAdLibraryResultCard): string {
  const linkUrls = 'link_urls' in ad && Array.isArray(ad.link_urls) ? ad.link_urls : [];
  return [ad.page_name, ad.primary_text, ad.headline, ad.landing_url, ad.cta, ...linkUrls]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function urlsForWebinarScoring(ad: MetaAdLibraryMatchedAd | MetaAdLibraryResultCard): string[] {
  const linkUrls = 'link_urls' in ad && Array.isArray(ad.link_urls) ? ad.link_urls : [];
  const landing = ad.landing_url ?? '';
  return [...new Set([landing, ...linkUrls].filter(Boolean))];
}

export function scoreWebinarAd(ad: MetaAdLibraryMatchedAd | MetaAdLibraryResultCard): {
  score: number;
  signals: string[];
} {
  const signals: string[] = [];
  let score = 0;
  const blob = adTextBlob(ad);

  for (const url of urlsForWebinarScoring(ad)) {
    if (WEBINAR_URL_RE.test(url)) {
      signals.push('url_webinar_path');
      score += 0.6;
      break;
    }
  }

  for (const pattern of WEBINAR_COPY_PATTERNS) {
    if (pattern.re.test(blob)) {
      signals.push(pattern.id);
      score += pattern.weight;
    }
  }

  if (ad.page_name && WEBINAR_PAGE_NAME_RE.test(ad.page_name)) {
    signals.push('page_name_webinar');
    score += 0.25;
  }

  if (ad.cta && WEBINAR_CTA_RE.test(ad.cta) && /\bwebinar\b/i.test(blob)) {
    signals.push('cta_register_webinar');
    score += 0.15;
  }

  return { score: Math.min(score, 1), signals };
}

export function isWebinarAd(ad: MetaAdLibraryMatchedAd | MetaAdLibraryResultCard): boolean {
  const { score, signals } = scoreWebinarAd(ad);
  if (signals.includes('url_webinar_path')) return true;
  return score >= 0.5;
}

export function filterRecentDomainMatchedAds(
  cards: MetaAdLibraryResultCard[],
  searchDomain: string,
  days: number,
  now?: Date,
): MetaAdLibraryResultCard[] {
  return cards.filter((card) => cardDomainMatch(card, searchDomain) && isAdWithinDays(card, days, now));
}

export function findWebinarAds(
  cards: MetaAdLibraryResultCard[],
  searchDomain: string,
  days: number,
  now?: Date,
): MetaAdLibraryWebinarAd[] {
  const recent = filterRecentDomainMatchedAds(cards, searchDomain, days, now);
  const webinarAds: MetaAdLibraryWebinarAd[] = [];
  for (const card of recent) {
    const payload = toMatchedAdPayload(card);
    const { score, signals } = scoreWebinarAd(payload);
    if (!isWebinarAd(payload)) continue;
    webinarAds.push({
      ...payload,
      webinar_score: score,
      webinar_signals: signals,
    });
  }
  return webinarAds;
}

export function buildWebinarScanSignals(
  snapshot: MetaAdLibraryPageSnapshot,
  searchDomain: string,
  days: number = META_ADS_WEBINAR_SCAN_DAYS_DEFAULT,
  now?: Date,
  pagination?: ScrollPaginationStats,
): MetaAdLibraryWebinarScanResult {
  const recent = filterRecentDomainMatchedAds(snapshot.cards, searchDomain, days, now);
  const webinarAds = findWebinarAds(snapshot.cards, searchDomain, days, now);
  const initialCount = pagination?.initial_card_count ?? snapshot.cards.length;
  return {
    enabled: true,
    days,
    scanned_card_count: snapshot.cards.length,
    recent_ad_count: recent.length,
    webinar_ad_count: webinarAds.length,
    webinar_ads: webinarAds,
    pagination: pagination ?? {
      initial_card_count: initialCount,
      scanned_card_count: snapshot.cards.length,
      scroll_attempts: 0,
      cards_added_by_scroll: 0,
      scroll_helped: false,
      stopped_reason: 'not_needed',
    },
  };
}

export function dedupeCardsByLibraryId(cards: MetaAdLibraryResultCard[]): MetaAdLibraryResultCard[] {
  const seen = new Set<string>();
  const out: MetaAdLibraryResultCard[] = [];
  for (const card of cards) {
    const key = card.page_id ?? `${card.page_name ?? ''}|${card.landing_url ?? ''}|${card.primary_text ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

export function oldestDatedCardIsBeforeDays(
  cards: MetaAdLibraryResultCard[],
  days: number,
  now: Date = new Date(),
): boolean {
  const dates = cards
    .map((card) => parseStartedRunningDate(card.started_running))
    .filter((date): date is Date => date !== null);
  if (dates.length === 0) return false;
  const oldest = dates.reduce((min, date) => (date < min ? date : min), dates[0]);
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const oldestDay = new Date(oldest);
  oldestDay.setHours(0, 0, 0, 0);
  return oldestDay < cutoff;
}
