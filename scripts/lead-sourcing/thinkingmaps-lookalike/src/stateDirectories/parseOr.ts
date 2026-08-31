import {
  blankRow,
  hasPersonName,
  parseTableBuffer,
  pickField,
  splitPersonName,
} from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

const SCHOOL_TYPE = /^(regular school|oregon public school|elementary|middle school|high school|charter school|public charter)$/i;

export async function parseOr(buffer: Buffer): Promise<ParseResult> {
  const records = await parseTableBuffer(buffer, 'Institutions');
  const rows: StateDirectoryRow[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const type = pickField(rec, ['Type', 'Class']);
    if (!SCHOOL_TYPE.test(type.trim())) continue;
    const school = pickField(rec, ['Directory_Name', 'Name', 'School Name']);
    if (!school) continue;
    const director = pickField(rec, ['Director_Name', 'Director Name', 'Administrator']);
    if (!director || /school district|esd\b|education service/i.test(director)) continue;
    const name = splitPersonName(director);
    const key = `${school}|${name.first}|${name.last}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = blankRow('OR');
    row.state_school_id = pickField(rec, ['Iid', 'Institution ID']);
    row.school_name = school;
    row.city = pickField(rec, ['Street_City', 'Mail_City', 'City']);
    row.zip = pickField(rec, ['Street_Zip', 'Mail_Zip', 'Zip']);
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = 'Principal';
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
