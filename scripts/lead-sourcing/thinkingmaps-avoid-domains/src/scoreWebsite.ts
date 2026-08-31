import { hostnameOf, normalizeDomain } from './lib/url.js';
import { isJunkSearchHost, isVendorHost } from './vendorHosts.js';

const SCHOOL_STOP = new Set([
  'the',
  'and',
  'of',
  'for',
  'a',
  'an',
  'school',
  'schools',
  'district',
  'elementary',
  'middle',
  'high',
  'academy',
  'public',
  'unified',
  'union',
  'county',
  'city',
  'independent',
  'community',
  'prep',
  'preparatory',
  'charter',
  'catholic',
  'saint',
  'st',
]);

export type WebsiteCandidate = {
  url: string;
  domain: string;
  source: 'knowledge_graph' | 'organic';
  position?: number;
  title?: string;
  snippet?: string;
};

export type ScoredWebsite = WebsiteCandidate & {
  score: number;
  tier: 'high' | 'medium' | 'low';
  reasons: string[];
  vendor: boolean;
};

export function brandTokens(orgName: string): string[] {
  return orgName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !SCHOOL_STOP.has(t));
}

export function candidateFromUrl(
  url: string,
  extra: Partial<WebsiteCandidate> = {},
): WebsiteCandidate | null {
  const domain = normalizeDomain(url) || hostnameOf(url);
  if (!domain) return null;
  const href = /^https?:\/\//i.test(url) ? url : `https://${domain}`;
  return {
    url: href,
    domain,
    source: extra.source ?? 'organic',
    position: extra.position,
    title: extra.title,
    snippet: extra.snippet,
  };
}

export function scoreSchoolWebsite(orgName: string, candidate: WebsiteCandidate): ScoredWebsite {
  const reasons: string[] = [];
  let score = 0;
  const domain = candidate.domain;
  const vendor = isVendorHost(domain);

  if (!domain || isJunkSearchHost(candidate.url) || isJunkSearchHost(domain)) {
    return { ...candidate, score: 0, tier: 'low', reasons: ['junk_directory'], vendor };
  }

  const tokens = brandTokens(orgName);
  if (candidate.source === 'knowledge_graph') {
    score += 0.35;
    reasons.push('knowledge_graph');
  }
  if (tokens.some((t) => domain.includes(t))) {
    score += 0.4;
    reasons.push('domain_brand_token');
  }
  const text = `${candidate.title ?? ''} ${candidate.snippet ?? ''}`.toLowerCase();
  if (tokens.some((t) => text.includes(t))) {
    score += 0.15;
    reasons.push('title_snippet_brand');
  }
  if (/\.k12\.[a-z]{2}\.us$/i.test(domain) || /\.edu$/i.test(domain)) {
    score += 0.25;
    reasons.push('edu_k12_tld');
  } else if (/\.(org|us|gov|net)$/i.test(domain)) {
    score += 0.1;
    reasons.push('eduish_tld');
  }
  if (/(^|\.)(school|schools|district|students|isd|usd|boces)([.-]|$)/i.test(domain)) {
    score += 0.15;
    reasons.push('schoolish_host');
  }
  if (candidate.source === 'organic' && (candidate.position ?? 99) === 1) {
    score += 0.1;
    reasons.push('organic_pos1');
  }
  if (vendor) {
    score -= 0.35;
    reasons.push('vendor_cms');
  }

  const tier: ScoredWebsite['tier'] = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  return { ...candidate, score, tier, reasons, vendor };
}

export function pickBestWebsite(scored: ScoredWebsite[]): ScoredWebsite | null {
  const notJunk = scored.filter((s) => s.domain && !s.reasons.includes('junk_directory'));
  const usable = notJunk.filter((s) => s.tier !== 'low');
  if (usable.length > 0) {
    return usable.sort((a, b) => b.score - a.score)[0] ?? null;
  }
  if (notJunk.length === 1) {
    const only = notJunk[0]!;
    return { ...only, tier: 'medium', reasons: [...only.reasons, 'sole_non_junk'] };
  }
  return notJunk.sort((a, b) => b.score - a.score)[0] ?? null;
}

export function isUsableFallbackDomain(domain: string): boolean {
  if (!domain || isJunkSearchHost(domain) || isVendorHost(domain)) return false;
  if (/\.k12\.[a-z]{2}\.us$/i.test(domain)) return true;
  if (/\.(edu|org|us|gov|net|com)$/i.test(domain)) return true;
  return false;
}
