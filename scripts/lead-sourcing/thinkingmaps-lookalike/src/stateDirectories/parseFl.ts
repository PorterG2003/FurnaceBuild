import { extname } from 'node:path';
import {
  blankRow,
  hasPersonName,
  parseDelimited,
  parseTableBuffer,
  pickField,
  splitPersonName,
} from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function rowFromRecord(rec: Record<string, string>): StateDirectoryRow | null {
  const school = pickField(rec, ['School Name', 'School', 'SchoolName', 'Site Name']);
  if (!school) return null;
  const first = pickField(rec, [
    'Principal First Name',
    "Principal's First Name",
    'Prin First Name',
    'Administrator First Name',
    'First Name',
  ]);
  const last = pickField(rec, [
    'Principal Last Name',
    "Principal's Last Name",
    'Prin Last Name',
    'Administrator Last Name',
    'Last Name',
  ]);
  const combined = pickField(rec, ['Principal', 'Principal Name', 'Administrator', 'Administrator Name']);
  const name = first && last ? { first, last } : splitPersonName(combined);
  const row = blankRow('FL');
  row.state_school_id = pickField(rec, ['School Number', 'School Code', 'MSID', 'School ID']);
  row.district_name = pickField(rec, ['District Name', 'District', 'DistrictName']);
  row.school_name = school;
  row.city = pickField(rec, ['City', 'School City', 'Mailing City']);
  row.zip = pickField(rec, ['Zip', 'Zip Code', 'School Zip']);
  row.first_name = name.first;
  row.last_name = name.last;
  row.title = pickField(rec, ['Title', 'Principal Title']) || 'Principal';
  row.email = pickField(rec, ['Email', 'Principal Email', 'E-mail']);
  if (!hasPersonName(row)) return null;
  return row;
}

export async function parseFl(buffer: Buffer, path = ''): Promise<ParseResult> {
  const ext = extname(path).toLowerCase();
  const records =
    ext === '.xlsx' || ext === '.xls' || (buffer[0] === 0x50 && buffer[1] === 0x4b)
      ? await parseTableBuffer(buffer)
      : parseDelimited(buffer.toString('utf8'));
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const row = rowFromRecord(rec);
    if (row) rows.push(row);
  }
  return { rows, districtStaff: [] };
}
