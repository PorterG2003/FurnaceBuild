import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadJson, writeJson } from './lib/io.js';
import { padLeaid, padNcessch, normalizeState, zip5 } from './schoolNames.js';
import type { CcdSchool } from './types.js';

export const SCHOOL_LIST_COLUMNS = [
  'ncessch',
  'leaid',
  'school_name',
  'lea_name',
  'state',
  'city',
  'zip',
  'excluded',
  'exclude_reason',
  'won_account_id',
  'won_account_name',
  'match_confidence',
  'match_score',
] as const;

export const SCHOOL_MATCH_COLUMNS = [
  'account_id',
  'account_name',
  'parent_account',
  'city',
  'state',
  'zip',
  'revenue',
  'leaid',
  'lea_name',
  'ncessch',
  'nces_school_name',
  'nces_city',
  'confidence',
  'method',
  'score',
  'needs_review',
  'review_reason',
] as const;

export const QUICKENRICH_INPUT_COLUMNS = [
  'ncessch',
  'leaid',
  'school_name',
  'lea_name',
  'city',
  'state',
  'zip',
  'title_priority_1',
  'title_priority_2',
  'title_priority_3',
  'requested_roles',
] as const;

export const CONTACT_COLUMNS = [
  'ncessch',
  'leaid',
  'school_name',
  'slot',
  'role',
  'first_name',
  'last_name',
  'title',
  'email',
  'linkedin_url',
  'company',
  'phone',
  'provider',
  'email_risk',
  'person_id',
  'pick_reason',
] as const;

export const COVERAGE_COLUMNS = [
  'ncessch',
  'leaid',
  'school_name',
  'state',
  'city',
  'contact_count',
  'has_curriculum',
  'has_assistant_principal',
  'has_principal',
  'providers',
] as const;

export const TITLE_PRIORITY_1 = 'Instructional Coach / Curriculum Coordinator / Director of Curriculum';
export const TITLE_PRIORITY_2 = 'Assistant Principal / Vice Principal';
export const TITLE_PRIORITY_3 = 'Principal';

type RawSchool = {
  ncessch?: string | number;
  leaid?: string | number;
  school_name?: string;
  state_location?: string;
  city_location?: string;
  zip_location?: string;
  state?: string;
  city?: string;
  zip?: string;
};

export function normalizeCcdSchool(row: RawSchool): CcdSchool | null {
  const ncessch = padNcessch(String(row.ncessch ?? ''));
  const leaid = padLeaid(String(row.leaid ?? ''));
  const school_name = String(row.school_name ?? '').trim();
  if (!ncessch || !leaid || !school_name) return null;
  return {
    ncessch,
    leaid,
    school_name,
    state: normalizeState(String(row.state_location ?? row.state ?? '')),
    city: String(row.city_location ?? row.city ?? '').trim(),
    zip: zip5(String(row.zip_location ?? row.zip ?? '')),
  };
}

export function loadCcdSchools(path: string): CcdSchool[] {
  const rows = loadJson<RawSchool[]>(path);
  if (!rows) throw new Error(`CCD schools not found: ${path}`);
  return rows.map(normalizeCcdSchool).filter((row): row is CcdSchool => Boolean(row));
}

export function saveCcdSchools(path: string, rows: CcdSchool[]): void {
  writeJson(path, rows);
}

export function schoolsByLeaid(schools: CcdSchool[]): Map<string, CcdSchool[]> {
  const map = new Map<string, CcdSchool[]>();
  for (const school of schools) {
    const list = map.get(school.leaid) ?? [];
    list.push(school);
    map.set(school.leaid, list);
  }
  return map;
}

export function resolveSchoolsPath(options: {
  explicit?: string;
  fixtures: boolean;
  fixturePath: string;
  livePath: string;
}): string {
  if (options.explicit) return options.explicit;
  if (options.fixtures) return options.fixturePath;
  if (existsSync(options.livePath)) return options.livePath;
  return options.fixturePath;
}

export function defaultSchoolCachePath(dataDir: string): string {
  return join(dataDir, 'ccd-schools-2024.json');
}
