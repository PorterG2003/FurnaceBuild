import { isTestAccount, isVagueParent, looksLikeDistrictName } from './names.js';
import { districtKey, districtNameForAccount } from './rollup.js';
import {
  bareSchoolName,
  canonicalSchoolName,
  looksLikeSchoolName,
  padLeaid,
  schoolTokenSet,
  jaccard,
  normalizeCity,
  zip5,
} from './schoolNames.js';
import type {
  CcdSchool,
  DistrictMatch,
  MatchConfidence,
  SchoolMatch,
  SchoolMatchMethod,
  WonAccountRow,
} from './types.js';

type SchoolCandidate = {
  school: CcdSchool;
  canonical: string;
  bare: string;
  tokens: Set<string>;
  city: string;
  zip: string;
};

export function isSchoolAccount(account: WonAccountRow): boolean {
  if (isTestAccount(account.account_name)) return false;
  const parentVague = isVagueParent(account.parent_account, account.account_name);
  const nameIsDistrict = looksLikeDistrictName(account.account_name);
  const nameIsSchool = looksLikeSchoolName(account.account_name);
  if (!parentVague) {
    if (nameIsDistrict && !nameIsSchool) return false;
    return true;
  }
  return nameIsSchool && !nameIsDistrict;
}

export function indexDistrictMatches(matches: DistrictMatch[]): Map<string, DistrictMatch> {
  const map = new Map<string, DistrictMatch>();
  for (const match of matches) {
    if (!match.leaid) continue;
    if (match.confidence !== 'high' && match.confidence !== 'medium') continue;
    map.set(match.district_key, match);
    map.set(districtKey(match.district_name, match.state), match);
  }
  return map;
}

export function districtMatchForAccount(
  account: WonAccountRow,
  byKey: Map<string, DistrictMatch>,
): DistrictMatch | null {
  const name = districtNameForAccount(account);
  const key = districtKey(name, account.state);
  return byKey.get(key) ?? byKey.get(districtKey(account.account_name, account.state)) ?? null;
}

function indexSchools(schools: CcdSchool[]): SchoolCandidate[] {
  return schools.map((school) => ({
    school,
    canonical: canonicalSchoolName(school.school_name, school.state),
    bare: bareSchoolName(school.school_name, school.state),
    tokens: schoolTokenSet(school.school_name, school.state),
    city: normalizeCity(school.city),
    zip: zip5(school.zip),
  }));
}

function confidenceFor(method: SchoolMatchMethod, score: number, unique: boolean): MatchConfidence {
  if (method === 'unmatched') return 'none';
  if (!unique) return score >= 0.7 ? 'medium' : 'low';
  if (method === 'exact') return 'high';
  if (method === 'bare') return 'high';
  if (method === 'city' && score >= 0.85) return 'high';
  if (score >= 0.9) return 'high';
  if (score >= 0.75) return 'medium';
  if (score >= 0.7) return 'medium';
  return 'low';
}

function finish(
  account: WonAccountRow,
  district: DistrictMatch | null,
  hit: CcdSchool | null,
  method: SchoolMatchMethod,
  score: number,
  unique: boolean,
  reviewReason = '',
): SchoolMatch {
  const confidence = confidenceFor(method, score, unique);
  return {
    account_id: account.account_id,
    account_name: account.account_name,
    parent_account: account.parent_account,
    city: account.city,
    state: account.state,
    zip: account.zip,
    revenue: account.revenue,
    leaid: hit?.leaid ?? district?.leaid ?? '',
    lea_name: district?.nces_name ?? '',
    ncessch: hit?.ncessch ?? '',
    nces_school_name: hit?.school_name ?? '',
    nces_city: hit?.city ?? '',
    confidence,
    method,
    score,
    needs_review: method === 'unmatched' || confidence !== 'high' || Boolean(reviewReason),
    review_reason:
      reviewReason ||
      (method === 'unmatched'
        ? district
          ? 'no nces school match in district'
          : 'parent district not matched'
        : confidence !== 'high'
          ? 'low/medium confidence school match'
          : ''),
  };
}

