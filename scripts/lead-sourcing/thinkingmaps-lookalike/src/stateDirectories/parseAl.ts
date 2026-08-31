import { extname } from 'node:path';
import {
  blankRow,
  hasPersonName,
  normalizeEmail,
  parseDelimited,
  parseTableBuffer,
  pickField,
  splitPersonName,
} from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function rowFromRecord(rec: Record<string, string>): StateDirectoryRow | null {
  const school = pickField(rec, ['School Name', 'Site Name', 'Name', 'Facility Name']);
  if (!school) return null;
  const combined = pickField(rec, ['Administrator', 'Administrator Name', 'Principal', 'Principal Name']);
  const first = pickField(rec, ['Administrator First Name', 'First Name']);
  const last = pickField(rec, ['Administrator Last Name', 'Last Name']);
  const name = first && last ? { first, last } : splitPersonName(combined);
  const row = blankRow('AL');
  row.state_school_id = pickField(rec, ['School Code', 'Site Code', 'Code']);
  row.district_name = pickField(rec, ['System Name', 'District Name', 'LEA', 'System']);
  row.school_name = school;
  row.city = pickField(rec, ['City']);
  row.zip = pickField(rec, ['Zip', 'Zip Code']);
  row.first_name = name.first;
  row.last_name = name.last;
  row.title = pickField(rec, ['Title', 'Administrator Title']) || 'Principal';
  row.email = normalizeEmail(pickField(rec, ['Email', 'Administrator Email', 'E-mail']));
  if (!hasPersonName(row)) return null;
  return row;
}

export async function parseAl(buffer: Buffer, path = ''): Promise<ParseResult> {
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
