import { isFreeMail } from './directoryParse.js';
import { sameRegistrableHost, hostnameOf } from './lib/url.js';
import { hostTokenSet } from './resolveDistrictSites.js';
import { classifySchoolRole, roleIsEligible } from './schoolRoles.js';
import type { HarvestedPerson } from './adapters/types.js';
import type { RawSchoolContact } from './types.js';

const BAD_NAME =
  /\b(staff|directory|home|welcome|contact|district office|click here|learn more|read more)\b/i;

export type QaFail = {
  person: HarvestedPerson;
  reason: string;
};

export function emailMatchesDistrict(
  email: string,
  siteHost: string,
  extraDomains: string[] = [],
): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain || isFreeMail(email)) return false;
  const hosts = [siteHost, ...extraDomains].map((h) => hostnameOf(h) || h.toLowerCase().replace(/^www\./, ''));
  return hosts.some((host) => {
    if (!host) return false;
    if (sameRegistrableHost(domain, host)) return true;
    const shared = [...hostTokenSet(domain)].filter((token) => token.length >= 5);
    return shared.some((token) => host.includes(token) || hostTokenSet(host).has(token));
  });
}

export function qaPerson(
  person: HarvestedPerson,
  options: { siteHost: string; extraDomains?: string[] },
): { ok: boolean; reason: string } {
  const name = `${person.first_name} ${person.last_name}`.trim();
  if (!person.first_name.trim() && !person.last_name.trim()) return { ok: false, reason: 'missing_name' };
  if (/^\+?\d[\d.\-() ]+$/.test(person.first_name.trim())) return { ok: false, reason: 'boilerplate_name' };
  if (BAD_NAME.test(name)) return { ok: false, reason: 'boilerplate_name' };
  if (!roleIsEligible(classifySchoolRole(person.title))) {
    return { ok: false, reason: `role:${classifySchoolRole(person.title)}` };
  }
  if (!person.email.includes('@')) return { ok: false, reason: 'missing_email' };
  if (!emailMatchesDistrict(person.email, options.siteHost, options.extraDomains ?? [])) {
    return { ok: false, reason: 'email_domain_mismatch' };
  }
  return { ok: true, reason: '' };
}

export function dedupeContacts(contacts: RawSchoolContact[]): RawSchoolContact[] {
  const byEmail = new Map<string, RawSchoolContact>();
  for (const row of contacts) {
    const key = row.email.trim().toLowerCase();
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, row);
  }
  return [...byEmail.values()];
}

export type DirectoryCoverage = {
  leaid: string;
  lea_name: string;
  website: string;
  platform: string;
  pages: number;
  people_found: number;
  qa_kept: number;
  attributed: number;
  review: number;
  schools_in_district: number;
  schools_covered: number;
  curriculum: number;
  assistant_principal: number;
  principal: number;
  notes: string;
};

export function emptyCoverage(partial: Partial<DirectoryCoverage> & Pick<DirectoryCoverage, 'leaid'>): DirectoryCoverage {
  return {
    lea_name: '',
    website: '',
    platform: 'other',
    pages: 0,
    people_found: 0,
    qa_kept: 0,
    attributed: 0,
    review: 0,
    schools_in_district: 0,
    schools_covered: 0,
    curriculum: 0,
    assistant_principal: 0,
    principal: 0,
    notes: '',
    ...partial,
  };
}
