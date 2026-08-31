import { GOV_K12_RELIGIOUS_INDUSTRY_RE, UNIVERSE_NAICS_EXCLUDE_PREFIXES } from '../../config/sources.js';
import { companyIdFromDomainOrNameStreet, isParkedOrSharedHost, registrableDomain } from '../lib/domain.js';
import { emptyCompany, type CompanyRecord, type RawHit } from '../types.js';
import { naicsExcluded } from '../acquire/epaFrs.js';

export function stamp(source: string, rawHash?: string) {
  return { source, cached_at: new Date().toISOString(), raw_hash: rawHash };
}

export function hitToCompany(hit: RawHit): CompanyRecord {
  const domain = hit.domain ? registrableDomain(hit.domain) : null;
  const parked = isParkedOrSharedHost(domain);
  const id = companyIdFromDomainOrNameStreet({
    domain: parked ? null : domain,
    name: hit.name,
    street: hit.street || hit.hq_street,
  });
  const company = emptyCompany({
    company_id: id,
    name: hit.name,
    domain: parked ? domain : domain,
    apollo_org_id: hit.apollo_org_id,
    sources: [hit.source],
    street: hit.street || hit.hq_street,
    city: hit.city || hit.hq_city || hit.query_city,
    query_city: hit.query_city || '',
    search_employee_band: hit.search_employee_band || '',
    state: hit.state || hit.hq_state,
    postal: hit.postal,
    lat: hit.lat,
    lng: hit.lng,
    naics: hit.naics,
    industry: hit.industry,
    employees: hit.employees,
    revenue_est: hit.revenue_est,
    founded_year: hit.founded_year,
    headcount_growth_pct: hit.headcount_growth_pct,
    last_funding_date: hit.last_funding_date,
    last_funding_amount: hit.last_funding_amount,
    current_technologies: hit.current_technologies,
    job_postings_json: hit.job_postings_json,
    parked_or_shared_host: parked,
    hq_address: [hit.hq_street || hit.street, hit.hq_city || hit.city, hit.hq_state || hit.state].filter(Boolean).join(', '),
    hq_verification: hit.source === 'fsq' || hit.source === 'epa' ? 'A' : 'B',
  });
  company.provenance.name = stamp(hit.source, hit.raw_hash);
  company.provenance.domain = stamp(hit.source, hit.raw_hash);
  company.provenance.street = stamp(hit.source, hit.raw_hash);
  if (hit.employees != null) company.provenance.employees = stamp(hit.source, hit.raw_hash);
  if (hit.source === 'fsq' || hit.source === 'epa') {
    company.provenance.hq_verification = stamp(hit.source, hit.raw_hash);
  }
  return company;
}

export function mergeCompanies(into: CompanyRecord, incoming: CompanyRecord): CompanyRecord {
  const sources = [...new Set([...into.sources, ...incoming.sources])];
  const prefer = (current: string, next: string) => current || next;
  return {
    ...into,
    sources,
    apollo_org_id: into.apollo_org_id || incoming.apollo_org_id,
    domain: into.domain || incoming.domain,
    street: prefer(into.street, incoming.street),
    city: prefer(into.city, incoming.city),
    query_city: prefer(into.query_city, incoming.query_city),
    search_employee_band: prefer(into.search_employee_band, incoming.search_employee_band),
    state: prefer(into.state, incoming.state),
    postal: prefer(into.postal, incoming.postal),
    lat: into.lat ?? incoming.lat,
    lng: into.lng ?? incoming.lng,
    naics: prefer(into.naics, incoming.naics),
    industry: prefer(into.industry, incoming.industry),
    employees: into.employees ?? incoming.employees,
    revenue_est: into.revenue_est ?? incoming.revenue_est,
    founded_year: into.founded_year ?? incoming.founded_year,
    headcount_growth_pct: into.headcount_growth_pct ?? incoming.headcount_growth_pct,
    last_funding_date: prefer(into.last_funding_date, incoming.last_funding_date),
    last_funding_amount: into.last_funding_amount ?? incoming.last_funding_amount,
    current_technologies: [...new Set([...into.current_technologies, ...incoming.current_technologies])],
    job_postings_json: prefer(into.job_postings_json, incoming.job_postings_json),
    hq_address: prefer(into.hq_address, incoming.hq_address),
    hq_verification: into.hq_verification === 'A' || incoming.hq_verification === 'A' ? 'A' : into.hq_verification || incoming.hq_verification,
    parked_or_shared_host: into.parked_or_shared_host || incoming.parked_or_shared_host,
    provenance: { ...incoming.provenance, ...into.provenance },
  };
}

export function isGovK12Religious(company: CompanyRecord): boolean {
  if (naicsExcluded(company.naics)) return true;
  const code = company.naics.replace(/\D/g, '');
  if (UNIVERSE_NAICS_EXCLUDE_PREFIXES.some((p) => code.startsWith(p))) return true;
  return GOV_K12_RELIGIOUS_INDUSTRY_RE.test(company.industry) || GOV_K12_RELIGIOUS_INDUSTRY_RE.test(company.category);
}

function isUs(country: string): boolean {
  return !country || /^(united states|usa|us|u\.s\.?)$/i.test(country.trim());
}

function isUtah(state: string): boolean {
  return /^(ut|utah)$/i.test(state.trim());
}

export function looksLikeOutOfStateHq(company: CompanyRecord, hit?: RawHit): boolean {
  const state = (hit?.hq_state || company.state || '').trim();
  const country = (hit?.hq_country || '').trim();
  if (country && !isUs(country)) return true;
  if (state && !isUtah(state)) return true;
  return false;
}
