export type MetaAdsVerificationResult = 'yes' | 'no' | 'unknown';

export interface MetaAdLibraryMatchedAd {
  library_id: string | null;
  page_name: string | null;
  primary_text: string | null;
  headline: string | null;
  landing_url: string | null;
  cta: string | null;
  started_running: string | null;
  link_urls?: string[];
}

export interface MetaAdLibraryResultCard {
  page_name: string | null;
  page_id: string | null;
  page_url: string | null;
  link_urls: string[];
  body_text: string | null;
  primary_text: string | null;
  headline: string | null;
  landing_url: string | null;
  cta: string | null;
  started_running: string | null;
}

export const META_ADS_MAX_MATCHED_ADS = 5;

export interface MetaAdLibraryPageSnapshot {
  page_title: string | null;
  body_text: string;
  hrefs: string[];
  cards: MetaAdLibraryResultCard[];
  blocker: string | null;
  no_results: boolean;
}

export interface ClassifyMetaAdResultsOptions {
  searchDomain: string;
  companyName?: string | null;
  snapshot: MetaAdLibraryPageSnapshot;
}

export interface ClassifyMetaAdResultsOutput {
  result: MetaAdsVerificationResult;
  matched_via: 'domain_url' | 'page_name' | null;
  matched_card: MetaAdLibraryResultCard | null;
  ambiguous: boolean;
  reason: string | null;
}

const NO_RESULTS_RE =
  /no ads match|didn't find any ads|no results|0 ads|we couldn't find|nothing matched|no ads to show/i;
const LOGIN_WALL_RE = /log in to facebook|you must log in|create new account|login to continue/i;

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function hostnameFromUrl(raw: string): string | null {
  try {
    const trimmed = raw.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    const host = normalizeHost(url.hostname);
    return host || null;
  } catch {
    return null;
  }
}

export function domainMatchesResult(searchDomain: string, linkUrl: string): boolean {
  const domain = normalizeHost(searchDomain.trim());
  if (!domain) return false;
  const host = hostnameFromUrl(linkUrl);
  if (!host) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeName(value)
      .split(' ')
      .filter((token) => token.length > 1),
  );
}

/** Conservative page-name match: exact normalized equality or all company tokens present in page name. */
export function scorePageNameMatch(companyName: string, pageName: string): number {
  const companyNorm = normalizeName(companyName);
  const pageNorm = normalizeName(pageName);
  if (!companyNorm || !pageNorm) return 0;
  if (companyNorm === pageNorm) return 1;
  const companyTokens = tokenSet(companyName);
  const pageTokens = tokenSet(pageName);
  if (companyTokens.size === 0 || pageTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of companyTokens) {
    if (pageTokens.has(token)) overlap += 1;
  }
  const coverage = overlap / companyTokens.size;
  if (coverage >= 1 && companyTokens.size >= +2) return 0.92;
  if (coverage >= 1 && companyTokens.size === 1) return 0.85;
  if (coverage >= 0.75 && companyTokens.size >= 3) return 0.75;
  return 0;
}

const PAGE_NAME_MATCH_THRESHOLD = 0.85;
const HTTP_URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi;
const WEBINAR_PATH_IN_URL_RE = /\/(webinars?|masterclass|virtual-event|live-event|online-workshop)(\/|$|\?)/i;
const CTA_LINE_RE =
  /^(sign up|shop now|learn more|install now|download|book now|get offer|apply now|subscribe|install|register free)$/i;

function isUrlLine(line: string): boolean {
  return /^https?:\/\//i.test(line) || /^[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,}$/i.test(line);
}

function isUiNoiseAfterSponsored(line: string): boolean {
  return /^(platforms|open dropdown|this ad has|eu transparency|\d+ ads use|see ad details|see summary details|library id|started running on)/i.test(
    line,
  );
}

function pickLandingUrl(linkUrls: string[], searchDomain: string | null): string | null {
  const candidates = searchDomain
    ? linkUrls.filter((url) => domainMatchesResult(searchDomain, url))
    : linkUrls.filter((url) => !/facebook\.com/i.test(url));
  if (candidates.length === 0) {
    const external = linkUrls.find((url) => !/facebook\.com/i.test(url));
    return external ?? linkUrls[0] ?? null;
  }
  const webinarUrl = candidates.find((url) => WEBINAR_PATH_IN_URL_RE.test(url));
  if (webinarUrl) return webinarUrl;
  return candidates.sort((a, b) => {
    try {
      return new URL(b).pathname.length - new URL(a).pathname.length;
    } catch {
      return b.length - a.length;
    }
  })[0]!;
}

