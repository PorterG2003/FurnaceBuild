import type { Stage2Row } from '../lib/types.js';
import {
  enrichOrganization,
  mapOrganization,
  searchOrganization,
  matchPersonByLinkedIn,
  type ApolloClientOptions,
  type ApolloOrganization,
} from './apolloClient.js';
import { entityTypeFromProfileUrl, normalizeLinkedInProfileUrl } from '../stage2-linkedin/linkedinParser.js';
import { SHORT_LINK_HOSTS } from './urlExpander.js';
import { extractNameCandidatesFromPost } from './postCompanySignals.js';

/** Webinar platforms and shortlink hosts — never the host company domain. */
export const PLATFORM_DOMAINS = [
  'zoom.us',
  'hopin.com',
  'lu.ma',
  'luma.com',
  'eventbrite.com',
  'hubspot.com',
  'gotowebinar.com',
  'bigmarker.com',
  'livestorm.co',
  'demio.com',
  'on24.com',
  'meetup.com',
  'crowdcast.io',
  'goldcast.io',
  'qualified.com',
  'hsforms.com',
  'splashthat.com',
  'airmeet.com',
  'webinarjam.com',
  'clickmeeting.com',
  ...SHORT_LINK_HOSTS,
];

export type EntitySource =
  | 'company_page'
  | 'registration_domain'
  | 'post_signal'
  | 'serp_fallback'
  | 'person_employer';

export type FreeSignals = {
  companyLinkedInUrl: string;
  personLinkedInUrl: string;
  domainCandidates: string[];
  nameCandidates: string[];
  entityType: string;
};

export type ResolveCompanyResult = {
  org: ApolloOrganization | null;
  entitySource: EntitySource | string;
  freeCompanyName: string;
  freeDomain: string;
  mapped: ReturnType<typeof mapOrganization>;
  enrichmentStatus: 'ok' | 'partial' | 'not_found';
};

