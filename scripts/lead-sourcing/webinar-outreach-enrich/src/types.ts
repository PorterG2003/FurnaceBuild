export const GENERIC_DOMAINS = new Set([
  'zoom.us',
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'meta.com',
  'metastatus.com',
  'linkedin.com',
  'lnkd.in',
  'bit.ly',
  't.co',
  'ow.ly',
  'zurl.co',
  'tinyurl.com',
  'shorturl.at',
  'lglforms.com',
  'wmb.link',
  'youtu.be',
  'youtube.com',
  'google.com',
  'forms.gle',
  'linktr.ee',
  'eventbrite.com',
  'eventbrite.co.uk',
  'whova.com',
  'meetup.com',
  'x.com',
  'twitter.com',
  'webinarjam.com',
  'gotowebinar.com',
  'goto.com',
  'demio.com',
  'on24.com',
  'lu.ma',
  'zoom.com',
  'teams.microsoft.com',
  'crunchbase.com',
  'bloomberg.com',
  'wikipedia.org',
  'apps.apple.com',
  'play.google.com',
  'tiktok.com',
  'vimeo.com',
  'typeform.com',
  'calendly.com',
  'mailchi.mp',
  'canva.com',
  'surveymonkey.com',
  'doubleclick.net',
  'ad.doubleclick.net',
  'brazenconnect.com',
  'app.brazenconnect.com',
]);

export type OutreachRow = {
  platform: string;
  company_name: string;
  company_url: string;
  landing_url: string;
  landing_domain: string;
  person_name: string;
  ad_library_url: string;
  ad_id: string;
  ad_headline: string;
  ad_copy: string;
  ad_active_from: string;
  phrases_found: string;
  qualifying_ad_count: string;
  source_runs: string;
};

export type CohortCompany = OutreachRow & {
  company_domain: string;
  has_usable_domain: boolean;
  has_person_name: boolean;
  has_company_linkedin: boolean;
};

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  value = value.split('/')[0] ?? value;
  value = value.split('?')[0] ?? value;
  value = value.replace(/\.$/, '');
  if (!value || GENERIC_DOMAINS.has(value)) return '';
  // multi-part generic hosts
  if ([...GENERIC_DOMAINS].some((g) => value === g || value.endsWith(`.${g}`))) return '';
  return value;
}

export function isCompanyLinkedIn(url: string): boolean {
  return /linkedin\.com\/company\//i.test(url.trim());
}

export function toCohortCompany(row: OutreachRow): CohortCompany {
  const fromLanding = normalizeDomain(row.landing_domain || row.landing_url || '');
  const domain = fromLanding;
  return {
    ...row,
    company_domain: domain,
    has_usable_domain: Boolean(domain),
    has_person_name: Boolean(row.person_name?.trim()),
    has_company_linkedin: isCompanyLinkedIn(row.company_url || ''),
  };
}
