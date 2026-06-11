import { normalizeGoogleAdsSearchDomain } from '../foundry/registry-server/searchDomain';
import type {
  CompetitorAdAuditBlockProps,
  FluxCompetitorAuditDiscoveryMode,
  FluxCuratedDomainSeed,
} from './types';

export const FLUX_COMPETITOR_AUDIT_DISCOVERY_MODES = ['local_places', 'curated_domains'] as const;
export const MAX_CURATED_COMPETITOR_DOMAINS = 12;
export const MIN_CURATED_COMPETITOR_DOMAINS = 3;

export function normalizeFluxCompetitorAuditDiscoveryMode(raw: unknown): FluxCompetitorAuditDiscoveryMode {
  return raw === 'curated_domains' ? 'curated_domains' : 'local_places';
}

export function domainFromCuratedSeed(seed: Pick<FluxCuratedDomainSeed, 'domain'> | null | undefined): string | null {
  return normalizeGoogleAdsSearchDomain(seed?.domain);
}

export function parseFluxCuratedDomains(raw: unknown): FluxCuratedDomainSeed[] {
  if (!Array.isArray(raw) || raw.length < 1) return [];
  const out: FluxCuratedDomainSeed[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= MAX_CURATED_COMPETITOR_DOMAINS) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const seed = entry as Record<string, unknown>;
    const domain = domainFromCuratedSeed({ domain: typeof seed.domain === 'string' ? seed.domain : '' });
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const name = typeof seed.name === 'string' ? seed.name.trim() : '';
    out.push(name ? { domain, name } : { domain });
  }
  return out;
}

export function resolveEffectiveCuratedDomains(params: {
  blockDomains: unknown;
  prospectDomains: unknown;
}): FluxCuratedDomainSeed[] {
  const prospectDomains = parseFluxCuratedDomains(params.prospectDomains);
  if (prospectDomains.length >= MIN_CURATED_COMPETITOR_DOMAINS) return prospectDomains;
  return parseFluxCuratedDomains(params.blockDomains);
}

/** Map curated domain labels onto published competitor rows (matches by normalized domain in `row.name`). */
export function applyCuratedNamesToCompetitors(
  competitors: CompetitorAdAuditBlockProps['competitors'],
  curatedDomains: unknown,
): CompetitorAdAuditBlockProps['competitors'] {
  const seeds = parseFluxCuratedDomains(curatedDomains);
  if (competitors.length < 1 || seeds.length < 1) return competitors;

  const nameByDomain = new Map<string, string>();
  for (const seed of seeds) {
    const label = seed.name?.trim();
    if (label) nameByDomain.set(seed.domain, label);
  }
  if (nameByDomain.size < 1) return competitors;

  return competitors.map((row) => {
    const domainKey = normalizeGoogleAdsSearchDomain(row.name?.trim() ?? '') ?? row.name?.trim();
    if (!domainKey) return row;
    const label = nameByDomain.get(domainKey);
    return label ? { ...row, name: label } : row;
  });
}

const fluxCompetitorAuditDiscovery = {
  FLUX_COMPETITOR_AUDIT_DISCOVERY_MODES,
  MAX_CURATED_COMPETITOR_DOMAINS,
  MIN_CURATED_COMPETITOR_DOMAINS,
  normalizeFluxCompetitorAuditDiscoveryMode,
  parseFluxCuratedDomains,
  resolveEffectiveCuratedDomains,
  applyCuratedNamesToCompetitors,
  domainFromCuratedSeed,
};

export default fluxCompetitorAuditDiscovery;
