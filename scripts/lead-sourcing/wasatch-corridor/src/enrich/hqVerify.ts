import { extractAddressCandidate, htmlToText } from '../lib/html.js';
import { normalizeStreet } from '../lib/domain.js';
import type { CompanyRecord } from '../types.js';
import type { CrawledSite } from './crawl.js';

export function verifyHq(company: CompanyRecord, site: CrawledSite): void {
  if (company.hq_verification === 'A') return;
  const contact = site.pages.find((p) => p.path === '/contact') ?? site.pages.find((p) => p.path === '/');
  if (!contact) return;
  const text = htmlToText(contact.html);
  const found = extractAddressCandidate(text);
  if (!found) return;
  const siteStreet = normalizeStreet(found);
  const known = normalizeStreet(company.street);
  if (known && siteStreet.includes(known.slice(0, 18))) {
    company.hq_verification = 'A';
    company.hq_address = found;
    company.provenance.hq_verification = { source: 'website', cached_at: new Date().toISOString() };
    return;
  }
  if (!company.street && found) {
    company.hq_verification = 'A';
    company.hq_address = found;
    company.street = found;
    company.provenance.hq_verification = { source: 'website', cached_at: new Date().toISOString() };
  }
}
