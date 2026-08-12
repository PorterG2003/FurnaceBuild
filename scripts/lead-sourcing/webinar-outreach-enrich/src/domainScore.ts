import { normalizeDomain } from './types.js';

const LEGAL_SUFFIXES = new Set([
  'inc',
  'llc',
  'ltd',
  'llp',
  'corp',
  'co',
  'company',
  'companies',
  'group',
  'holdings',
  'the',
  'and',
  'of',
  'for',
  'a',
  'an',
]);

export function brandTokens(companyName: string): string[] {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !LEGAL_SUFFIXES.has(t));
}

export function tokenOverlapRatio(a: string, b: string): number {
  const ta = new Set(brandTokens(a));
  const tb = new Set(brandTokens(b));
  if (ta.size === 0 || tb.size === 0) {
    const na = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nb = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!na || !nb) return 0;
    if (na.includes(nb) || nb.includes(na)) return 0.6;
    return 0;
  }
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

export function orgNameMatchesAdvertiser(advertiser: string, orgName: string): boolean {
  const ratio = tokenOverlapRatio(advertiser, orgName);
  if (ratio >= 0.5) return true;
  const a = advertiser.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = orgName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Boolean(a && b && (a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 4);
}

export type DomainCandidate = {
  domain: string;
  source: 'knowledge_graph' | 'organic' | 'redirect';
  position?: number;
  title?: string;
  snippet?: string;
};

export type ScoredDomain = DomainCandidate & {
  score: number;
  tier: 'high' | 'medium' | 'low';
  reasons: string[];
};

function looksLikePersonNameDomain(domain: string, tokens: string[]): boolean {
  const host = domain.split('.')[0] ?? '';
  if (tokens.length !== 2) return false;
  // Heuristic: first+last style hosts only when both tokens are short name-like.
  if (!tokens.every((t) => t.length >= 3 && t.length <= 6)) return false;
  const joined = tokens[0]! + tokens[1]!;
  return host === joined;
}

export function scoreDomainCandidate(
  companyName: string,
  candidate: DomainCandidate,
): ScoredDomain {
  const domain = normalizeDomain(candidate.domain) || normalizeDomain(`https://${candidate.domain}`);
  const reasons: string[] = [];
  let score = 0;
  const tokens = brandTokens(companyName);

  if (!domain) {
    return { ...candidate, domain: '', score: 0, tier: 'low', reasons: ['generic_or_empty'] };
  }

  if (candidate.source === 'knowledge_graph' || candidate.source === 'redirect') {
    score += 0.35;
    reasons.push(candidate.source);
  }

  const hostHasBrand = tokens.some((t) => domain.includes(t));
  if (hostHasBrand) {
    score += 0.4;
    reasons.push('domain_brand_token');
  }

  const text = `${candidate.title ?? ''} ${candidate.snippet ?? ''}`.toLowerCase();
  if (tokens.some((t) => text.includes(t))) {
    score += 0.15;
    reasons.push('title_snippet_brand');
  }

  // Brand host + title + organic #1 should clear high (0.40+0.15+0.15=0.70).
  if (candidate.source === 'organic' && (candidate.position ?? 99) === 1) {
    score += 0.15;
    reasons.push('organic_pos1');
  }

  if (looksLikePersonNameDomain(domain, tokens) && tokens.length <= 2) {
    score -= 0.5;
    reasons.push('person_name_domain_penalty');
  }

  // Advertiser-chosen redirect destination is a strong signal even without brand tokens (taa.org).
  if (candidate.source === 'redirect' && domain && score < 0.75) {
    score = Math.max(score, 0.75);
    reasons.push('redirect_floor');
  }

  const tier: ScoredDomain['tier'] =
    score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low';

  return { ...candidate, domain, score, tier, reasons };
}

export function pickBestScored(scored: ScoredDomain[]): ScoredDomain | null {
  const usable = scored.filter((s) => s.domain && s.tier !== 'low');
  if (usable.length === 0) return null;
  return usable.sort((a, b) => b.score - a.score)[0] ?? null;
}
