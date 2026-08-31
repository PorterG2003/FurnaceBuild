import { blankRow, hasPersonName, parseDelimited, pickField } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

export function parseKy(text: string): ParseResult {
  const records = parseDelimited(text);
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const school = pickField(rec, ['School Name', 'School']);
    if (!school) continue;
    const row = blankRow('KY');
    row.state_school_id = pickField(rec, ['School Code', 'SchoolCode']);
    row.district_name = pickField(rec, ['District Name', 'District']);
    row.school_name = school;
    row.city = pickField(rec, ['City']);
    row.zip = pickField(rec, ['Zipcode', 'Zip Code', 'Zip']);
    row.first_name = pickField(rec, ['Principal First Name', 'First Name']);
    row.last_name = pickField(rec, ['Principal Last Name', 'Last Name']);
    row.title = pickField(rec, ['Role Title', 'Title']) || 'Principal';
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
