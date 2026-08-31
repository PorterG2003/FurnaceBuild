import { blankRow, digits, hasPersonName, normalizeEmail, pickField, recordsFromWorkbook, splitPersonName } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function isSchoolEntity(rec: Record<string, string>): boolean {
  const recType = pickField(rec, ['RecType', 'Rec Type', 'Record Type']).toLowerCase();
  if (recType === 'dist' || recType === 'district') return false;
  if (recType.includes('dist') && !recType.includes('sch')) return false;
  const type = pickField(rec, ['Type', 'Entity Type', 'Category', 'School Type']).toLowerCase();
  const schoolCode = pickField(rec, ['School', 'School Code', 'School Number']);
  const rcdts = pickField(rec, ['RCDTS', 'RCDTS Code']);
  if (/\bdistrict\b/.test(type) && !/\bschool\b/.test(type)) return false;
  if (digits(schoolCode) && /^0+$/.test(digits(schoolCode))) return false;
  if (rcdts && /0000$/.test(digits(rcdts))) return false;
  const name = pickField(rec, ['Facility Name', 'FacilityName', 'School Name', 'Entity Name', 'Name']);
  if (/\bdistrict office\b/i.test(name)) return false;
  if (recType === 'sch' || recType.includes('sch')) return Boolean(name);
  return Boolean(name);
}

export async function parseIl(buffer: Buffer): Promise<ParseResult> {
  const records = await recordsFromWorkbook(buffer, ['public dist', 'public sch', 'dist & sch']);
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    if (!isSchoolEntity(rec)) continue;
    const admin = pickField(rec, ['Administrator', 'Administrator Name', 'Admin Name', 'Principal']);
    const first = pickField(rec, ['Administrator First Name', 'Admin First Name', 'First Name', 'Principal First Name']);
    const last = pickField(rec, ['Administrator Last Name', 'Admin Last Name', 'Last Name', 'Principal Last Name']);
    const name = first && last ? { first, last } : splitPersonName(admin);
    const nces = digits(pickField(rec, ['NCES ID', 'NCESID', 'NCES School ID', 'NCES']));
    const row = blankRow('IL');
    row.state_school_id = pickField(rec, ['RCDTS', 'RCDTS Code']) || pickField(rec, ['School', 'School Code']);
    row.nces_school_id = nces.length >= 12 ? nces.slice(-12) : '';
    row.district_name = pickField(rec, ['District Name', 'District', 'Parent Entity']);
    row.school_name = pickField(rec, ['Facility Name', 'FacilityName', 'School Name', 'Entity Name', 'Name']);
    row.city = pickField(rec, ['City', 'Physical City']);
    row.zip = pickField(rec, ['Zip', 'Zip Code']);
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = pickField(rec, ['Title', 'Administrator Title']) || 'Principal';
    row.email = normalizeEmail(pickField(rec, ['Email', 'Administrator Email', 'Admin Email', 'E-mail']));
    if (!hasPersonName(row) || !row.school_name) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
