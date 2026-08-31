import { join } from 'node:path';
import { rowToRecord, writeCsv } from './lib/csv.js';
import { writeJson } from './lib/io.js';
import { CONTACT_COLUMNS, COVERAGE_COLUMNS } from './ioSchools.js';
import { canonicalSchoolName, jaccard, schoolTokenSet } from './schoolNames.js';
import { ROLE_FILL_ORDER, classifySchoolRole, roleIsEligible } from './schoolRoles.js';
import type {
  ContactProvider,
  ListedSchool,
  PickedSchoolContact,
  RawSchoolContact,
  SchoolRole,
} from './types.js';

const GENERIC_LOCAL = /^(info|office|admin|contact|support|hello|staff|principal|attendance)$/i;
const PROVIDER_RANK: Record<ContactProvider, number> = {
  directory: 5,
  state_agency: 4,
  quickenrich: 3,
  moltsets: 2,
  apollo: 1,
};

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

function personKey(contact: RawSchoolContact): string {
  const email = normEmail(contact.email);
  if (email.includes('@')) return `email:${email}`;
  const linkedin = contact.linkedin_url.trim().toLowerCase().replace(/\/+$/, '');
  if (linkedin) return `li:${linkedin}`;
  const name = `${contact.first_name} ${contact.last_name}`.trim().toLowerCase();
  if (name) return `name:${contact.ncessch}:${name}`;
  return `id:${contact.person_id || contact.title}:${contact.ncessch}`;
}

export function employerMatchesSchool(company: string, school: ListedSchool): boolean {
  const value = company.trim();
  if (!value) return true;
  const companyCanon = canonicalSchoolName(value, school.state);
  const schoolCanon = canonicalSchoolName(school.school_name, school.state);
  if (companyCanon && schoolCanon && companyCanon === schoolCanon) return true;
  if (jaccard(schoolTokenSet(value, school.state), schoolTokenSet(school.school_name, school.state)) >= 0.55) {
    return true;
  }
  const districtCanon = canonicalSchoolName(school.lea_name, school.state);
  if (districtCanon && companyCanon === districtCanon) return true;
  return jaccard(schoolTokenSet(value, school.state), schoolTokenSet(school.lea_name, school.state)) >= 0.6;
}

export function isGenericEmail(email: string): boolean {
  const value = normEmail(email);
  if (!value.includes('@')) return true;
  const local = value.split('@')[0] ?? '';
  return GENERIC_LOCAL.test(local);
}

export function contactLooksUsable(contact: RawSchoolContact, school: ListedSchool): {
  ok: boolean;
  reason: string;
} {
  const role = classifySchoolRole(contact.title);
  if (!roleIsEligible(role)) return { ok: false, reason: `role:${role}` };
  if (!contact.first_name.trim() && !contact.last_name.trim()) {
    return { ok: false, reason: 'missing_name' };
  }
  if (isGenericEmail(contact.email) && !contact.linkedin_url.trim()) {
    return { ok: false, reason: 'generic_or_missing_email' };
  }
  if (!employerMatchesSchool(contact.company, school)) {
    return { ok: false, reason: 'employer_mismatch' };
  }
  return { ok: true, reason: '' };
}

function betterContact(a: RawSchoolContact, b: RawSchoolContact): RawSchoolContact {
  const rankDiff = PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider];
  if (rankDiff !== 0) return rankDiff > 0 ? a : b;
  if (a.email && !b.email) return a;
  if (b.email && !a.email) return b;
  return a;
}

export function dedupeContacts(contacts: RawSchoolContact[]): RawSchoolContact[] {
  const byKey = new Map<string, RawSchoolContact>();
  for (const contact of contacts) {
    const key = personKey(contact);
    const existing = byKey.get(key);
    byKey.set(key, existing ? betterContact(existing, contact) : contact);
  }
  return [...byKey.values()];
}