export function isPlatformDomain(host: string): boolean {
  const normalized = host.replace(/^www\./, '').toLowerCase();
  if (normalized.includes('linkedin.com')) return true;
  return PLATFORM_DOMAINS.some(
    (d) => normalized === d || normalized.endsWith(`.${d}`),
  );
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function extractRealDomainFromUrls(urls: string[]): string {
  for (const url of urls) {
    const host = hostFromUrl(url);
    if (host && !isPlatformDomain(host)) return host;
  }
  return '';
}

export function companyNameFromFallback(row: Stage2Row): string {
  if (row.author_name && row.entity_type === 'company') {
    return cleanCompanyName(row.author_name);
  }
  if (row.entity_type === 'person') return '';
  const title = row.result_title.replace(/\s+on LinkedIn.*$/i, '').trim();
  if (title && !title.toLowerCase().includes("'s post")) {
    return cleanCompanyName(title);
  }
  return cleanCompanyName(row.slug_hint.replace(/\bactivity\b.*$/i, '').trim());
}

function cleanCompanyName(name: string): string {
  return name.replace(/'s post$/i, '').replace(/\s+/g, ' ').trim();
}

export { extractNameCandidatesFromPost } from './postCompanySignals.js';

export function collectNameCandidates(row: Stage2Row): string[] {
  const seen = new Set<string>();
  const add = (name: string) => {
    const cleaned = cleanCompanyName(name);
    const key = cleaned.toLowerCase();
    if (cleaned && !seen.has(key)) {
      seen.add(key);
      return cleaned;
    }
    return '';
  };

  const candidates: string[] = [];
  const postSignals = [
    ...extractNameCandidatesFromPost(row.post_text),
    ...extractNameCandidatesFromPost(row.result_snippet),
  ];
  for (const name of [
    row.author_employer_name ?? '',
    row.entity_type === 'company' ? row.author_name : '',
    ...postSignals,
    companyNameFromFallback(row),
  ]) {
    const cleaned = add(name);
    if (cleaned) candidates.push(cleaned);
  }
  return candidates;
}

export function extractFreeSignals(row: Stage2Row, expandedRegistrationUrls: string[]): FreeSignals {
  const profileUrl = normalizeLinkedInProfileUrl(row.author_profile_url);
  const entityType = row.entity_type || entityTypeFromProfileUrl(profileUrl);
  const employerLinkedIn = normalizeLinkedInProfileUrl(row.author_employer_linkedin_url ?? '');
  const companyLinkedInUrl =
    entityType === 'company' && profileUrl
      ? profileUrl
      : employerLinkedIn && /\/company\//i.test(employerLinkedIn)
        ? employerLinkedIn
        : '';
  const personLinkedInUrl =
    entityType === 'person' && profileUrl ? profileUrl : '';

  const domainCandidates: string[] = [];
  const domainSeen = new Set<string>();
  for (const url of expandedRegistrationUrls) {
    const host = hostFromUrl(url);
    if (host && !isPlatformDomain(host) && !domainSeen.has(host)) {
      domainSeen.add(host);
      domainCandidates.push(host);
    }
  }

  return {
    companyLinkedInUrl,
    personLinkedInUrl,
    domainCandidates,
    nameCandidates: collectNameCandidates(row),
    entityType,
  };
}

export type ResolveCompanyOptions = {
  apolloOptions: ApolloClientOptions;
  apolloBudgetRemaining: () => boolean;
};

function hasApolloBudget(options: ResolveCompanyOptions): boolean {
  return options.apolloBudgetRemaining();
}

function totalApolloCalls(counter: ApolloClientOptions['counter']): number {
  if (!counter) return 0;
  return counter.counts.apollo_org_calls + counter.counts.apollo_people_calls;
}

export async function resolveCompany(
  row: Stage2Row,
  expandedRegistrationUrls: string[],
  options: ResolveCompanyOptions,
): Promise<ResolveCompanyResult> {
  const signals = extractFreeSignals(row, expandedRegistrationUrls);
  const freeDomain = signals.domainCandidates[0] ?? '';
  const freeCompanyName = signals.nameCandidates[0] ?? '';
  let entitySource: EntitySource | string = 'serp_fallback';
  let org: ApolloOrganization | null = null;

  try {
    // Phase B — cheap Apollo org (stop at first success)
    if (!org && signals.companyLinkedInUrl && hasApolloBudget(options)) {
      entitySource = 'company_page';
      org = await enrichOrganization(
        { linkedinUrl: signals.companyLinkedInUrl, name: row.author_name || undefined },
        options.apolloOptions,
      );
      if (!org && row.author_name && hasApolloBudget(options)) {
        org = await searchOrganization(
          { name: row.author_name, linkedinUrl: signals.companyLinkedInUrl },
          options.apolloOptions,
        );
      }
    }

    if (!org && freeDomain && hasApolloBudget(options)) {
      entitySource = 'registration_domain';
      org = await enrichOrganization({ domain: freeDomain }, options.apolloOptions);
    }

    for (const name of signals.nameCandidates) {
      if (org || !hasApolloBudget(options)) break;
      org = await enrichOrganization({ name, domain: freeDomain || undefined }, options.apolloOptions);
      if (!org) {
        org = await searchOrganization({ name }, options.apolloOptions);
      }
      if (org) {
        entitySource = name === freeCompanyName ? 'serp_fallback' : 'post_signal';
        break;
      }
    }

    // Phase C — person employer (last resort)
    if (!org && signals.personLinkedInUrl && hasApolloBudget(options)) {
      entitySource = 'person_employer';
      const person = await matchPersonByLinkedIn(signals.personLinkedInUrl, options.apolloOptions);
      if (person?.organization) {
        org = person.organization;
      } else if (person?.organization?.name && hasApolloBudget(options)) {
        org = await searchOrganization({ name: person.organization.name }, options.apolloOptions);
      }
    }
  } catch {
    org = null;
  }

  const mapped = mapOrganization(org);
  if (!mapped.company_name && freeCompanyName) mapped.company_name = freeCompanyName;
  if (!mapped.company_domain && freeDomain) mapped.company_domain = freeDomain;

  let enrichmentStatus: 'ok' | 'partial' | 'not_found' = 'not_found';
  if (org?.id && org?.name) {
    enrichmentStatus = 'ok';
  } else if (mapped.company_name || mapped.company_domain || freeCompanyName || freeDomain) {
    enrichmentStatus = 'partial';
    if (!org) {
      if (freeDomain && entitySource === 'serp_fallback') entitySource = 'registration_domain';
      if (freeCompanyName && !freeDomain && entitySource === 'serp_fallback') {
        entitySource = signals.nameCandidates.length > 1 ? 'post_signal' : 'serp_fallback';
      }
    }
  }

  return {
    org,
    entitySource,
    freeCompanyName,
    freeDomain,
    mapped,
    enrichmentStatus,
  };
}

export { totalApolloCalls };
