/**
 * Versioned rulesets + evidence-based scoring for SkipSherpa person enrichment.
 * Kept separate from contactEnrichment.ts to avoid circular imports with persistence helpers.
 */

export type ContactEnrichmentClassification =
  | 'accepted_strong_match'
  | 'ambiguous'
  | 'no_match'
  | 'error';

/** Subset of DB target row needed for scoring (must stay in sync with ContactEnrichmentTargetRow). */
export type ContactEnrichmentLookupRow = {
  owner_name: string;
  first_name: string;
  last_name: string;
  address_line_1: string;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  company_legal_name?: string | null;
};

export const CONTACT_ENRICHMENT_MATCHER_VERSION = 'contact_enrich_matcher_v1';
export const CONTACT_ENRICHMENT_SCORING_VERSION = 'contact_enrich_score_v1';

export type ContactEnrichmentRulesetPreset = 'conservative' | 'balanced' | 'aggressive';

export type ContactEnrichmentAmbiguityReasonCode =
  | 'high_result_volume'
  | 'close_second_candidate'
  | 'weak_address'
  | 'insufficient_signal'
  | 'conflicting_top_signals'
  | 'expected_results_gate';

export type CandidateScoreBreakdown = {
  name: number;
  middle: number;
  address: number;
  employer: number;
  relative: number;
};

export type RankedCandidateSummary = {
  index: number;
  total_score: number;
  breakdown: CandidateScoreBreakdown;
  employer_strong: boolean;
  address_strong: boolean;
};

export type ContactEnrichmentDecisionMetadata = {
  ruleset_preset: ContactEnrichmentRulesetPreset;
  matcher_version: string;
  scoring_version: string;
  ruleset_version: string;
  ambiguity_reason_codes: ContactEnrichmentAmbiguityReasonCode[];
  ranked_candidates: RankedCandidateSummary[];
  ambiguity_kind: 'reviewable' | 'low_signal' | null;
  review_task_eligible: boolean;
};

export type ContactEnrichmentClassifyContext = {
  rulesetPreset?: ContactEnrichmentRulesetPreset;
  queueAmbiguousForReview?: boolean;
};

// Minimal SkipSherpa person surface used by the classifier
type SkipSherpaPersonName = {
  title?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  suffix?: string | null;
};

type SkipSherpaPostalAddress = {
  delivery_line1?: string | null;
  us_address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zipcode?: string | null;
  } | null;
};

type SkipSherpaEmployer = {
  name?: string | null;
  address?: Record<string, unknown> | null;
};

type SkipSherpaRelative = {
  name?: string | null;
  relation_type?: string | null;
  person_name?: Record<string, unknown> | null;
};

export type SkipSherpaPerson = {
  object_id?: string | null;
  person_name?: SkipSherpaPersonName | null;
  name?: string | null;
  addresses?: SkipSherpaPostalAddress[] | null;
  employers?: SkipSherpaEmployer[] | null;
  relatives?: SkipSherpaRelative[] | null;
};

export type SkipSherpaPersonResult = {
  lookup?: Record<string, unknown>;
  effective_lookup?: Record<string, unknown> | null;
  expected_results?: number | null;
  persons?: SkipSherpaPerson[] | null;
  status_code?: number | null;
  issues?: Record<string, unknown>[] | null;
};

export type ContactEnrichmentMatchDecisionWithMeta = {
  classification: ContactEnrichmentClassification;
  matchedPerson: SkipSherpaPerson | null;
  expectedResults: number;
  providerStatusCode: number | null;
  issues: Record<string, unknown>[];
  score: number;
  metadata: ContactEnrichmentDecisionMetadata;
};

type RulesetThresholds = {
  minTotalScore: number;
  minMargin: number;
  minMarginIfEmployerStrong: number;
  maxExpectedSoft: number;
  maxExpectedHard: number;
  minScoreForLargeExpected: number;
  minMarginForLargeExpected: number;
  noMatchBelowScore: number;
  reviewableMinScore: number;
  lowSignalMaxScore: number;
};

function rulesetVersion(preset: ContactEnrichmentRulesetPreset): string {
  return `${preset}_v1`;
}

