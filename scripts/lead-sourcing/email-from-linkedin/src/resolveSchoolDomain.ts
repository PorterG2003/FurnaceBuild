import {
  enrichOrganization,
  searchOrganization,
  type ApolloClientOptions,
  type ApolloOrganization,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { resolveDomainViaSerper } from './resolveSchoolDomainSerper.js';
import { isLikelySchoolDomain, normalizeDomain } from './schoolDomainQuality.js';

export type ResolvedSchoolDomain = {
  organizationName: string;
  domain: string;
  apolloOrgId: string;
  source: 'apollo' | 'serper';
};

function normalizeOrgKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainFromOrg(org: ApolloOrganization | null): string {
  const raw = org?.primary_domain?.trim() || '';
  if (!raw) return '';
  return normalizeDomain(raw);
}

export type SchoolDomainResolverOptions = ApolloClientOptions & {
  /** Skip Serper fallback (tests / --no-serper). Default: try Serper when Apollo fails quality check. */
  enableSerper?: boolean;
};

/**
 * Resolve a school/district name to a primary domain via Apollo org enrich/search,
 * then Serper fallback when Apollo misses or returns a rejected domain.
 * Results are cached by normalized org name for the run.
 */
export function createSchoolDomainResolver(options: SchoolDomainResolverOptions = {}) {
  const cache = new Map<string, ResolvedSchoolDomain | null>();
  const enableSerper = options.enableSerper !== false;

  return async function resolveSchoolDomain(
    organizationName: string,
  ): Promise<ResolvedSchoolDomain | null> {
    const trimmed = organizationName.trim();
    if (!trimmed) return null;
    const key = normalizeOrgKey(trimmed);
    if (!key) return null;
    if (cache.has(key)) return cache.get(key) ?? null;

    let org = await enrichOrganization({ name: trimmed }, options);
    let domain = domainFromOrg(org);
    if (!domain || !isLikelySchoolDomain(domain, trimmed)) {
      const searched = await searchOrganization({ name: trimmed }, options);
      const searchDomain = domainFromOrg(searched);
      if (searchDomain && isLikelySchoolDomain(searchDomain, trimmed)) {
        org = searched;
        domain = searchDomain;
      } else if (!domain || !isLikelySchoolDomain(domain, trimmed)) {
        domain = '';
      }
    }

    if (domain && isLikelySchoolDomain(domain, trimmed) && org) {
      const resolved: ResolvedSchoolDomain = {
        organizationName: org.name?.trim() || trimmed,
        domain,
        apolloOrgId: org.id ?? '',
        source: 'apollo',
      };
      cache.set(key, resolved);
      return resolved;
    }

    if (enableSerper) {
      const serperDomain = await resolveDomainViaSerper(trimmed, {
        useFixtures: options.useFixtures,
        fetchImpl: options.fetchImpl,
        counter: options.counter,
      });
      if (serperDomain && isLikelySchoolDomain(serperDomain, trimmed)) {
        const resolved: ResolvedSchoolDomain = {
          organizationName: org?.name?.trim() || trimmed,
          domain: serperDomain,
          apolloOrgId: org?.id ?? '',
          source: 'serper',
        };
        cache.set(key, resolved);
        return resolved;
      }
    }

    cache.set(key, null);
    return null;
  };
}

export { isLikelySchoolDomain, normalizeDomain } from './schoolDomainQuality.js';
