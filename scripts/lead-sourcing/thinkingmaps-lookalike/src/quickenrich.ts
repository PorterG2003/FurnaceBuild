import { readCsv } from './lib/csv.js';
import { padLeaid, padNcessch, canonicalSchoolName, normalizeCity, normalizeState } from './schoolNames.js';
import type { ListedSchool, RawSchoolContact } from './types.js';

function field(row: Record<string, string>, ...names: string[]): string {
  const lower = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/^\ufeff/, '').trim().toLowerCase(), value]),
  );
  for (const name of names) {
    const value = lower[name.toLowerCase()];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

export function splitName(raw: string): { first_name: string; last_name: string } {
  const parts = raw.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0]!, last_name: '' };
  return { first_name: parts[0]!, last_name: parts.slice(1).join(' ') };
}

function indexEligible(schools: ListedSchool[]): {
  byId: Map<string, ListedSchool>;
  byName: Map<string, ListedSchool[]>;
} {
  const byId = new Map<string, ListedSchool>();
  const byName = new Map<string, ListedSchool[]>();
  for (const school of schools) {
    byId.set(school.ncessch, school);
    const key = `${canonicalSchoolName(school.school_name, school.state)}|${school.state}`;
    const list = byName.get(key) ?? [];
    list.push(school);
    byName.set(key, list);
  }
  return { byId, byName };
}

export function resolveImportedSchool(
  row: Record<string, string>,
  byId: Map<string, ListedSchool>,
  byName: Map<string, ListedSchool[]>,
): ListedSchool | null {
  const ncessch = padNcessch(field(row, 'ncessch', 'nces_sch_id', 'school_nces_id'));
  if (ncessch && byId.has(ncessch)) return byId.get(ncessch) ?? null;

  const schoolName = field(row, 'school_name', 'company', 'company_name', 'organization', 'account_name');
  const state = normalizeState(field(row, 'state', 'company_state', 'billing state'));
  const city = normalizeCity(field(row, 'city', 'company_city', 'billing city'));
  if (!schoolName) return null;
  const key = `${canonicalSchoolName(schoolName, state)}|${state}`;
  const hits = byName.get(key) ?? [];
  if (hits.length === 1) return hits[0]!;
  const cityHits = hits.filter((school) => !city || normalizeCity(school.city) === city);
  if (cityHits.length === 1) return cityHits[0]!;
  return null;
}

export function importQuickEnrichContacts(
  path: string,
  schools: ListedSchool[],
): { contacts: RawSchoolContact[]; unmatched_rows: number } {
  const { byId, byName } = indexEligible(schools);
  const contacts: RawSchoolContact[] = [];
  let unmatched = 0;
  for (const row of readCsv(path)) {
    const school = resolveImportedSchool(row, byId, byName);
    if (!school) {
      unmatched += 1;
      continue;
    }
    const fullName = field(row, 'name', 'full_name', 'full name');
    const split = splitName(fullName);
    const first = field(row, 'first_name', 'first name', 'firstname') || split.first_name;
    const last = field(row, 'last_name', 'last name', 'lastname') || split.last_name;
    const email = field(row, 'email', 'work_email', 'business_email', 'email_address').toLowerCase();
    const title = field(row, 'title', 'job_title', 'job title', 'position');
    if (!first && !last && !email) continue;
    contacts.push({
      ncessch: school.ncessch,
      leaid: padLeaid(school.leaid),
      school_name: school.school_name,
      first_name: first,
      last_name: last,
      title,
      email,
      linkedin_url: field(row, 'linkedin_url', 'linkedin', 'person_linkedin_url'),
      company: field(row, 'company', 'company_name', 'organization', 'school_name') || school.school_name,
      phone: field(row, 'phone', 'mobile', 'phone_number'),
      provider: 'quickenrich',
      email_risk: field(row, 'email_risk', 'risk', 'email_grade'),
      person_id: field(row, 'person_id', 'id', 'linkedin_url', 'email') || `${school.ncessch}:${email || `${first} ${last}`}`,
    });
  }
  return { contacts, unmatched_rows: unmatched };
}
