import { join } from 'node:path';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import { writeJson } from './lib/io.js';
import { MATCH_COLUMNS } from './ioCcd.js';
import {
  QUICKENRICH_INPUT_COLUMNS,
  SCHOOL_LIST_COLUMNS,
  SCHOOL_MATCH_COLUMNS,
  TITLE_PRIORITY_1,
  TITLE_PRIORITY_2,
  TITLE_PRIORITY_3,
  loadCcdSchools,
  schoolsByLeaid,
} from './ioSchools.js';
import { excludedWonNcessch, matchWonSchools } from './matchSchools.js';
import { loadMatchesCsv } from './profile.js';
import { parseWonAccountRow } from './rollup.js';
import { padLeaid } from './schoolNames.js';
import type { CcdSchool, DistrictMatch, ListedSchool, SchoolMatch } from './types.js';

export function wonLeaids(matches: DistrictMatch[]): Map<string, DistrictMatch> {
  const map = new Map<string, DistrictMatch>();
  for (const match of matches) {
    if (!match.leaid) continue;
    if (match.confidence !== 'high' && match.confidence !== 'medium') continue;
    const leaid = padLeaid(match.leaid);
    const existing = map.get(leaid);
    if (!existing || match.revenue > existing.revenue) map.set(leaid, { ...match, leaid });
  }
  return map;
}

export function listSchoolsInWonDistricts(
  schools: CcdSchool[],
  districts: Map<string, DistrictMatch>,
): ListedSchool[] {
  const listed: ListedSchool[] = [];
  for (const school of schools) {
    const district = districts.get(school.leaid);
    if (!district) continue;
    listed.push({
      ...school,
      lea_name: district.nces_name || district.district_name,
      excluded: false,
      exclude_reason: '',
      won_account_id: '',
      won_account_name: '',
      match_confidence: '',
      match_score: '',
    });
  }
  return listed.sort(
    (a, b) => a.lea_name.localeCompare(b.lea_name) || a.school_name.localeCompare(b.school_name),
  );
}

export function applyWonSchoolExclusions(
  listed: ListedSchool[],
  schoolMatches: SchoolMatch[],
): ListedSchool[] {
  const excluded = excludedWonNcessch(schoolMatches);
  return listed.map((school) => {
    const hit = excluded.get(school.ncessch);
    if (!hit) return school;
    return {
      ...school,
      excluded: true,
      exclude_reason: 'closed_won_school',
      won_account_id: hit.account_id,
      won_account_name: hit.account_name,
      match_confidence: hit.confidence,
      match_score: hit.score.toFixed(4),
    };
  });
}

export function eligibleSchools(listed: ListedSchool[]): ListedSchool[] {
  return listed.filter((row) => !row.excluded);
}

export function loadListedSchools(path: string): ListedSchool[] {
  return readCsv(path).map((row) => ({
    ncessch: row.ncessch,
    leaid: row.leaid,
    school_name: row.school_name,
    state: row.state,
    city: row.city,
    zip: row.zip,
    lea_name: row.lea_name,
    excluded: row.excluded === 'true',
    exclude_reason: row.exclude_reason ?? '',
    won_account_id: row.won_account_id ?? '',
    won_account_name: row.won_account_name ?? '',
    match_confidence: row.match_confidence ?? '',
    match_score: row.match_score ?? '',
  }));
}

export function writeQuickEnrichInput(path: string, schools: ListedSchool[]): void {
  const rows = schools.map((school) =>
    rowToRecord({
      ncessch: school.ncessch,
      leaid: school.leaid,
      school_name: school.school_name,
      lea_name: school.lea_name,
      city: school.city,
      state: school.state,
      zip: school.zip,
      title_priority_1: TITLE_PRIORITY_1,
      title_priority_2: TITLE_PRIORITY_2,
      title_priority_3: TITLE_PRIORITY_3,
      requested_roles: 'curriculum;assistant_principal;principal',
    }),
  );
  writeCsv(path, rows, QUICKENRICH_INPUT_COLUMNS);
}

export function buildSchoolUniverse(options: {
  runDir: string;
  matchesPath: string;
  schoolsPath: string;
  closedWonCsv: string;
}): {
  listed: ListedSchool[];
  eligible: ListedSchool[];
  schoolMatches: SchoolMatch[];
} {
  const matches = loadMatchesCsv(options.matchesPath);
  const districts = wonLeaids(matches);
  const schools = loadCcdSchools(options.schoolsPath);
  const accounts = readCsv(options.closedWonCsv).map(parseWonAccountRow);
  const schoolMatches = matchWonSchools({
    accounts,
    matches,
    byLeaid: schoolsByLeaid(schools),
  });
  const listed = applyWonSchoolExclusions(listSchoolsInWonDistricts(schools, districts), schoolMatches);
  const eligible = eligibleSchools(listed);

  writeCsv(
    join(options.runDir, 'schools_in_won_districts.csv'),
    listed.map((row) => rowToRecord(row)),
    SCHOOL_LIST_COLUMNS,
  );
  writeCsv(
    join(options.runDir, 'eligible_schools.csv'),
    eligible.map((row) => rowToRecord(row)),
    SCHOOL_LIST_COLUMNS,
  );
  writeCsv(
    join(options.runDir, 'won_school_matches.csv'),
    schoolMatches.map((row) => rowToRecord(row)),
    SCHOOL_MATCH_COLUMNS,
  );
  const review = schoolMatches.filter((row) => row.needs_review);
  writeCsv(
    join(options.runDir, 'won_school_match_review.csv'),
    review.map((row) => rowToRecord(row)),
    SCHOOL_MATCH_COLUMNS,
  );
  writeQuickEnrichInput(join(options.runDir, 'quickenrich_school_input.csv'), eligible);
  writeCsv(
    join(options.runDir, 'won_district_matches.csv'),
    [...districts.values()].map((row) => rowToRecord(row)),
    MATCH_COLUMNS,
  );
  writeJson(join(options.runDir, 'school_universe_summary.json'), {
    won_districts: districts.size,
    schools_in_won_districts: listed.length,
    excluded_closed_won_schools: listed.filter((row) => row.excluded).length,
    eligible_schools: eligible.length,
    school_account_candidates: schoolMatches.length,
    high_confidence_school_matches: schoolMatches.filter((row) => row.confidence === 'high').length,
    review_rows: review.length,
    max_contacts_at_3: eligible.length * 3,
  });
  return { listed, eligible, schoolMatches };
}
