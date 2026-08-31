import { blankRow, hasPersonName, normalizeEmail, parseDelimited, pickField } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function sliceFromHeader(text: string): string {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const idx = lines.findIndex((line) => /last[_\s-]*name/i.test(line) && /first[_\s-]*name/i.test(line));
  return idx >= 0 ? lines.slice(idx).join('\n') : text;
}

function isPrincipalRole(title: string): boolean {
  return /principal/i.test(title);
}

export function parseId(text: string): ParseResult {
  const records = parseDelimited(sliceFromHeader(text));
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    const title = pickField(rec, ['Position', 'Title', 'Role']);
    if (!isPrincipalRole(title)) continue;
    const school = pickField(rec, ['School Name', 'School', 'School_Name']);
    if (!school || /administration building/i.test(school)) continue;
    const row = blankRow('ID');
    row.state_school_id = pickField(rec, ['School ID', 'SchoolID', 'School_ID']);
    row.district_name = pickField(rec, ['District Name', 'District', 'District_Name']);
    row.school_name = school;
    row.city = pickField(rec, ['City']);
    row.zip = pickField(rec, ['Zip', 'Zip Code', 'Zip1']);
    row.first_name = pickField(rec, ['First Name', 'First_Name']);
    row.last_name = pickField(rec, ['Last Name', 'Last_Name', 'Last_Name1']);
    row.title = title || 'Principal';
    row.email = normalizeEmail(pickField(rec, ['Email', 'E-mail']));
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