export function matchSchoolInDistrict(account: WonAccountRow, schools: CcdSchool[]): {
  school: CcdSchool | null;
  method: SchoolMatchMethod;
  score: number;
  unique: boolean;
  reason: string;
} {
  const candidates = indexSchools(schools);
  if (candidates.length === 0) {
    return { school: null, method: 'unmatched', score: 0, unique: false, reason: 'district has no schools' };
  }

  const canonical = canonicalSchoolName(account.account_name, account.state);
  const exact = candidates.filter((c) => c.canonical === canonical);
  if (exact.length === 1) return { school: exact[0]!.school, method: 'exact', score: 1, unique: true, reason: '' };
  if (exact.length > 1) {
    const cityHits = exact.filter((c) => c.city && c.city === normalizeCity(account.city));
    if (cityHits.length === 1) {
      return { school: cityHits[0]!.school, method: 'city', score: 1, unique: true, reason: '' };
    }
    const zipHits = exact.filter((c) => c.zip && c.zip === zip5(account.zip));
    if (zipHits.length === 1) {
      return { school: zipHits[0]!.school, method: 'city', score: 1, unique: true, reason: '' };
    }
    return {
      school: exact[0]!.school,
      method: 'exact',
      score: 1,
      unique: false,
      reason: 'ambiguous — close second school',
    };
  }

  const bare = bareSchoolName(account.account_name, account.state);
  if (bare) {
    const bareHits = candidates.filter((c) => c.bare === bare);
    if (bareHits.length === 1) {
      return { school: bareHits[0]!.school, method: 'bare', score: 0.92, unique: true, reason: '' };
    }
    const cityBare = bareHits.filter((c) => account.city && c.city === normalizeCity(account.city));
    if (cityBare.length === 1) {
      return { school: cityBare[0]!.school, method: 'city', score: 0.94, unique: true, reason: '' };
    }
  }

  const tokens = schoolTokenSet(account.account_name, account.state);
  const scored = candidates
    .map((c) => {
      let score = jaccard(tokens, c.tokens);
      if (account.city && c.city && normalizeCity(account.city) === c.city) score += 0.08;
      if (account.zip && c.zip && zip5(account.zip) === c.zip) score += 0.1;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 0.65) {
    return { school: null, method: 'unmatched', score: best?.score ?? 0, unique: false, reason: '' };
  }
  const unique = !second || best.score - second.score >= 0.08;
  const method: SchoolMatchMethod = account.city && best.c.city === normalizeCity(account.city) ? 'city' : 'jaccard';
  if (!unique) {
    return {
      school: best.c.school,
      method,
      score: Math.min(1, best.score),
      unique: false,
      reason: 'ambiguous — close second school',
    };
  }
  return { school: best.c.school, method, score: Math.min(1, best.score), unique: true, reason: '' };
}

export function matchWonSchools(options: {
  accounts: WonAccountRow[];
  matches: DistrictMatch[];
  byLeaid: Map<string, CcdSchool[]>;
}): SchoolMatch[] {
  const byKey = indexDistrictMatches(options.matches);
  const out: SchoolMatch[] = [];
  for (const account of options.accounts) {
    if (!isSchoolAccount(account)) continue;
    const district = districtMatchForAccount(account, byKey);
    if (!district) {
      out.push(finish(account, null, null, 'unmatched', 0, false, 'parent district not matched'));
      continue;
    }
    const schools = options.byLeaid.get(padLeaid(district.leaid)) ?? [];
    const hit = matchSchoolInDistrict(account, schools);
    out.push(finish(account, district, hit.school, hit.method, hit.score, hit.unique, hit.reason));
  }
  return out;
}

export function excludedWonNcessch(matches: SchoolMatch[]): Map<string, SchoolMatch> {
  const map = new Map<string, SchoolMatch>();
  for (const match of matches) {
    if (match.confidence === 'high' && match.ncessch) map.set(match.ncessch, match);
  }
  return map;
}
