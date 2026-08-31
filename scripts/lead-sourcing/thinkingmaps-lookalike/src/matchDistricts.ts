import {
  bareDistrictName,
  canonicalDistrictName,
  jaccard,
  normalizeCity,
  normalizeState,
  overrideKey,
  tokenSet,
  zip5,
} from './names.js';
import { lookupOverride } from './leaidOverrides.js';
import type { CcdDistrict, DistrictMatch, MatchConfidence, MatchMethod, WonDistrict } from './types.js';

type Candidate = {
  district: CcdDistrict;
  canonical: string;
  bare: string;
  tokens: Set<string>;
  city: string;
  zip: string;
};

export function indexCcd(universe: CcdDistrict[]): {
  byLeaid: Map<string, CcdDistrict>;
  byState: Map<string, Candidate[]>;
} {
  const byLeaid = new Map<string, CcdDistrict>();
  const byState = new Map<string, Candidate[]>();
  for (const district of universe) {
    byLeaid.set(district.leaid, district);
    const state = normalizeState(district.state);
    const list = byState.get(state) ?? [];
    list.push({
      district,
      canonical: canonicalDistrictName(district.lea_name, state),
      bare: bareDistrictName(district.lea_name, state),
      tokens: tokenSet(district.lea_name, state),
      city: normalizeCity(district.city),
      zip: zip5(district.zip),
    });
    byState.set(state, list);
  }
  return { byLeaid, byState };
}

function confidenceFor(method: MatchMethod, score: number, unique: boolean): MatchConfidence {
  if (method === 'unmatched') return 'none';
  if (method === 'override' || method === 'exact' || (method === 'core' && unique)) return 'high';
  if (method === 'city' && score >= 0.7) return 'high';
  if (score >= 0.85) return 'high';
  if (score >= 0.7) return 'medium';
  return 'low';
}

function finish(
  won: WonDistrict,
  hit: CcdDistrict | null,
  method: MatchMethod,
  score: number,
  unique: boolean,
  reviewReason = '',
): DistrictMatch {
  const confidence = confidenceFor(method, score, unique);
  const needs_review =
    method === 'unmatched' ||
    confidence !== 'high' ||
    won.is_charter ||
    won.is_nyc_subunit ||
    Boolean(reviewReason);
  return {
    district_key: won.district_key,
    district_name: won.district_name,
    state: won.state,
    city: won.city,
    zip: won.zip,
    revenue: won.revenue,
    account_count: won.account_count,
    is_charter: won.is_charter,
    is_nyc_subunit: won.is_nyc_subunit,
    leaid: hit?.leaid ?? '',
    nces_name: hit?.lea_name ?? '',
    nces_city: hit?.city ?? '',
    nces_state: hit?.state ?? '',
    confidence,
    method,
    score,
    needs_review,
    review_reason:
      reviewReason ||
      (method === 'unmatched'
        ? 'no nces match'
        : won.is_nyc_subunit
          ? 'nyc subunit collapsed to citywide lea'
          : won.is_charter
            ? 'charter — confirm LEA vs school'
            : confidence !== 'high'
              ? 'low/medium confidence'
              : ''),
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = seen.get(k) ?? [];
    list.push(item);
    seen.set(k, list);
  }
  return [...seen.values()].filter((list) => list.length === 1).map((list) => list[0]!);
}

export function matchDistrict(won: WonDistrict, byState: Map<string, Candidate[]>, byLeaid: Map<string, CcdDistrict>): DistrictMatch {
  const override = lookupOverride(overrideKey(won.district_name, won.state))
    ?? lookupOverride(won.district_key);
  if (won.is_nyc_subunit) {
    const hit = byLeaid.get('3620580') ?? (override ? byLeaid.get(override.leaid) : null) ?? null;
    return finish(won, hit, 'override', 1, true, 'NYC subunit collapsed to NYC Chancellor LEA');
  }
  if (override) {
    const hit = byLeaid.get(override.leaid) ?? null;
    return finish(won, hit, 'override', 1, true, override.reason);
  }

  const candidates = byState.get(normalizeState(won.state)) ?? [];
  if (candidates.length === 0) return finish(won, null, 'unmatched', 0, false);

  const canonical = won.canonical_name || canonicalDistrictName(won.district_name, won.state);
  const exact = candidates.filter((c) => c.canonical === canonical);
  if (exact.length === 1) return finish(won, exact[0]!.district, 'exact', 1, true);
  if (exact.length > 1) {
    const cityHits = exact.filter((c) => c.city && c.city === won.city);
    if (cityHits.length === 1) return finish(won, cityHits[0]!.district, 'city', 1, true);
    const zipHits = exact.filter((c) => c.zip && c.zip === won.zip);
    if (zipHits.length === 1) return finish(won, zipHits[0]!.district, 'city', 1, true);
  }

  const coreExact = uniqueBy(
    candidates.filter((c) => c.canonical === canonical || c.canonical.startsWith(`${canonical} `) || canonical.startsWith(`${c.canonical} `)),
    (c) => c.canonical,
  );
  if (coreExact.length === 1 && (coreExact[0]!.canonical === canonical || jaccard(tokenSet(won.district_name, won.state), coreExact[0]!.tokens) >= 0.8)) {
    return finish(won, coreExact[0]!.district, 'core', 0.95, true);
  }

  const bare = bareDistrictName(won.district_name, won.state);
  if (bare) {
    const bareHits = candidates.filter((c) => c.bare === bare);
    if (bareHits.length === 1) {
      return finish(won, bareHits[0]!.district, 'core', 0.9, true);
    }
    const cityBare = bareHits.filter((c) => won.city && c.city === won.city);
    if (cityBare.length === 1) {
      return finish(won, cityBare[0]!.district, 'city', 0.92, true);
    }
  }

  const tokens = tokenSet(won.district_name, won.state);
  const scored = candidates
    .map((c) => {
      let score = jaccard(tokens, c.tokens);
      if (won.city && c.city && won.city === c.city) score += 0.08;
      if (won.zip && c.zip && won.zip === c.zip) score += 0.1;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  const bareMatch = Boolean(bare && best && best.c.bare === bare);
  if (!best || (best.score < 0.65 && !bareMatch)) {
    return finish(won, null, 'unmatched', best?.score ?? 0, false);
  }

  const unique = !second || best.score - second.score >= 0.08;
  const method: MatchMethod = won.city && best.c.city === won.city ? 'city' : 'jaccard';
  if (!unique && best.score < 0.85) {
    return finish(won, best.c.district, method, best.score, false, 'ambiguous — close second candidate');
  }
  return finish(won, best.c.district, method, Math.min(1, best.score), unique);
}

export function matchDistricts(won: WonDistrict[], universe: CcdDistrict[]): DistrictMatch[] {
  const { byLeaid, byState } = indexCcd(universe);
  return won.map((row) => matchDistrict(row, byState, byLeaid));
}