function thresholdsForPreset(preset: ContactEnrichmentRulesetPreset): RulesetThresholds {
  switch (preset) {
    case 'conservative':
      return {
        minTotalScore: 7,
        minMargin: 2,
        minMarginIfEmployerStrong: 2,
        maxExpectedSoft: 3,
        maxExpectedHard: 8,
        minScoreForLargeExpected: 12,
        minMarginForLargeExpected: 4,
        noMatchBelowScore: 3,
        reviewableMinScore: 6,
        lowSignalMaxScore: 5,
      };
    case 'aggressive':
      return {
        minTotalScore: 5,
        minMargin: 1,
        minMarginIfEmployerStrong: 1,
        maxExpectedSoft: 15,
        maxExpectedHard: 35,
        minScoreForLargeExpected: 7,
        minMarginForLargeExpected: 2,
        noMatchBelowScore: 2,
        reviewableMinScore: 4,
        lowSignalMaxScore: 4,
      };
    case 'balanced':
    default:
      return {
        minTotalScore: 6,
        minMargin: 2,
        minMarginIfEmployerStrong: 1,
        maxExpectedSoft: 8,
        maxExpectedHard: 25,
        minScoreForLargeExpected: 9,
        minMarginForLargeExpected: 3,
        noMatchBelowScore: 3,
        reviewableMinScore: 5,
        lowSignalMaxScore: 5,
      };
  }
}

