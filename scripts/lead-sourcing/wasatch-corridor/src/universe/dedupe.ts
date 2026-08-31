import { companyIdFromDomainOrNameStreet, isParkedOrSharedHost } from '../lib/domain.js';
import type { CompanyRecord } from '../types.js';
import { mergeCompanies } from './normalize.js';

export function dedupeCompanies(companies: CompanyRecord[]): CompanyRecord[] {
  const byId = new Map<string, CompanyRecord>();
  for (const company of companies) {
    const id = companyIdFromDomainOrNameStreet({
      domain: company.parked_or_shared_host || isParkedOrSharedHost(company.domain) ? null : company.domain,
      name: company.name,
      street: company.street,
    });
    const rec = { ...company, company_id: id };
    const existing = byId.get(id);
    byId.set(id, existing ? mergeCompanies(existing, rec) : rec);
  }
  return [...byId.values()];
}
