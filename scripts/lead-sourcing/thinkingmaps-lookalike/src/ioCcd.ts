import { join } from 'node:path';
import { asGrade, asNumber } from './features.js';
import { loadJson, writeJson } from './lib/io.js';
import type { CcdDistrict } from './types.js';

export const WON_DISTRICT_COLUMNS = [
  'district_key',
  'district_name',
  'canonical_name',
  'state',
  'city',
  'zip',
  'street',
  'revenue',
  'account_count',
  'sample_account_ids',
  'is_charter',
  'is_nyc_subunit',
] as const;

export const MATCH_COLUMNS = [
  'district_key',
  'district_name',
  'state',
  'city',
  'zip',
  'revenue',
  'account_count',
  'is_charter',
  'is_nyc_subunit',
  'leaid',
  'nces_name',
  'nces_city',
  'nces_state',
  'confidence',
  'method',
  'score',
  'needs_review',
  'review_reason',
] as const;

export const LOOKALIKE_COLUMNS = [
  'rank',
  'leaid',
  'lea_name',
  'state',
  'city',
  'zip',
  'enrollment',
  'locale',
  'grade_span',
  'agency',
  'ell_share',
  'spec_ed_share',
  'poverty_share',
  'score',
  'reasons',
] as const;

export function ccdCachePaths(root: string): { directory: string; saipe: string } {
  return {
    directory: join(root, 'ccd-directory-2024.json'),
    saipe: join(root, 'saipe-2024.json'),
  };
}

export function loadCcdUniverse(dataPath: string): CcdDistrict[] {
  const rows = loadJson<CcdDistrict[]>(dataPath);
  if (!rows) throw new Error(`CCD universe not found: ${dataPath}`);
  return rows;
}

export function saveCcdUniverse(dataPath: string, rows: CcdDistrict[]): void {
  writeJson(dataPath, rows);
}

export function joinSaipe(
  directory: Array<Record<string, unknown>>,
  saipe: Array<Record<string, unknown>>,
): CcdDistrict[] {
  const poverty = new Map<string, number | null>();
  for (const row of saipe) {
    const leaid = String(row.leaid ?? '').padStart(7, '0');
    const pct = asNumber(row.est_population_5_17_poverty_pct);
    poverty.set(leaid, pct);
  }

  return directory.map((row) => {
    const leaid = String(row.leaid ?? '').padStart(7, '0');
    return {
      leaid,
      lea_name: String(row.lea_name ?? ''),
      state: String(row.state_location ?? row.state ?? ''),
      city: String(row.city_location ?? row.city ?? ''),
      zip: String(row.zip_location ?? row.zip ?? ''),
      enrollment: asNumber(row.enrollment),
      english_language_learners: asNumber(row.english_language_learners),
      spec_ed_students: asNumber(row.spec_ed_students),
      urban_centric_locale: asNumber(row.urban_centric_locale),
      agency_type: asNumber(row.agency_type),
      agency_charter_indicator: asNumber(row.agency_charter_indicator),
      lowest_grade_offered: asGrade(row.lowest_grade_offered),
      highest_grade_offered: asGrade(row.highest_grade_offered),
      number_of_schools: asNumber(row.number_of_schools),
      teachers_total_fte: asNumber(row.teachers_total_fte),
      latitude: asNumber(row.latitude),
      longitude: asNumber(row.longitude),
      county_code: String(row.county_code ?? ''),
      poverty_share: poverty.get(leaid) ?? null,
    };
  }).filter((row) => row.leaid && row.lea_name);
}

/** 2024 CCD directory leaves ELL/spec-ed empty; join an older directory year by leaid. */
export function attachEllSpec(
  districts: CcdDistrict[],
  priorDirectory: Array<Record<string, unknown>>,
): CcdDistrict[] {
  const byId = new Map<string, { ell: number | null; spec: number | null }>();
  for (const row of priorDirectory) {
    const leaid = String(row.leaid ?? '').padStart(7, '0');
    byId.set(leaid, {
      ell: asNumber(row.english_language_learners),
      spec: asNumber(row.spec_ed_students),
    });
  }
  return districts.map((d) => {
    if (d.english_language_learners != null && d.spec_ed_students != null) return d;
    const extra = byId.get(d.leaid);
    if (!extra) return d;
    return {
      ...d,
      english_language_learners: d.english_language_learners ?? extra.ell,
      spec_ed_students: d.spec_ed_students ?? extra.spec,
    };
  });
}