export function extractStructuredAdContentFromBlock(
  lines: string[],
  linkUrls: string[],
  searchDomain: string | null = null,
): Pick<MetaAdLibraryResultCard, 'primary_text' | 'headline' | 'landing_url' | 'cta'> {
  const sponsoredIndex = lines.findIndex((line) => /^sponsored$/i.test(line));
  let primary_text: string | null = null;
  let headline: string | null = null;
  let cta: string | null = null;
  let landing_url: string | null = pickLandingUrl(linkUrls, searchDomain);

  if (sponsoredIndex >= 0) {
    const textParts: string[] = [];
    let seenUrl = false;
    for (let i = sponsoredIndex + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^active$/i.test(line)) break;
      if (isUiNoiseAfterSponsored(line)) continue;
      if (isUrlLine(line)) {
        if (!landing_url) {
          landing_url = /^https?:\/\//i.test(line)
            ? stripTrailingUrlPunctuation(line)
            : `https://${line.toLowerCase()}/`;
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
      if (!seenUrl && line.length >= 3) {
        textParts.push(line);
      }
    }
    if (textParts.length > 0) {
      primary_text = textParts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500) || null;
    }
  }

  return { primary_text, headline, landing_url, cta };
}

export function toMatchedAdPayload(card: MetaAdLibraryResultCard): MetaAdLibraryMatchedAd {
  return {
    library_id: card.page_id,
    page_name: card.page_name,
    primary_text: card.primary_text,
    headline: card.headline,
    landing_url: card.landing_url ?? pickLandingUrl(card.link_urls, null),
    cta: card.cta,
    started_running: card.started_running,
    link_urls: card.link_urls,
  };
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;]+$/g, '');
}

function extractLinkUrlsFromAdBlock(block: string, lines: string[]): string[] {
  const urls = new Set<string>();
  for (const line of lines) {
    if (/^[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,}$/i.test(line)) {
      urls.add(`https://${line.toLowerCase()}/`);
    }
  }
  for (const match of block.matchAll(HTTP_URL_IN_TEXT_RE)) {
    const raw = stripTrailingUrlPunctuation(match[0].trim());
    if (raw) urls.add(raw);
  }
  return [...urls];
}

function normalizeAdvertiserKey(pageName: string | null): string | null {
  if (!pageName?.trim()) return null;
  const normalized = normalizeName(pageName);
  return normalized || null;
}

