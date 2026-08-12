import type { ContactTiersConfig } from '../lib/config.js';

export type ContactTier = 'webinar_fill' | 'pipeline' | 'executive' | 'poster' | 'excluded' | 'unknown';

export type TierCandidate = {
  id?: string;
  title?: string;
  has_email?: boolean;
};

export type ContactSlot = {
  id: string;
  tier: ContactTier;
  reason: string;
  title?: string;
};

const STANDALONE_TIER2_RE = /\b(chief revenue officer|\bcro\b)\b/i;

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
  if (/\bdirector\b/i.test(title)) return 1;
  return 0;
}

function matchesTier3Executive(title: string, keywords: string[]): boolean {
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (normalized === 'president') {
      if (/\bpresident\b/i.test(title) && !/\bvice president\b/i.test(title)) return true;
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

export function isValidPosterContact(title: string | undefined, config: ContactTiersConfig): boolean {
  return classifyContactTier(title, config) !== 'excluded';
}

export function classifyContactTier(title: string | undefined, config: ContactTiersConfig): ContactTier {
  const value = (title ?? '').trim();
  if (!value) return 'unknown';

  if (matchesAny(value, config.exclude)) return 'excluded';

  if (matchesAny(value, config.tier1_webinar)) return 'webinar_fill';

  if (STANDALONE_TIER2_RE.test(value)) return 'pipeline';

  const hasPipelineFunction = matchesAny(value, config.tier2_pipeline);
  const hasSeniority = matchesAny(value, config.tier2_seniority);
  if (hasPipelineFunction && hasSeniority) return 'pipeline';

  if (matchesTier3Executive(value, config.tier3_executive)) return 'executive';

  return 'unknown';
}

function sortWithinTier(candidates: TierCandidate[]): TierCandidate[] {
  return [...candidates].sort((a, b) => {
    const seniorityDiff = seniorityScore(b.title ?? '') - seniorityScore(a.title ?? '');
    if (seniorityDiff !== 0) return seniorityDiff;
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
}

const TIER_FILL_ORDER: ContactTier[] = ['webinar_fill', 'pipeline', 'executive'];

export type PickContactSlotsOptions = {
  posterId?: string;
  posterTitle?: string;
};

export function pickContactSlots(
  candidates: TierCandidate[],
  limit: number,
  config: ContactTiersConfig,
  options: PickContactSlotsOptions = {},
): ContactSlot[] {
  const slots: ContactSlot[] = [];
  const usedIds = new Set<string>();

  if (options.posterId) {
    slots.push({
      id: options.posterId,
      tier: 'poster',
      reason: 'poster:linkedin_author',
      title: options.posterTitle,
    });
    usedIds.add(options.posterId);
  }

  const eligible = candidates.filter(
    (person) => person.id && person.has_email !== false && !usedIds.has(person.id),
  );

  const buckets = new Map<ContactTier, TierCandidate[]>();
  for (const tier of TIER_FILL_ORDER) buckets.set(tier, []);

  for (const person of eligible) {
    const tier = classifyContactTier(person.title, config);
    if (tier === 'excluded' || tier === 'unknown') continue;
    buckets.get(tier)?.push(person);
  }

  for (const tier of TIER_FILL_ORDER) {
    const sorted = sortWithinTier(buckets.get(tier) ?? []);
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

export function isPosterEligible(
  entity: { entity_source: string; sample_post_url: string },
  authorProfileByUrl: Map<string, string>,
): boolean {
  if (entity.entity_source === 'person_employer') return true;
  const authorUrl = authorProfileByUrl.get(entity.sample_post_url) ?? '';
  return /linkedin\.com\/in\//i.test(authorUrl);
}
