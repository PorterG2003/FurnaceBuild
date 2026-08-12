import type { AdQuery, RawAd } from './types.js';

export type CardSnapshot = {
  text: string;
  links: Array<{ href: string; text: string }>;
  creativeImageUrls?: string[];
  attributes?: Record<string, string | null>;
};

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const DATE_RE = /\b(?:started|active|running)(?:\s+on|\s+from)?\s*:?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i;
const AD_ID_RE = /(?:ad|creative|sponsored)[\s_-]*(?:id)?\s*[:#]?\s*(\d{4,})/i;

function clean(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized || null;
}

function externalUrl(links: CardSnapshot['links']): string | null {
  return links.find(({ href }) => /^https?:\/\//i.test(href) && !/linkedin\.com/i.test(href))?.href ?? null;
}

function linkedInUrl(links: CardSnapshot['links'], path: RegExp): string | null {
  return links.find(({ href }) => path.test(href))?.href ?? null;
}

function lineAfter(lines: string[], match: RegExp): string | null {
  const index = lines.findIndex((line) => match.test(line));
  return index >= 0 ? clean(lines[index + 1]) : null;
}

export function parseCard(snapshot: CardSnapshot, query: AdQuery, source: RawAd['extraction']['source']): RawAd | null {
  const text = clean(snapshot.text);
  if (!text) return null;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const attrs = snapshot.attributes ?? {};
  const detailUrl = attrs['data-detail-url'] ?? linkedInUrl(snapshot.links, /ad-library\/(?:ad|detail)/i);
  const adId =
    attrs['data-ad-id'] ??
    detailUrl?.match(/(\d{4,})(?:\D*)$/)?.[1] ??
    text.match(AD_ID_RE)?.[1] ??
    null;
  const advertiserUrl = attrs['data-advertiser-url'] ?? linkedInUrl(snapshot.links, /linkedin\.com\/company\//i);
  const advertiserName =
    clean(attrs['data-advertiser-name']) ??
    clean(snapshot.links.find(({ href }) => /linkedin\.com\/company\//i.test(href))?.text) ??
    lineAfter(lines, /^(advertiser|company)$/i) ??
    null;
  const payerName = clean(attrs['data-payer-name']) ?? lineAfter(lines, /^payer$/i);
  const primaryText = clean(attrs['data-primary-text']) ?? lineAfter(lines, /^(ad copy|sponsored)$/i) ?? clean(lines.slice(0, 5).join(' '));
  const headline = clean(attrs['data-headline']) ?? lineAfter(lines, /^headline$/i);
  const landingUrl = clean(attrs['data-landing-url']) ?? externalUrl(snapshot.links) ?? text.match(URL_RE)?.[0] ?? null;
  const activeFrom = clean(attrs['data-active-from']) ?? text.match(DATE_RE)?.[1] ?? null;
  if (!adId && !advertiserName && !landingUrl) return null;

  return {
    platform: 'linkedin',
    adId,
    advertiserName,
    advertiserUrl,
    payerName,
    primaryText,
    headline,
    landingUrl,
    detailUrl,
    creativeImageUrls: snapshot.creativeImageUrls ?? [],
    activeFrom,
    activeTo: clean(attrs['data-active-to']),
    status: clean(attrs['data-status']) ?? 'active',
    query,
    extraction: {
      source,
      confidence: adId && advertiserName ? 'high' : 'partial',
      rawText: text.slice(0, 4_000),
    },
  };
}

export function parseCards(cards: CardSnapshot[], query: AdQuery, source: RawAd['extraction']['source']): RawAd[] {
  return cards.map((card) => parseCard(card, query, source)).filter((ad): ad is RawAd => Boolean(ad));
}
