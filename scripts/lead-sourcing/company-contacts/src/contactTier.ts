import type { ContactSearchConfig, ContactTiersConfig } from './config.js';

export type ContactTier = 'executive' | 'revops' | 'sales_marketing' | 'excluded' | 'unknown';

export type TierCandidate = {
  id?: string;
  title?: string;
  has_email?: boolean;
  email?: string;
  first_name?: string;
  last_name?: string;
  linkedin_url?: string;
};

export type ContactSlot = {
  id: string;
  tier: ContactTier;
  reason: string;
  title?: string;
};

const STANDALONE_REVOPS_RE = /\b(chief revenue officer|\bcro\b)\b/i;
const STANDALONE_SALES_MARKETING_RE =
  /\b(chief marketing officer|\bcmo\b|chief revenue officer|\bcro\b|chief sales officer|\bcso\b)\b/i;

/** Soft junk that should never count as company executive even if keywords match. */
const EXECUTIVE_NOISE_RE =
  /\b(board member|franchise owner|scientific advisor|chief customer officer)\b/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordPattern(keyword: string): RegExp {
  const escaped = escapeRegex(keyword.trim().toLowerCase());
  if (/^[a-z]+$/.test(keyword.trim()) && keyword.trim().length <= 3) {
    return new RegExp(`\\b${escaped}\\b`, 'i');
  }
  return new RegExp(escaped, 'i');
}

function matchesAny(title: string, keywords: string[]): boolean {
  return keywords.some((keyword) => keywordPattern(keyword).test(title));
}

function seniorityScore(title: string): number {
  if (/\bchief\b/i.test(title)) return 4;
  if (/\b(vp|vice president)\b/i.test(title)) return 3;
  if (/\bhead of\b/i.test(title)) return 2;
  return 0;
}

/** Prefer CEO/founder over bare president/owner when filling executive slots. */
export function executiveRank(title: string): number {
  if (/\b(ceo|chief executive officer)\b/i.test(title)) return 100;
  if (/\b(co-?founder|founder)\b/i.test(title)) return 90;
  if (/\bpresident\b/i.test(title) && !/\bvice president\b/i.test(title)) return 50;
  if (/\bowner\b/i.test(title)) return 30;
  return 10;
}

function isCompanyPresident(title: string): boolean {
  if (/\bvice president\b/i.test(title)) return false;
  // "President of Sales/BD/..." is a function head, not company president
  if (/\bpresident of\b/i.test(title)) {
    return /\bpresident of\s+(the\s+)?(company|board)\b/i.test(title);
  }
  return /\bpresident\b/i.test(title);
}

function isCompanyOwner(title: string): boolean {
  if (/\b(franchise owner|board member)\b/i.test(title)) return false;
  return /\bowner\b/i.test(title);
}

function matchesExecutive(title: string, keywords: string[]): boolean {
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (normalized === 'president') {
      if (isCompanyPresident(title)) return true;
      continue;
    }
    if (normalized === 'owner') {
      if (isCompanyOwner(title)) return true;
      continue;
    }
    if (normalized === 'ceo') {
      if (/\b(ceo|chief executive officer)\b/i.test(title)) return true;
      continue;
    }
    if (keywordPattern(keyword).test(title)) return true;
  }
  return false;
}

/**
 * True when the Apollo title is a credible Founder/CEO/President/Owner,
 * Sales/Marketing leader, or (legacy) top RevOps hit.
 * Used at pick-time and again in verify-leads.
 */
