import {
  classifyManagerSignals,
  type ManagerSignalInput,
  type ManagerSignalResult,
} from './managerSignals.ts';

export type AudienceTier = 'A' | 'B' | 'C' | 'D' | 'none';

export type BrokerAudienceResult = {
  tier: AudienceTier;
  roleCategory: string;
  campaignSegment: 'manager' | 'possible_manager' | 'broker' | 'bio_candidate' | 'none';
  score: number;
  categories: string[];
  evidence: string[];
  manager: ManagerSignalResult;
  hasStructuredBroker: boolean;
};

function clean(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const STRUCTURED_BROKER =
  /\b(?:broker(?:age)?|broker[- ]associate|associate broker|broker salesperson|real estate broker)\b/i;

/** Current-role broker phrases for bio-only Tier D. */
const BIO_CURRENT_BROKER =
  /\b(?:i am|i'm|i’m|serves? as|licensed as|currently(?: an?)?|work(?:s|ing)? as)\s+(?:a\s+)?(?:licensed\s+)?(?:real estate\s+)?(?:associate\s+|managing\s+|principal\s+|designated\s+)?broker\b|\b(?:broker associate|associate broker|managing broker|principal broker|broker of record|broker[- ]in[- ]charge)\b/i;

const BIO_EXCLUSIONS =
  /\b(?:managing broker of the year|former(?:ly)?\s+(?:a\s+)?(?:managing\s+)?broker|brokered by|certified mentor|i enjoy coaching)\b/i;

export function hasStructuredBrokerTitle(input: ManagerSignalInput): boolean {
  const structured = clean(
    [input.title ?? '', ...(input.positionTypes ?? [])].filter(Boolean).join(' | '),
  );
  return STRUCTURED_BROKER.test(structured);
}

export function classifyBioBrokerSignals(bio: string): {
  isCurrentBroker: boolean;
  isManagerish: boolean;
  evidence: string[];
} {
  const text = clean(bio);
  if (!text) return { isCurrentBroker: false, isManagerish: false, evidence: [] };
  // Historical awards / mentor language should not become Tier D on their own.
  if (BIO_EXCLUSIONS.test(text)) {
    const manager = classifyManagerSignals({ description: text });
    if (manager.confidence === 'none') {
      return { isCurrentBroker: false, isManagerish: false, evidence: [] };
    }
  }
  const manager = classifyManagerSignals({ description: text });
  const isManagerish = manager.confidence !== 'none';
  const isCurrentBroker =
    BIO_CURRENT_BROKER.test(text) && !/\bof the year\b/i.test(text) && !BIO_EXCLUSIONS.test(text);
  const evidence: string[] = [];
  if (isManagerish) evidence.push(...manager.evidence);
  if (isCurrentBroker) evidence.push('bio current-broker phrase');
  return { isCurrentBroker, isManagerish, evidence: [...new Set(evidence)] };
}

/**
 * Tiered audience for campaign outreach:
 * A = explicit manager, B = possible manager, C = structured broker, D = bio-only.
 */
export function classifyBrokerAudience(
  input: ManagerSignalInput,
  options?: { bioOnly?: boolean },
): BrokerAudienceResult {
  const manager = classifyManagerSignals(input);
  const structuredBroker = hasStructuredBrokerTitle(input);
  const categories = [...manager.categories];
  const evidence = [...manager.evidence];

  if (options?.bioOnly) {
    const bio = classifyBioBrokerSignals(input.description ?? '');
    if (bio.isManagerish && manager.confidence === 'high') {
      return {
        tier: 'D',
        roleCategory: categories[0] ?? 'bio_manager',
        campaignSegment: 'bio_candidate',
        score: Math.max(manager.score, 70),
        categories,
        evidence: bio.evidence.length ? bio.evidence : evidence,
        manager,
        hasStructuredBroker: false,
      };
    }
    if (bio.isManagerish || bio.isCurrentBroker) {
      return {
        tier: 'D',
        roleCategory: bio.isManagerish
          ? categories[0] ?? 'bio_manager'
          : 'bio_broker',
        campaignSegment: 'bio_candidate',
        score: bio.isManagerish ? Math.max(manager.score, 55) : 40,
        categories: bio.isManagerish ? categories : ['bio_broker'],
        evidence: bio.evidence,
        manager,
        hasStructuredBroker: false,
      };
    }
    return {
      tier: 'none',
      roleCategory: '',
      campaignSegment: 'none',
      score: 0,
      categories: [],
      evidence: [],
      manager,
      hasStructuredBroker: false,
    };
  }

  if (manager.confidence === 'high') {
    return {
      tier: 'A',
      roleCategory: categories[0] ?? 'manager',
      campaignSegment: 'manager',
      score: manager.score,
      categories,
      evidence,
      manager,
      hasStructuredBroker: structuredBroker,
    };
  }

  if (manager.confidence === 'medium') {
    return {
      tier: 'B',
      roleCategory: categories[0] ?? 'possible_brokerage_manager',
      campaignSegment: 'possible_manager',
      score: manager.score,
      categories,
      evidence,
      manager,
      hasStructuredBroker: structuredBroker,
    };
  }

  if (structuredBroker) {
    return {
      tier: 'C',
      roleCategory: 'generic_broker',
      campaignSegment: 'broker',
      score: 35,
      categories: ['generic_broker'],
      evidence: ['structured broker title'],
      manager,
      hasStructuredBroker: true,
    };
  }

  return {
    tier: 'none',
    roleCategory: '',
    campaignSegment: 'none',
    score: 0,
    categories: [],
    evidence: [],
    manager,
    hasStructuredBroker: false,
  };
}

export function tierRank(tier: AudienceTier): number {
  switch (tier) {
    case 'A':
      return 4;
    case 'B':
      return 3;
    case 'C':
      return 2;
    case 'D':
      return 1;
    default:
      return 0;
  }
}

export function preferTier(a: AudienceTier, b: AudienceTier): AudienceTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}
