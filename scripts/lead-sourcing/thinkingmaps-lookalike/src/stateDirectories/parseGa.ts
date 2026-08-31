import { blankRow, hasPersonName, parseDelimited, pickField, splitPersonName, stripLeadingCode } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

export function parseGa(text: string): ParseResult {
  const records = parseDelimited(text);
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const school = stripLeadingCode(pickField(rec, ['School', 'School Name']));
    if (!school) continue;
    const first = pickField(rec, ['Principal Name', 'Principal First Name', 'First Name']);
    const last = pickField(rec, ['Principal Last Name', 'Last Name']);
    const name = first && last ? { first: first.trim(), last: last.trim() } : splitPersonName(first || last);
    const row = blankRow('GA');
    row.state_school_id = (pickField(rec, ['School', 'School Name']).match(/^\d+/) ?? [''])[0];
    row.district_name = stripLeadingCode(pickField(rec, ['District', 'District Name']));
    row.school_name = school;
    row.city = pickField(rec, ['School City', 'City']);
    row.zip = pickField(rec, ['School Zip', 'Zip', 'Zip Code']);
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = pickField(rec, ['Principal Title', 'Title']) || 'Principal';
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
