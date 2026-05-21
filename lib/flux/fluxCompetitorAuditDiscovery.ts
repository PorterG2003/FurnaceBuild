import { normalizeGoogleAdsSearchDomain } from '../foundry/registry-server/searchDomain';
import type { FluxCompetitorAuditDiscoveryMode, FluxCuratedDomainSeed } from './types';

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

const fluxCompetitorAuditDiscovery = {
  FLUX_COMPETITOR_AUDIT_DISCOVERY_MODES,
  MAX_CURATED_COMPETITOR_DOMAINS,
  MIN_CURATED_COMPETITOR_DOMAINS,
  normalizeFluxCompetitorAuditDiscoveryMode,
  parseFluxCuratedDomains,
  resolveEffectiveCuratedDomains,
  domainFromCuratedSeed,
};

export default fluxCompetitorAuditDiscovery;
