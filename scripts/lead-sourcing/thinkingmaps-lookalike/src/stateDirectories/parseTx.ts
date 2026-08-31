import { blankRow, hasPersonName, normalizeEmail, parseDelimited, pickField, splitPersonName } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

function orgLooksLikeSchool(rec: Record<string, string>): boolean {
  const type = pickField(rec, ['Organization Type', 'Org Type', 'Type', 'Campus Type']).toLowerCase();
  const campus = pickField(rec, ['Campus Name', 'School Name', 'Organization Name', 'Campus']);
  const campusNumber = pickField(rec, ['Campus Number', 'School Number', 'Organization Number']);
  if (/\bdistrict\b/.test(type) && !/\b(school|campus)\b/.test(type)) return false;
  if (/\b(school|campus)\b/.test(type)) return true;
  if (campusNumber && campusNumber !== pickField(rec, ['District Number', 'County District Number'])) return true;
  return Boolean(campus.trim());
}

function looksLikePrincipal(title: string): boolean {
  const value = title.toLowerCase();
  if (!value) return true;
  if (/\bsuperintendent\b/.test(value) && !/\bprincipal\b/.test(value)) return false;
  return /\bprincipal\b/.test(value);
}

export function parseTx(text: string): ParseResult {
  const records = parseDelimited(text);
  const rows: StateDirectoryRow[] = [];
  const districtStaff: StateDirectoryRow[] = [];
  for (const rec of records) {
    const title = pickField(rec, ['Title', 'Role', 'Position', 'Staff Title']);
    const first = pickField(rec, ['First Name', 'FirstName', 'Staff First Name']);
    const last = pickField(rec, ['Last Name', 'LastName', 'Staff Last Name']);
    const name = first && last ? { first, last } : splitPersonName(pickField(rec, ['Name', 'Staff Name', 'Full Name']));
    const row = blankRow('TX');
    row.state_school_id = pickField(rec, ['Campus Number', 'School Number', 'Organization Number']);
    row.district_name = pickField(rec, ['District Name', 'District']);
    row.school_name = pickField(rec, ['Campus Name', 'School Name', 'Organization Name']);
    row.city = pickField(rec, ['City']);
    row.zip = pickField(rec, ['Zip', 'Zip Code']);
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = title || 'Principal';
    row.email = normalizeEmail(pickField(rec, ['Email', 'E-mail', 'Email Address']));
    if (!hasPersonName(row)) continue;
    if (orgLooksLikeSchool(rec) && looksLikePrincipal(title)) {
      rows.push(row);
    } else {
      districtStaff.push(row);
    }
  }
  return { rows, districtStaff };
}