export function resolveContactEnrichmentRulesetPreset(
  raw: string | null | undefined,
): ContactEnrichmentRulesetPreset {
  if (raw === 'conservative' || raw === 'aggressive' || raw === 'balanced') return raw;
  return 'balanced';
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeSimpleToken(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeStreet(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(apt|suite|ste|unit)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normCompanyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 0..1 strength */
function employerNameSimilarity(companyLegal: string | null | undefined, employerName: string | null | undefined): number {
  const a = normCompanyName(companyLegal ?? '');
  const b = normCompanyName(employerName ?? '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const aTokens = new Set(a.split(/\s+/).filter((t) => t.length > 1));
  const bTokens = new Set(b.split(/\s+/).filter((t) => t.length > 1));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) overlap += 1;
  }
  const j = overlap / Math.min(aTokens.size, bTokens.size);
  return j >= 0.6 ? 0.55 : 0;
}

function firstNameCompatible(expected: string, actual: string | null | undefined): boolean {
  const a = normalizeSimpleToken(expected);
  const b = normalizeSimpleToken(actual ?? '');
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function lastNameCompatible(expected: string, actual: string | null | undefined): boolean {
  const a = normalizeSimpleToken(expected);
  const b = normalizeSimpleToken(actual ?? '');
  return Boolean(a) && a === b;
}

function middleCompatibleFromOwner(
  ownerName: string,
  lookupFirst: string,
  lookupLast: string,
  personMiddle: string | null | undefined,
): number {
  if (!personMiddle) return 0;
  const mid = normalizeSimpleToken(personMiddle);
  if (!mid) return 0;
  const clean = collapseWhitespace(ownerName).replace(/\s*,\s*/g, ',');
  let tokens: string[];
  if (clean.includes(',')) {
    const [lastPart, rest] = clean.split(',', 2).map((p) => collapseWhitespace(p));
    tokens = [...rest.split(/\s+/).filter(Boolean), ...lastPart.split(/\s+/).filter(Boolean)];
  } else {
    tokens = clean.split(/\s+/).filter(Boolean);
  }
  if (tokens.length < 3) return 0;
  const firstIdx = tokens.findIndex((t) => normalizeSimpleToken(t) === normalizeSimpleToken(lookupFirst));
  const lastIdx = tokens.findIndex((t) => normalizeSimpleToken(t) === normalizeSimpleToken(lookupLast));
  if (firstIdx < 0 || lastIdx < 0) return 0;
  const lo = Math.min(firstIdx, lastIdx);
  const hi = Math.max(firstIdx, lastIdx);
  if (hi - lo < 2) return 0;
  const middleTokens = tokens.slice(lo + 1, hi).map((t) => normalizeSimpleToken(t));
  if (middleTokens.some((t) => t === mid || (t.length === 1 && mid.startsWith(t)))) return 1;
  return 0;
}

function scoreAddressMatch(
  lookup: ContactEnrichmentLookupRow,
  address: SkipSherpaPostalAddress,
): { score: number; strong: boolean } {
  const street = normalizeStreet(address.us_address?.street ?? address.delivery_line1 ?? '');
  const lookupStreet = normalizeStreet(lookup.address_line_1);
  const zip = normalizeSimpleToken(address.us_address?.zipcode);
  const lookupZip = normalizeSimpleToken(lookup.address_postal_code);
  const state = normalizeSimpleToken(address.us_address?.state);
  const lookupState = normalizeSimpleToken(lookup.address_state);
  const city = normalizeStreet(address.us_address?.city ?? '');
  const lookupCity = normalizeStreet(lookup.address_city ?? '');
  let score = 0;
  if (lookupStreet && street && (lookupStreet.startsWith(street) || street.startsWith(lookupStreet))) score += 2;
  if (lookupZip && zip && lookupZip === zip) score += 2;
  if (lookupState && state && lookupState === state) score += 1;
  if (lookupCity && city && (lookupCity === city || lookupCity.includes(city) || city.includes(lookupCity))) score += 1;
  return { score, strong: score >= 4 };
}

function employerAddressMatchesLookup(
  lookup: ContactEnrichmentLookupRow,
  employerAddress: Record<string, unknown> | null | undefined,
): boolean {
  if (!employerAddress || typeof employerAddress !== 'object') return false;
  const us = employerAddress.us_address as Record<string, unknown> | undefined;
  const street = normalizeStreet(
    (typeof us?.street === 'string' ? us.street : null) ??
      (typeof employerAddress.street === 'string' ? employerAddress.street : null) ??
      '',
  );
  const lookupStreet = normalizeStreet(lookup.address_line_1);
  const z1 = normalizeSimpleToken(typeof us?.zipcode === 'string' ? us.zipcode : null);
  const z2 = normalizeSimpleToken(lookup.address_postal_code);
  if (z2 && z1 && z2 === z1) return true;
  if (lookupStreet && street && (lookupStreet.startsWith(street) || street.startsWith(lookupStreet))) return true;
  return false;
}

function bestEmployerSignals(
  lookup: ContactEnrichmentLookupRow,
  employers: SkipSherpaEmployer[] | undefined,
): { points: number; strong: boolean } {
  if (!employers?.length) return { points: 0, strong: false };
  const legal = lookup.company_legal_name ?? null;
  let best = 0;
  let strong = false;
  for (const e of employers) {
    const name = typeof e.name === 'string' ? e.name : '';
    const sim = employerNameSimilarity(legal, name);
    let pts = 0;
    if (sim >= 1) pts = 4;
    else if (sim >= 0.9) pts = 3;
    else if (sim >= 0.55) pts = 2;
    if (employerAddressMatchesLookup(lookup, e.address ?? undefined)) pts += 2;
    if (sim >= 0.9 || pts >= 4) strong = true;
    best = Math.max(best, pts);
  }
  return { points: best, strong };
}

function relativeSurnameBonus(lookup: ContactEnrichmentLookupRow, relatives: SkipSherpaRelative[] | undefined): number {
  if (!relatives?.length) return 0;
  const want = normalizeSimpleToken(lookup.last_name);
  if (!want) return 0;
  let n = 0;
  for (const r of relatives) {
    const pn = r.person_name as { last_name?: string | null } | undefined;
    const ln = normalizeSimpleToken(pn?.last_name ?? '');
    if (ln && ln === want) n += 1;
    else if (typeof r.name === 'string') {
      const parts = collapseWhitespace(r.name).split(/\s+/);
      const last = normalizeSimpleToken(parts[parts.length - 1] ?? '');
      if (last === want) n += 1;
    }
    if (n >= 2) break;
  }
  return Math.min(2, n);
}

function scorePersonAgainstLookup(lookup: ContactEnrichmentLookupRow, person: SkipSherpaPerson): {
  total: number;
  breakdown: CandidateScoreBreakdown;
  employer_strong: boolean;
  address_strong: boolean;
} {
  const nameObj = person.person_name ?? null;
  let name = 0;
  if (firstNameCompatible(lookup.first_name, nameObj?.first_name)) name += 2;
  if (lastNameCompatible(lookup.last_name, nameObj?.last_name)) name += 2;

  let middle = 0;
  if (name >= 4 && nameObj?.middle_name) {
    middle = middleCompatibleFromOwner(lookup.owner_name, lookup.first_name, lookup.last_name, nameObj.middle_name);
  }

  const addresses = Array.isArray(person.addresses) ? person.addresses : [];
  let bestAddr = 0;
  let addressStrong = false;
  for (const a of addresses) {
    const { score, strong } = scoreAddressMatch(lookup, a);
    if (score > bestAddr) bestAddr = score;
    if (strong) addressStrong = true;
  }

  const { points: employer, strong: employerStrong } = bestEmployerSignals(
    lookup,
    Array.isArray(person.employers) ? person.employers : undefined,
  );
  const relative = relativeSurnameBonus(lookup, Array.isArray(person.relatives) ? person.relatives : undefined);

  const breakdown: CandidateScoreBreakdown = {
    name,
    middle,
    address: bestAddr,
    employer,
    relative,
  };
  const total = name + middle + bestAddr + employer + relative;
  return {
    total,
    breakdown,
    employer_strong: employerStrong,
    address_strong: addressStrong || bestAddr >= 4,
  };
}

function passesExpectedResultsGate(
  expectedResults: number,
  personsLen: number,
  top: RankedCandidateSummary,
  second: RankedCandidateSummary | undefined,
  t: RulesetThresholds,
): { ok: boolean; reason?: ContactEnrichmentAmbiguityReasonCode } {
  if (personsLen === 1 && top.total_score >= 8 && top.breakdown.name >= 4) {
    return { ok: true };
  }
  if (expectedResults <= t.maxExpectedSoft) {
    return { ok: true };
  }
  if (expectedResults <= t.maxExpectedHard) {
    const margin = second ? top.total_score - second.total_score : 99;
    if (
      top.total_score >= t.minScoreForLargeExpected &&
      margin >= t.minMarginForLargeExpected &&
      (top.employer_strong || top.address_strong)
    ) {
      return { ok: true };
    }
    return { ok: false, reason: 'high_result_volume' };
  }
  const margin = second ? top.total_score - second.total_score : 99;
  if (top.employer_strong && top.total_score >= t.minScoreForLargeExpected + 1 && margin >= t.minMarginForLargeExpected) {
    return { ok: true };
  }
  return { ok: false, reason: 'high_result_volume' };
}

export function classifySkipSherpaPersonResult(
  lookup: ContactEnrichmentLookupRow,
  result: SkipSherpaPersonResult | null | undefined,
  context?: ContactEnrichmentClassifyContext,
): ContactEnrichmentMatchDecisionWithMeta {
  const preset = resolveContactEnrichmentRulesetPreset(context?.rulesetPreset ?? undefined);
  const t = thresholdsForPreset(preset);
  const queueReview = context?.queueAmbiguousForReview === true;

  const baseMeta = (): ContactEnrichmentDecisionMetadata => ({
    ruleset_preset: preset,
    matcher_version: CONTACT_ENRICHMENT_MATCHER_VERSION,
    scoring_version: CONTACT_ENRICHMENT_SCORING_VERSION,
    ruleset_version: rulesetVersion(preset),
    ambiguity_reason_codes: [],
    ranked_candidates: [],
    ambiguity_kind: null,
    review_task_eligible: false,
  });

  const providerStatusCode = typeof result?.status_code === 'number' ? result.status_code : null;
  const issues = Array.isArray(result?.issues) ? result!.issues! : [];
  const expectedResults = typeof result?.expected_results === 'number' ? result.expected_results : 0;

  if (providerStatusCode !== 200) {
    return {
      classification: 'error',
      matchedPerson: null,
      expectedResults,
      providerStatusCode,
      issues,
      score: 0,
      metadata: { ...baseMeta(), ambiguity_reason_codes: [] },
    };
  }

  const persons = Array.isArray(result?.persons) ? result!.persons! : [];
  if (persons.length === 0) {
    return {
      classification: 'no_match',
      matchedPerson: null,
      expectedResults,
      providerStatusCode,
      issues,
      score: 0,
      metadata: { ...baseMeta(), ambiguity_reason_codes: ['insufficient_signal'] },
    };
  }

  const ranked = persons
    .map((person, index) => {
      const scored = scorePersonAgainstLookup(lookup, person);
      return {
        person,
        index,
        total_score: scored.total,
        breakdown: scored.breakdown,
        employer_strong: scored.employer_strong,
        address_strong: scored.address_strong,
      };
    })
    .sort((left, right) => right.total_score - left.total_score || left.index - right.index);

  const rankedSummaries: RankedCandidateSummary[] = ranked.map((r) => ({
    index: r.index,
    total_score: r.total_score,
    breakdown: r.breakdown,
    employer_strong: r.employer_strong,
    address_strong: r.address_strong,
  }));

  const top = ranked[0]!;
  const second = ranked[1];

  if (top.total_score < t.noMatchBelowScore) {
    return {
      classification: 'no_match',
      matchedPerson: null,
      expectedResults,
      providerStatusCode,
      issues,
      score: top.total_score,
      metadata: {
        ...baseMeta(),
        ranked_candidates: rankedSummaries,
        ambiguity_reason_codes: ['insufficient_signal'],
        ambiguity_kind: null,
        review_task_eligible: false,
      },
    };
  }

  const margin = second ? top.total_score - second.total_score : 99;
  const minMargin =
    top.employer_strong && t.minMarginIfEmployerStrong < t.minMargin ? t.minMarginIfEmployerStrong : t.minMargin;
  const marginOk = !second || margin >= minMargin;

  const expectedGate = passesExpectedResultsGate(expectedResults, persons.length, rankedSummaries[0]!, rankedSummaries[1], t);

  const weakAddress = top.breakdown.address === 0 && !top.employer_strong;
  const reasons: ContactEnrichmentAmbiguityReasonCode[] = [];

  if (!marginOk && second) {
    reasons.push('close_second_candidate');
  }
  if (!expectedGate.ok && expectedGate.reason) {
    reasons.push(expectedGate.reason);
  }
  if (weakAddress && !top.employer_strong && top.total_score < t.minTotalScore + 2) {
    reasons.push('weak_address');
  }
  if (top.employer_strong && second?.employer_strong && margin < 2) {
    reasons.push('conflicting_top_signals');
  }

  const acceptScoreOk = top.total_score >= t.minTotalScore;
  const accept =
    acceptScoreOk &&
    marginOk &&
    expectedGate.ok &&
    !(top.employer_strong && second?.employer_strong && margin < 2 && top.total_score < t.minTotalScore + 2);

  if (accept) {
    return {
      classification: 'accepted_strong_match',
      matchedPerson: top.person,
      expectedResults,
      providerStatusCode,
      issues,
      score: top.total_score,
      metadata: {
        ...baseMeta(),
        ranked_candidates: rankedSummaries,
        ambiguity_reason_codes: [],
        ambiguity_kind: null,
        review_task_eligible: false,
      },
    };
  }

  if (!reasons.length) {
    reasons.push('expected_results_gate');
  }

  const ambiguityKind: 'reviewable' | 'low_signal' =
    top.total_score >= t.reviewableMinScore ? 'reviewable' : 'low_signal';

  const reviewEligible = queueReview && ambiguityKind === 'reviewable';

  return {
    classification: 'ambiguous',
    matchedPerson: null,
    expectedResults,
    providerStatusCode,
    issues,
    score: top.total_score,
    metadata: {
      ...baseMeta(),
      ranked_candidates: rankedSummaries,
      ambiguity_reason_codes: reasons,
      ambiguity_kind: ambiguityKind,
      review_task_eligible: reviewEligible,
    },
  };
}
