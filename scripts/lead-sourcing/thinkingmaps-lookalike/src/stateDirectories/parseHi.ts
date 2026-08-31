import { blankRow, extractJsArray, hasPersonName, normalizeEmail, splitPersonName } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

type HiSchool = {
  schoolId?: string;
  schoolName?: string;
  schoolCommonName?: string;
  districtName?: string;
  streetCity?: string;
  streetZip?: string;
  principal?: string;
  principalEmail?: string;
};

export function parseHi(html: string): ParseResult {
  const records = [
    ...extractJsArray<HiSchool>(html, 'schoolsA'),
    ...extractJsArray<HiSchool>(html, 'schoolsP'),
    ...extractJsArray<HiSchool>(html, 'schoolsC'),
  ];
  const seen = new Set<string>();
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const school = (rec.schoolName || rec.schoolCommonName || '').trim();
    const name = splitPersonName(rec.principal ?? '');
    const key = `${rec.schoolId ?? ''}|${school}|${name.first}|${name.last}`;
    if (!school || seen.has(key)) continue;
    seen.add(key);
    const row = blankRow('HI');
    row.state_school_id = rec.schoolId ?? '';
    row.district_name = rec.districtName ?? '';
    row.school_name = school;
    row.city = rec.streetCity ?? '';
    row.zip = rec.streetZip ?? '';
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = 'Principal';
    row.email = normalizeEmail(rec.principalEmail ?? '');
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