export function pickSchoolSlots(
  school: ListedSchool,
  contacts: RawSchoolContact[],
  maxContacts = 3,
): { picked: PickedSchoolContact[]; rejected: number } {
  const usable: Array<RawSchoolContact & { role: SchoolRole }> = [];
  let rejected = 0;
  for (const contact of dedupeContacts(contacts.filter((row) => row.ncessch === school.ncessch))) {
    const check = contactLooksUsable(contact, school);
    if (!check.ok) {
      rejected += 1;
      continue;
    }
    usable.push({ ...contact, role: classifySchoolRole(contact.title) as SchoolRole });
  }

  const buckets = new Map<SchoolRole, Array<RawSchoolContact & { role: SchoolRole }>>();
  for (const role of ROLE_FILL_ORDER) buckets.set(role, []);
  for (const person of usable) {
    buckets.get(person.role)?.push(person);
  }
  for (const role of ROLE_FILL_ORDER) {
    const list = buckets.get(role) ?? [];
    list.sort((a, b) => PROVIDER_RANK[b.provider] - PROVIDER_RANK[a.provider] || a.title.localeCompare(b.title));
  }

  const picked: PickedSchoolContact[] = [];
  const used = new Set<string>();

  const take = (person: RawSchoolContact & { role: SchoolRole }, reason: string): void => {
    const key = personKey(person);
    if (used.has(key) || picked.length >= maxContacts) return;
    used.add(key);
    picked.push({
      ...person,
      slot: picked.length + 1,
      pick_reason: reason,
    });
  };

  for (const role of ROLE_FILL_ORDER) {
    const person = (buckets.get(role) ?? []).find((row) => !used.has(personKey(row)));
    if (person) take(person, `preferred:${role}`);
  }
  if (picked.length < maxContacts) {
    for (const role of ROLE_FILL_ORDER) {
      for (const person of buckets.get(role) ?? []) {
        if (picked.length >= maxContacts) break;
        take(person, `backfill:${role}`);
      }
    }
  }
  return { picked, rejected };
}

export function fillAllSchools(options: {
  schools: ListedSchool[];
  contacts: RawSchoolContact[];
  maxContacts?: number;
}): {
  picked: PickedSchoolContact[];
  rejected: number;
  coverage: Array<{
    ncessch: string;
    leaid: string;
    school_name: string;
    state: string;
    city: string;
    contact_count: number;
    has_curriculum: string;
    has_assistant_principal: string;
    has_principal: string;
    providers: string;
  }>;
} {
  const picked: PickedSchoolContact[] = [];
  let rejected = 0;
  const coverage = [];
  for (const school of options.schools) {
    const result = pickSchoolSlots(school, options.contacts, options.maxContacts ?? 3);
    picked.push(...result.picked);
    rejected += result.rejected;
    const roles = new Set(result.picked.map((row) => row.role));
    coverage.push({
      ncessch: school.ncessch,
      leaid: school.leaid,
      school_name: school.school_name,
      state: school.state,
      city: school.city,
      contact_count: result.picked.length,
      has_curriculum: roles.has('curriculum') ? 'yes' : 'no',
      has_assistant_principal: roles.has('assistant_principal') ? 'yes' : 'no',
      has_principal: roles.has('principal') ? 'yes' : 'no',
      providers: [...new Set(result.picked.map((row) => row.provider))].sort().join('|'),
    });
  }
  return { picked, rejected, coverage };
}

export function missingSlots(
  schools: ListedSchool[],
  picked: PickedSchoolContact[],
): Array<{ school: ListedSchool; missing: SchoolRole[] }> {
  const bySchool = new Map<string, Set<SchoolRole>>();
  for (const contact of picked) {
    const set = bySchool.get(contact.ncessch) ?? new Set<SchoolRole>();
    set.add(contact.role);
    bySchool.set(contact.ncessch, set);
  }
  return schools
    .map((school) => {
      const have = bySchool.get(school.ncessch) ?? new Set<SchoolRole>();
      const missing = ROLE_FILL_ORDER.filter((role) => !have.has(role));
      const remaining = Math.max(0, 3 - have.size);
      return { school, missing: missing.slice(0, remaining) };
    })
    .filter((row) => row.missing.length > 0);
}

export function writeContactOutputs(options: {
  runDir: string;
  schools: ListedSchool[];
  picked: PickedSchoolContact[];
  coverage: ReturnType<typeof fillAllSchools>['coverage'];
  rejected: number;
  extra?: Record<string, number | string>;
}): void {
  writeCsv(
    join(options.runDir, 'school_contacts.csv'),
    options.picked.map((row) => rowToRecord(row)),
    CONTACT_COLUMNS,
  );
  writeCsv(
    join(options.runDir, 'school_contact_coverage.csv'),
    options.coverage.map((row) => rowToRecord(row)),
    COVERAGE_COLUMNS,
  );
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const row of options.coverage) {
    const n = Math.min(3, row.contact_count) as 0 | 1 | 2 | 3;
    counts[n] += 1;
  }
  const providers: Record<string, number> = {};
  for (const contact of options.picked) {
    providers[contact.provider] = (providers[contact.provider] ?? 0) + 1;
  }
  writeJson(join(options.runDir, 'school_contact_summary.json'), {
    eligible_schools: options.schools.length,
    contacts: options.picked.length,
    rejected_duplicates_or_mismatch: options.rejected,
    schools_with_0: counts[0],
    schools_with_1: counts[1],
    schools_with_2: counts[2],
    schools_with_3: counts[3],
    provider_counts: providers,
    ...options.extra,
  });
}
