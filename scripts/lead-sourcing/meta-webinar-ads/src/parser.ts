import type { AdQuery, RawAd } from './types.js';

export type CardSnapshot = {
  libraryId: string | null;
  pageName: string | null;
  pageUrl: string | null;
  primaryText: string | null;
  headline: string | null;
  landingUrl: string | null;
  cta: string | null;
  startedRunning: string | null;
  linkUrls: string[];
  rawText: string;
};

const HTTP_URL_RE = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi;
const CTA_LINE_RE =
  /^(sign up|shop now|learn more|install now|download|book now|get offer|apply now|subscribe|install|register free|register|learn more)$/i;

function clean(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized || null;
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;]+$/g, '');
}

function isUrlLine(line: string): boolean {
  return /^https?:\/\//i.test(line) || /^[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,}$/i.test(line);
}

function isUiNoise(line: string): boolean {
  return /^(platforms|open dropdown|this ad has|eu transparency|\d+ ads use|see ad details|see summary details|library id|started running on|active)$/i.test(
    line,
  );
}

function pickLandingUrl(linkUrls: string[]): string | null {
  const external = linkUrls.filter((url) => !/facebook\.com|instagram\.com|fb\.me|meta\.com/i.test(url));
  return external[0] ?? null;
}

function extractStructured(lines: string[], linkUrls: string[]): {
  primaryText: string | null;
  headline: string | null;
  landingUrl: string | null;
  cta: string | null;
} {
  const sponsoredIndex = lines.findIndex((line) => /^sponsored$/i.test(line));
  let primaryText: string | null = null;
  let headline: string | null = null;
  let cta: string | null = null;
  let landingUrl: string | null = pickLandingUrl(linkUrls);

  if (sponsoredIndex >= 0) {
    const textParts: string[] = [];
    let seenUrl = false;
    for (let i = sponsoredIndex + 1; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (/^active$/i.test(line)) break;
      if (isUiNoise(line)) continue;
      if (isUrlLine(line)) {
        if (!landingUrl) {
          landingUrl = /^https?:\/\//i.test(line) ? stripTrailingUrlPunctuation(line) : `https://${line.toLowerCase()}/`;
        }
        seenUrl = true;
        continue;
      }
      if (CTA_LINE_RE.test(line)) {
        cta = line;
        break;
      }
      if (seenUrl && !headline && line.length >= 3 && line.length <= 120) {
        headline = line;
        continue;
      }
      if (!seenUrl && line.length >= 3) textParts.push(line);
    }
    if (textParts.length > 0) primaryText = textParts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 4_000) || null;
  }

  return { primaryText, headline, landingUrl, cta };
}

export function parseMetaBodyText(bodyText: string): {
  cards: CardSnapshot[];
  blocker: string | null;
  noResults: boolean;
} {
  const cards: CardSnapshot[] = [];
  const blocks = bodyText.split(/(?=Library ID:\s*\d)/i).filter((block) => /Library ID:/i.test(block));

  for (const block of blocks) {
    const libraryId = block.match(/Library ID:\s*(\d+)/i)?.[1] ?? null;
    const startedRunning = block.match(/Started running on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1] ?? null;
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== '​');

    let pageName: string | null = null;
    const seeDetailsIndex = lines.findIndex((line) => /^see ad details$/i.test(line) || /^see summary details$/i.test(line));
    if (seeDetailsIndex >= 0) {
      for (let i = seeDetailsIndex + 1; i < lines.length; i += 1) {
        const line = lines[i]!;
        if (/^sponsored$/i.test(line)) break;
        if (/^(active|platforms|open dropdown|this ad has|eu transparency|\d+ ads use)/i.test(line)) continue;
        if (line.length >= 2 && line.length <= 120) {
          pageName = line;
          break;
        }
      }
    }

    const linkUrls = [
      ...new Set(
        [...block.matchAll(HTTP_URL_RE)].map((match) => stripTrailingUrlPunctuation(match[0].trim())).filter(Boolean),
      ),
    ];
    for (const line of lines) {
      if (/^[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,}$/i.test(line)) linkUrls.push(`https://${line.toLowerCase()}/`);
    }
    const structured = extractStructured(lines, [...new Set(linkUrls)]);
    cards.push({
      libraryId,
      pageName,
      pageUrl: null,
      primaryText: structured.primaryText,
      headline: structured.headline,
      landingUrl: structured.landingUrl,
      cta: structured.cta,
      startedRunning,
      linkUrls: [...new Set(linkUrls)],
      rawText: block.replace(/\s+/g, ' ').trim().slice(0, 4_000),
    });
  }

  const normalized = bodyText.replace(/\s+/g, ' ').trim();
  const loginWall = /log in to facebook|you must log in|create new account|login to continue/i.test(normalized);
  const zeroResults = /\b0 results\b/i.test(bodyText) || /no ads match|didn't find any ads|no results/i.test(bodyText);
  const hasResultsLabel = /\d[\d,]*\+?\s+results/i.test(bodyText);
  return {
    cards,
    blocker: loginWall ? 'login_wall' : null,
    noResults: zeroResults || (cards.length === 0 && !hasResultsLabel && /no ads|no results/i.test(normalized)),
  };
}

export function parseCard(snapshot: CardSnapshot, query: AdQuery, source: RawAd['extraction']['source']): RawAd | null {
  const adId = clean(snapshot.libraryId);
  const advertiserName = clean(snapshot.pageName);
  const landingUrl = clean(snapshot.landingUrl);
  if (!adId && !advertiserName && !landingUrl) return null;
  const detailUrl = adId ? `https://www.facebook.com/ads/library/?id=${adId}` : null;
  return {
    platform: 'meta',
    adId,
    advertiserName,
    advertiserUrl: clean(snapshot.pageUrl),
    payerName: null,
    primaryText: clean(snapshot.primaryText) ?? clean(snapshot.rawText)?.slice(0, 1_500) ?? null,
    headline: clean(snapshot.headline) ?? clean(snapshot.cta),
    landingUrl,
    detailUrl,
    creativeImageUrls: [],
    activeFrom: clean(snapshot.startedRunning),
    activeTo: null,
    status: 'active',
    query,
    extraction: {
      source,
      confidence: adId && advertiserName ? 'high' : 'partial',
      rawText: snapshot.rawText.slice(0, 4_000),
    },
  };
}

export function parseCards(cards: CardSnapshot[], query: AdQuery, source: RawAd['extraction']['source']): RawAd[] {
  return cards.map((card) => parseCard(card, query, source)).filter((ad): ad is RawAd => Boolean(ad));
}