export function passesTitleAccuracy(
  title: string | undefined,
  tier: ContactTier | string,
  config: ContactTiersConfig,
): boolean {
  const value = (title ?? '').trim();
  if (!value) return false;
  if (matchesAny(value, config.exclude)) return false;

  if (tier === 'executive') {
    if (EXECUTIVE_NOISE_RE.test(value) && !/\b(ceo|chief executive officer|co-?founder|founder)\b/i.test(value)) {
      return false;
    }
    return matchesExecutive(value, config.executive);
  }

  if (tier === 'sales_marketing') {
    if (STANDALONE_SALES_MARKETING_RE.test(value)) return true;
    const functions = config.sales_marketing_function ?? [];
    const seniority = config.sales_marketing_seniority ?? [];
    return matchesAny(value, functions) && matchesAny(value, seniority);
  }

  if (tier === 'revops') {
    if (STANDALONE_REVOPS_RE.test(value)) return true;
    return (
      matchesAny(value, config.revops_function) && matchesAny(value, config.revops_seniority)
    );
  }

  return false;
}

export function classifyContactTier(
  title: string | undefined,
  config: ContactTiersConfig,
): ContactTier {
  const value = (title ?? '').trim();
  if (!value) return 'unknown';

  if (matchesAny(value, config.exclude)) return 'excluded';

  // Noise titles that substring-match founder/president incorrectly
  if (EXECUTIVE_NOISE_RE.test(value) && !/\b(ceo|chief executive officer|co-?founder|founder)\b/i.test(value)) {
    // Still allow sales/marketing or RevOps classification below
  } else if (matchesExecutive(value, config.executive)) {
    return 'executive';
  }

  if (STANDALONE_SALES_MARKETING_RE.test(value)) return 'sales_marketing';

  const salesFunctions = config.sales_marketing_function ?? [];
  const salesSeniority = config.sales_marketing_seniority ?? [];
  if (
    salesFunctions.length > 0 &&
    salesSeniority.length > 0 &&
    matchesAny(value, salesFunctions) &&
    matchesAny(value, salesSeniority)
  ) {
    return 'sales_marketing';
  }

  if (STANDALONE_REVOPS_RE.test(value)) return 'revops';

  const hasFunction = matchesAny(value, config.revops_function);
  const hasSeniority = matchesAny(value, config.revops_seniority);
  if (hasFunction && hasSeniority) return 'revops';

  return 'unknown';
}

function sortWithinTier(candidates: TierCandidate[], tier: ContactTier): TierCandidate[] {
  return [...candidates].sort((a, b) => {
    if (tier === 'executive') {
      const rankDiff = executiveRank(b.title ?? '') - executiveRank(a.title ?? '');
      if (rankDiff !== 0) return rankDiff;
    } else {
      const seniorityDiff = seniorityScore(b.title ?? '') - seniorityScore(a.title ?? '');
      if (seniorityDiff !== 0) return seniorityDiff;
    }
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

export function pickContactSlots(
  candidates: TierCandidate[],
  searchConfig: ContactSearchConfig,
): ContactSlot[] {
  const limit = searchConfig.max_contacts_per_company;
  const fillOrder = searchConfig.fill_order;
  const config = searchConfig.contact_tiers;
  const slots: ContactSlot[] = [];
  const usedIds = new Set<string>();

  const eligible = candidates.filter(
    (person) => person.id && person.has_email !== false && !usedIds.has(person.id),
  );

  const buckets = new Map<ContactTier, TierCandidate[]>();
  for (const tier of fillOrder) buckets.set(tier, []);

  for (const person of eligible) {
    const tier = classifyContactTier(person.title, config);
    if (tier === 'excluded' || tier === 'unknown') continue;
    if (!passesTitleAccuracy(person.title, tier, config)) continue;
    buckets.get(tier)?.push(person);
  }

  for (const tier of fillOrder) {
    const sorted = sortWithinTier(buckets.get(tier) ?? [], tier);
    for (const person of sorted) {
      if (slots.length >= limit) return slots;
      if (!person.id || usedIds.has(person.id)) continue;
      usedIds.add(person.id);
      slots.push({
        id: person.id,
        tier,
        reason: `${tier}:${person.title ?? 'unknown'}`,
        title: person.title,
      });
    }
  }

  return slots.slice(0, limit);
}
