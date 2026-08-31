import { blankRow, hasPersonName, ncesFromParts, normalizeEmail, splitPersonName } from './parse.js';
import type { ParseResult, StateDirectoryRow } from './types.js';

type UtContact = { title?: string; name?: string; email?: string };

type UtSchool = {
  ncesAgencyId?: string | null;
  ncesSchoolId?: string | null;
  schoolName?: string;
  schoolNumber?: string;
  leaName?: string;
  city?: string;
  zip?: string;
  principalName?: string | null;
  principalEmail?: string | null;
  principalTitle?: string | null;
  isPrivate?: boolean;
  isClosed?: string | boolean;
  isOpenThisSchoolYear?: boolean;
  state?: string;
  contacts?: UtContact[];
};

function closed(rec: UtSchool): boolean {
  if (rec.isOpenThisSchoolYear === false) return true;
  const flag = rec.isClosed;
  if (flag === true) return true;
  if (typeof flag === 'string' && /^y/i.test(flag.trim())) return true;
  return false;
}

export function parseUt(text: string): ParseResult {
  const parsed = JSON.parse(text) as { schools?: UtSchool[] } | UtSchool[];
  const records = Array.isArray(parsed) ? parsed : (parsed.schools ?? []);
  const rows: StateDirectoryRow[] = [];
  for (const rec of records) {
    if (rec.isPrivate || closed(rec)) continue;
    if (rec.state && rec.state.toUpperCase() !== 'UT') continue;
    const school = (rec.schoolName ?? '').trim();
    if (!school) continue;
    const name = splitPersonName(rec.principalName ?? '');
    const ncesSchool = String(rec.ncesSchoolId ?? '').replace(/\D/g, '');
    const ncesDist = String(rec.ncesAgencyId ?? '').replace(/\D/g, '');
    const row = blankRow('UT');
    row.state_school_id = rec.schoolNumber ?? '';
    row.nces_school_id = ncesSchool.length >= 12 ? ncesSchool.slice(-12) : ncesFromParts(ncesDist, ncesSchool);
    row.district_name = rec.leaName ?? '';
    row.school_name = school;
    row.city = rec.city ?? '';
    row.zip = rec.zip ?? '';
    row.first_name = name.first;
    row.last_name = name.last;
    row.title = rec.principalTitle || 'Principal';
    row.email = normalizeEmail(rec.principalEmail ?? '');
    if (!hasPersonName(row)) continue;
    rows.push(row);
  }
  return { rows, districtStaff: [] };
}
