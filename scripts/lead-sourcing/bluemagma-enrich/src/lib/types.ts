export const PERSON_COLUMNS = [
  'name',
  'title',
  'company',
  'dm_type',
  'title_confirmed',
  'likely_service_provider',
  'linkedin_url',
  'company_linkedin',
  'location',
  'followers',
  'reactions',
  'comments',
  'distinct_posts',
  'engaged_with',
  'headline',
  'sample_comment',
] as const;

export const COMPANY_COLUMNS = [
  'company_key',
  'company_name',
  'company_linkedin',
  'person_count',
  'sample_headlines',
  'sample_titles',
] as const;

export const FUNDING_COLUMNS = [
  'total_funding',
  'total_funding_printed',
  'latest_funding_stage',
  'latest_funding_round_date',
  'funding_events',
] as const;

export const DOMAIN_COLUMNS = [
  ...COMPANY_COLUMNS,
  'company_domain',
  'domain_source',
  'domain_tier',
  'domain_score',
  'apollo_org_id',
  'apollo_org_name',
  'website_status',
  'website_error',
  ...FUNDING_COLUMNS,
] as const;

export const ROLE_COLUMNS = [
  ...DOMAIN_COLUMNS,
  'company_role',
  'is_compliance_platform',
  'role_reason',
  'role_evidence',
] as const;

export const SOC2_COLUMNS = [
  ...ROLE_COLUMNS,
  'has_soc2',
  'soc2_evidence_url',
  'soc2_evidence_snippet',
  'soc2_method',
] as const;

export const ENRICHED_PERSON_COLUMNS = [
  ...PERSON_COLUMNS,
  'company_key',
  'company_domain',
  'domain_source',
  'website_status',
  'company_role',
  'is_compliance_platform',
  'role_reason',
  'has_soc2',
  'soc2_evidence_url',
  'soc2_evidence_snippet',
  'soc2_method',
  ...FUNDING_COLUMNS,
] as const;

export type CompanyRole =
  | 'compliance_platform'
  | 'auditor'
  | 'consultant'
  | 'prospect'
  | 'unknown';

export type HasSoc2 = 'yes' | 'no' | 'unknown';

export type Soc2Method = 'homepage' | 'trust_page' | 'serper' | 'none';

export type DomainSource = 'apollo_linkedin' | 'serper' | 'apollo_confirm' | '';

export const GENERIC_DOMAINS = new Set([
  'linkedin.com',
  'lnkd.in',
  'facebook.com',
  'twitter.com',
  'x.com',
  'crunchbase.com',
  'bloomberg.com',
  'wikipedia.org',
  'youtube.com',
  'youtu.be',
  'google.com',
  'apple.com',
  'apps.apple.com',
  'play.google.com',
  'bit.ly',
  't.co',
  'linktr.ee',
  'calendly.com',
]);

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  value = value.split('/')[0] ?? value;
  value = value.split('?')[0] ?? value;
  value = value.replace(/\.$/, '');
  if (!value || GENERIC_DOMAINS.has(value)) return '';
  if ([...GENERIC_DOMAINS].some((g) => value === g || value.endsWith(`.${g}`))) return '';
  return value;
}

export function homepageUrl(domain: string): string {
  const host = normalizeDomain(domain) || domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) return '';
  return `https://${host}`;
}

export function normalizeLinkedInCompanyUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.replace(/^www\./i, 'www.').toLowerCase();
    let path = parsed.pathname.replace(/\/+$/, '');
    const match = path.match(/\/company\/([^/]+)/i);
    if (!match) return trimmed.replace(/\/+$/, '').toLowerCase();
    return `https://www.linkedin.com/company/${decodeURIComponent(match[1]).toLowerCase()}`;
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

export function linkedInCompanySlug(url: string): string {
  const match = url.trim().match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).toLowerCase().replace(/\/+$/, '');
  } catch {
    return match[1].toLowerCase();
  }
}

export function companyKey(name: string, companyLinkedIn: string): string {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (n) return n;
  return linkedInCompanySlug(companyLinkedIn);
}
