import { blankRow, cleanPersonToken, digits, hasPersonName, ncesFromParts, parseDelimited, pickField } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function isDistrictCds(cds: string): boolean {
  const value = digits(cds);
  return value.length >= 7 && value.endsWith('0000000');
}

export function parseCa(text: string): ParseResult {
  const records = parseDelimited(text);
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const status = pickField(rec, ['StatusType', 'Status Type', 'Status']).toLowerCase();
    if (status && status !== 'active') continue;
    const cds = pickField(rec, ['CDSCode', 'CDS Code', 'CDS']);
    if (isDistrictCds(cds)) continue;
    const school = pickField(rec, ['School', 'SchoolName', 'School Name']);
    if (!school) continue;
    const row = blankRow('CA');
    row.state_school_id = cds;
    row.nces_school_id = ncesFromParts(
      pickField(rec, ['NCESDist', 'NCES Dist', 'NCES District']),
      pickField(rec, ['NCESSchool', 'NCES School']),
    );
    row.district_name = pickField(rec, ['District', 'DistrictName', 'District Name']);
    row.school_name = school;
    row.city = pickField(rec, ['City', 'MailCity']);
    row.zip = pickField(rec, ['Zip', 'MailZip']);
    row.first_name = cleanPersonToken(pickField(rec, ['AdmFName', 'Adm FName', 'Administrator First Name']));
    row.last_name = cleanPersonToken(pickField(rec, ['AdmLName', 'Adm LName', 'Administrator Last Name']));
    row.title = 'Principal';
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
