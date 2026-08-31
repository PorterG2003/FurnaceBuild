import { extname } from 'node:path';
import {
  blankRow,
  digits,
  hasPersonName,
  normalizeEmail,
  parseDelimited,
  parseTableBuffer,
  pickField,
  splitPersonName,
} from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function rowFromRecord(rec: Record<string, string>): StateDirectoryRow | null {
  const school = pickField(rec, [
    'sde_schooldistrictname',
    'School Name',
    'School',
    'Name',
    'Account Name',
    'Organization',
  ]);
  const district = pickField(rec, [
    'districts.sde_schooldistrictname',
    'District Name',
    'District',
    'Associated District Name',
  ]);
  // TNSD Excel uses the school as account name; skip district-only rows.
  const type = pickField(rec, ['mshied_schooltype', 'School Type', 'Type', 'customertypecode']);
  if (/\bdistrict\b/i.test(type) && !/\bschool\b/i.test(type)) return null;
  if (/\bprivate\b/i.test(type)) return null;
  const combined = pickField(rec, [
    'contact.fullname',
    'fullname',
    'Full Name',
    'Principal',
    'Principal Name',
    'Primary Contact',
    'Administrator',
  ]);
  const first = pickField(rec, ['First Name', 'Principal First Name']);
  const last = pickField(rec, ['Last Name', 'Principal Last Name']);
  const name = first && last ? { first, last } : splitPersonName(combined);
  if (!school) return null;
  const nces = digits(
    pickField(rec, ['sde_ncesnumber', 'NCES School No.', 'NCES School Number', 'NCES', 'NCES Number']),
  );
  const row = blankRow('TN');
  row.state_school_id = pickField(rec, [
    'sde_schooldistrictnumber',
    'School Number',
    'School No.',
    'School Code',
  ]);
  row.nces_school_id = nces.length >= 12 ? nces.slice(-12) : nces;
  row.district_name = district;
  row.school_name = school;
  row.city = pickField(rec, ['address1_city', 'City']);
  row.zip = pickField(rec, ['address1_postalcode', 'Zip', 'Zip Code', 'Postal Code']);
  row.first_name = name.first;
  row.last_name = name.last;
  row.title = pickField(rec, ['Title', 'Job Title']) || 'Principal';
  row.email = normalizeEmail(pickField(rec, ['contact.emailaddress1', 'emailaddress1', 'Email', 'E-mail', 'Email Address']));
  if (!hasPersonName(row)) return null;
  return row;
}

export async function parseTn(buffer: Buffer, path = ''): Promise<ParseResult> {
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
