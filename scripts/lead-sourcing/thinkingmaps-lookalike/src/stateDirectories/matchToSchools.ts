import {
  bareSchoolName,
  canonicalSchoolName,
  jaccard,
  normalizeCity,
  padNcessch,
  schoolTokenSet,
  zip5,
} from '../schoolNames.js';
import type { ListedSchool } from '../types.js';
import { hasPersonName } from './parse.js';
import type { MatchStatus, MatchedStateRow, StateDirectoryRow } from './types.js';

type Candidate = {
  school: ListedSchool;
  canonical: string;
  bare: string;
  tokens: Set<string>;
  city: string;
  zip: string;
  district: string;
};

export type SchoolMatchHit = {
  school: ListedSchool | null;
  status: MatchStatus;
  method: string;
  score: number;
};

function indexSchools(schools: ListedSchool[]): Candidate[] {
  return schools.map((school) => ({
    school,
    canonical: canonicalSchoolName(school.school_name, school.state),
    bare: bareSchoolName(school.school_name, school.state),
    tokens: schoolTokenSet(school.school_name, school.state),
    city: normalizeCity(school.city),
    zip: zip5(school.zip),
    district: canonicalSchoolName(school.lea_name, school.state),
  }));
}

function uniqueOrAmbiguous(
  hits: Candidate[],
  method: string,
  score: number,
): SchoolMatchHit {
  if (hits.length === 1) return { school: hits[0]!.school, status: 'matched', method, score };
  if (hits.length > 1) return { school: hits[0]!.school, status: 'ambiguous', method, score };
  return { school: null, status: 'unmatched', method: '', score: 0 };
}

export function matchStateRow(row: StateDirectoryRow, schools: ListedSchool[]): SchoolMatchHit {
  const nces = padNcessch(row.nces_school_id);
  if (nces) {
    const hit = schools.find((school) => school.ncessch === nces);
    if (hit) return { school: hit, status: 'matched', method: 'nces', score: 1 };
    return { school: null, status: 'unmatched', method: 'nces', score: 0 };
  }

  const inState = schools.filter((school) => school.state === row.source_state);
  const candidates = indexSchools(inState);
  if (candidates.length === 0) return { school: null, status: 'unmatched', method: '', score: 0 };

  const canonical = canonicalSchoolName(row.school_name, row.source_state);
  const city = normalizeCity(row.city);
  const zip = zip5(row.zip);
  const district = canonicalSchoolName(row.district_name, row.source_state);

  const exact = candidates.filter((c) => c.canonical === canonical);
  if (exact.length === 1) return { school: exact[0]!.school, status: 'matched', method: 'exact', score: 1 };
  if (exact.length > 1) {
    const cityHits = exact.filter((c) => city && c.city === city);
    if (cityHits.length === 1) return { school: cityHits[0]!.school, status: 'matched', method: 'city', score: 1 };
    const zipHits = exact.filter((c) => zip && c.zip === zip);
    if (zipHits.length === 1) return { school: zipHits[0]!.school, status: 'matched', method: 'zip', score: 1 };
    const distHits = exact.filter((c) => district && c.district === district);
    if (distHits.length === 1) return { school: distHits[0]!.school, status: 'matched', method: 'district', score: 1 };
    return uniqueOrAmbiguous(exact, 'exact', 1);
  }

  const bare = bareSchoolName(row.school_name, row.source_state);
  if (bare) {
    const bareHits = candidates.filter((c) => c.bare === bare);
    if (bareHits.length === 1) return { school: bareHits[0]!.school, status: 'matched', method: 'bare', score: 0.92 };
    const cityBare = bareHits.filter((c) => city && c.city === city);
    if (cityBare.length === 1) return { school: cityBare[0]!.school, status: 'matched', method: 'city', score: 0.94 };
    const distBare = bareHits.filter((c) => district && c.district === district);
    if (distBare.length === 1) return { school: distBare[0]!.school, status: 'matched', method: 'district', score: 0.93 };
  }

  const tokens = schoolTokenSet(row.school_name, row.source_state);
  const scored = candidates
    .map((c) => {
      let score = jaccard(tokens, c.tokens);
      if (city && c.city === city) score += 0.08;
      if (zip && c.zip === zip) score += 0.1;
      if (district && c.district === district) score += 0.06;
      return { c, score: Math.min(1, score) };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 0.65) {
    return { school: null, status: 'unmatched', method: 'jaccard', score: best?.score ?? 0 };
  }
  const unique = !second || best.score - second.score >= 0.08;
  if (!unique) {
    return { school: best.c.school, status: 'ambiguous', method: 'jaccard', score: best.score };
  }
  return { school: best.c.school, status: 'matched', method: 'jaccard', score: best.score };
}

export function matchToSchools(rows: StateDirectoryRow[], schools: ListedSchool[]): MatchedStateRow[] {
  return rows.map((row) => {
    if (!hasPersonName(row) || !row.school_name.trim()) {
      return {
        ...row,
        match_status: 'unmatched',
        ncessch: '',
        leaid: '',
        matched_school_name: '',
        match_score: '0',
        match_method: 'missing_name_or_school',
      };
    }
    const hit = matchStateRow(row, schools);
    return {
      ...row,
      match_status: hit.status,
      ncessch: hit.school?.ncessch ?? '',
      leaid: hit.school?.leaid ?? '',
      matched_school_name: hit.school?.school_name ?? '',
      match_score: hit.score.toFixed(4),
      match_method: hit.method,
    };
  });
}