function extractPageIdFromHref(href: string): string | null {
  const viewAll = href.match(/view_all_page_id=(\d+)/i);
  if (viewAll?.[1]) return viewAll[1];
  const pagePath = href.match(/facebook\.com\/([^/?#]+)/i);
  if (pagePath?.[1] && !['ads', 'ads_library', 'www', 'm', 'l'].includes(pagePath[1].toLowerCase())) {
    return pagePath[1];
  }
  return null;
}

function parseCardsFromHtml(html: string): MetaAdLibraryResultCard[] {
  const cards: MetaAdLibraryResultCard[] = [];
  const articleBlocks = html.split(/<div[^>]*role="article"[^>]*>/i).slice(1);
  const blocks = articleBlocks.length > 0 ? articleBlocks : [html];

  for (const block of blocks) {
    const linkUrls = [...block.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
    const pageLinkMatch = [...block.matchAll(/<a[^>]+href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"[^>]*>([^<]+)<\/a>/gi)].find(
      (m) => !m[1].includes('/ads/'),
    );
    const pageHref = pageLinkMatch?.[1] ?? null;
    const pageName = pageLinkMatch?.[2]?.trim() ?? null;
    const startedMatch = block.match(/Started running on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    const bodyText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (linkUrls.length === 0 && !pageName) continue;

    cards.push({
      page_name: pageName,
      page_id: pageHref ? extractPageIdFromHref(pageHref) : null,
      page_url: pageHref,
      link_urls: linkUrls,
      body_text: bodyText.slice(0, 200) || null,
      primary_text: null,
      headline: null,
      landing_url: pickLandingUrl(linkUrls, null),
      cta: null,
      started_running: startedMatch?.[1] ?? null,
    });
  }

  if (cards.length === 0) {
    const hrefMatches = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
    if (hrefMatches.length > 0) {
      cards.push({
        page_name: null,
        page_id: null,
        page_url: null,
        link_urls: hrefMatches,
        body_text: null,
        primary_text: null,
        headline: null,
        landing_url: pickLandingUrl(hrefMatches, null),
        cta: null,
        started_running: null,
      });
    }
  }
  return cards;
}

export function parseMetaAdLibraryBodyText(bodyText: string, searchDomain: string | null = null): MetaAdLibraryPageSnapshot {
  const normalizedBody = bodyText.replace(/\s+/g, ' ').trim();
  const cards: MetaAdLibraryResultCard[] = [];
  const blocks = bodyText.split(/(?=Library ID:\s*\d)/i).filter((block) => /Library ID:/i.test(block));

  for (const block of blocks) {
    const libraryIdMatch = block.match(/Library ID:\s*(\d+)/i);
    const startedMatch = block.match(/Started running on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== '​');

    let pageName: string | null = null;
    const seeDetailsIndex = lines.findIndex((line) => /^see ad details$/i.test(line) || /^see summary details$/i.test(line));
    if (seeDetailsIndex >= 0) {
      for (let i = seeDetailsIndex + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (/^sponsored$/i.test(line)) break;
        if (/^(active|platforms|open dropdown|this ad has|eu transparency|\d+ ads use)/i.test(line)) continue;
        if (line.length >= 2 && line.length <= 120) {
          pageName = line;
          break;
        }
      }
    }

    const linkUrls = extractLinkUrlsFromAdBlock(block, lines);
    const structured = extractStructuredAdContentFromBlock(lines, linkUrls, searchDomain);

    cards.push({
      page_name: pageName,
      page_id: libraryIdMatch?.[1] ?? null,
      page_url: null,
      link_urls: linkUrls,
      body_text: block.replace(/\s+/g, ' ').trim().slice(0, 200),
      primary_text: structured.primary_text,
      headline: structured.headline,
      landing_url: structured.landing_url,
      cta: structured.cta,
      started_running: startedMatch?.[1] ?? null,
    });
  }

  const loginWall = LOGIN_WALL_RE.test(normalizedBody);
  const zeroResults = /\b0 results\b/i.test(bodyText) || /\bno ads match/i.test(bodyText);
  const hasResultsLabel = />\s*0 results\b/i.test(bodyText) === false && /\d[\d,]*\+?\s+results/i.test(bodyText);
  const noResults = zeroResults || (cards.length === 0 && NO_RESULTS_RE.test(normalizedBody) && !hasResultsLabel);

  return {
    page_title: null,
    body_text: normalizedBody.slice(0, 4000),
    hrefs: [],
    cards,
    blocker: loginWall ? 'login_wall' : null,
    no_results: noResults,
  };
}

export function parseMetaAdLibraryHtml(html: string, pageTitle = ''): MetaAdLibraryPageSnapshot {
  const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, '\n');
  const useBodyParser =
    /Library ID:/i.test(bodyText) &&
    (/See (ad|summary) details/i.test(bodyText) || /\d[\d,]*\+?\s+results/i.test(bodyText));
  if (useBodyParser) {
    const fromBody = parseMetaAdLibraryBodyText(bodyText);
    if (fromBody.cards.length > 0) {
      return { ...fromBody, page_title: pageTitle || null };
    }
  }

  const normalizedBody = bodyText.replace(/\s+/g, ' ').trim();
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  const cards = parseCardsFromHtml(html);
  let blocker: string | null = null;
  if (LOGIN_WALL_RE.test(normalizedBody)) blocker = 'login_wall';
  const noResults = NO_RESULTS_RE.test(normalizedBody) && cards.length === 0;
  return {
    page_title: pageTitle || null,
    body_text: normalizedBody.slice(0, 2000),
    hrefs,
    cards,
    blocker,
    no_results: noResults,
  };
}

export function cardDomainMatch(card: MetaAdLibraryResultCard, searchDomain: string): boolean {
  if (card.landing_url && domainMatchesResult(searchDomain, card.landing_url)) return true;
  if (card.link_urls.some((url) => domainMatchesResult(searchDomain, url))) return true;
  if (!card.body_text) return false;
  for (const match of card.body_text.matchAll(HTTP_URL_IN_TEXT_RE)) {
    if (domainMatchesResult(searchDomain, stripTrailingUrlPunctuation(match[0]))) return true;
  }
  return false;
}

function cardPageNameMatch(card: MetaAdLibraryResultCard, companyName: string): number {
  if (!card.page_name) return 0;
  return scorePageNameMatch(companyName, card.page_name);
}

function pickLatestStartedRunning(cards: MetaAdLibraryResultCard[]): string | null {
  const dates = cards.map((c) => c.started_running).filter((d): d is string => Boolean(d));
  return dates[0] ?? null;
}

export function classifyMetaAdResults(options: ClassifyMetaAdResultsOptions): ClassifyMetaAdResultsOutput {
  const { searchDomain, companyName, snapshot } = options;
  if (snapshot.blocker) {
    return {
      result: 'unknown',
      matched_via: null,
      matched_card: null,
      ambiguous: false,
      reason: snapshot.blocker,
    };
  }
  if (snapshot.no_results || snapshot.cards.length === 0) {
    return {
      result: 'no',
      matched_via: null,
      matched_card: null,
      ambiguous: false,
      reason: 'no_results',
    };
  }

  const domainMatches = snapshot.cards.filter((card) => cardDomainMatch(card, searchDomain));
  if (domainMatches.length === 1) {
    return {
      result: 'yes',
      matched_via: 'domain_url',
      matched_card: domainMatches[0],
      ambiguous: false,
      reason: 'single_domain_match',
    };
  }
  if (domainMatches.length > 1) {
    return {
      result: 'yes',
      matched_via: 'domain_url',
      matched_card: domainMatches[0],
      ambiguous: true,
      reason: 'multiple_domain_matches',
    };
  }

  if (companyName?.trim()) {
    const scored = snapshot.cards
      .map((card) => ({ card, score: cardPageNameMatch(card, companyName) }))
      .filter((entry) => entry.score >= PAGE_NAME_MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 1) {
      return {
        result: 'yes',
        matched_via: 'page_name',
        matched_card: scored[0].card,
        ambiguous: false,
        reason: 'single_page_name_match',
      };
    }
    if (scored.length > 1) {
      const advertiserKeys = new Set(
        scored
          .map((entry) => normalizeAdvertiserKey(entry.card.page_name))
          .filter((key): key is string => Boolean(key)),
      );
      if (advertiserKeys.size === 1) {
        return {
          result: 'yes',
          matched_via: 'page_name',
          matched_card: scored[0].card,
          ambiguous: scored.length > 1,
          reason: 'same_advertiser_multiple_ads',
        };
      }
      return {
        result: 'unknown',
        matched_via: null,
        matched_card: null,
        ambiguous: true,
        reason: 'ambiguous_page_name_matches',
      };
    }
  }

  if (snapshot.cards.length > 0) {
    return {
      result: 'unknown',
      matched_via: null,
      matched_card: null,
      ambiguous: true,
      reason: 'unmatched_results_present',
    };
  }

  return {
    result: 'no',
    matched_via: null,
    matched_card: null,
    ambiguous: false,
    reason: 'no_match',
  };
}

export function isInconclusiveClassification(output: ClassifyMetaAdResultsOutput): boolean {
  if (output.result === 'unknown') return true;
  if (output.result === 'yes' && output.ambiguous) {
    if (output.reason === 'multiple_domain_matches' || output.reason === 'same_advertiser_multiple_ads') {
      return false;
    }
    return true;
  }
  return false;
}

/** When domain search returns no ads, company-name search may still find the advertiser. */
export function shouldTryCompanyNameFallback(
  output: ClassifyMetaAdResultsOutput,
  companyName?: string | null,
): boolean {
  if (!companyName?.trim()) return false;
  if (isInconclusiveClassification(output)) return true;
  return output.result === 'no' && output.reason === 'no_results';
}

export function latestAdStartedRunningFromCards(cards: MetaAdLibraryResultCard[]): string | null {
  return pickLatestStartedRunning(cards);
}

export function pickMatchedAdsForSignals(
  snapshot: MetaAdLibraryPageSnapshot,
  searchDomain: string,
  classification: ClassifyMetaAdResultsOutput,
  companyName?: string | null,
): MetaAdLibraryMatchedAd[] {
  if (snapshot.no_results || snapshot.cards.length === 0) return [];
  if (classification.result === 'no') return [];

  let selected = snapshot.cards.filter((card) => cardDomainMatch(card, searchDomain));
  if (selected.length === 0 && companyName?.trim()) {
    selected = snapshot.cards.filter((card) => cardPageNameMatch(card, companyName) >= PAGE_NAME_MATCH_THRESHOLD);
  }
  if (selected.length === 0 && classification.matched_card) {
    selected = [classification.matched_card];
  }

  return selected.slice(0, META_ADS_MAX_MATCHED_ADS).map(toMatchedAdPayload);
}
