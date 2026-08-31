import {
  blankRow,
  digits,
  hasPersonName,
  ncesFromParts,
  normalizeEmail,
  parseTableBuffer,
  pickField,
  splitPersonName,
} from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

export async function parseNv(buffer: Buffer): Promise<ParseResult> {
  const records = await parseTableBuffer(buffer);
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const school = pickField(rec, ['Name', 'School Name', 'Abbreviated Name']);
    if (!school) continue;
    const combined = pickField(rec, ['Principal Name', 'Principal']);
    const first = pickField(rec, ['Principal First Name']);
    const last = pickField(rec, ['Principal Last Name']);
    const name = first && last ? { first, last } : splitPersonName(combined);
    const ncesSchool = digits(pickField(rec, ['NCES School ID', 'NCES SchoolID', 'NCESSchoolID']));
    const ncesDist = digits(pickField(rec, ['NCES DistrictID', 'NCES District ID', 'NCESDistrictID']));
    const row = blankRow('NV');
    row.state_school_id = pickField(rec, ['State School Code', 'School Code']);
    row.nces_school_id = ncesSchool.length >= 12 ? ncesSchool.slice(-12) : ncesFromParts(ncesDist, ncesSchool);
    row.district_name = pickField(rec, ['Master District Code', 'State District Code', 'District']);
    row.school_name = school;
    row.city = pickField(rec, ['City']);
    row.zip = pickField(rec, ['Zip', 'Zip Code']);
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = 'Principal';
    row.email = normalizeEmail(pickField(rec, ['Principal Email', 'Principal Email Address', 'Email']));
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
