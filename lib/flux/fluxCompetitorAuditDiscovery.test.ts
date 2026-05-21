import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CURATED_COMPETITOR_DOMAINS,
  domainFromCuratedSeed,
  normalizeFluxCompetitorAuditDiscoveryMode,
  parseFluxCuratedDomains,
  resolveEffectiveCuratedDomains,
} from './fluxCompetitorAuditDiscovery.js';

test('normalizeFluxCompetitorAuditDiscoveryMode defaults to local_places', () => {
  assert.equal(normalizeFluxCompetitorAuditDiscoveryMode(null), 'local_places');
  assert.equal(normalizeFluxCompetitorAuditDiscoveryMode('anything'), 'local_places');
  assert.equal(normalizeFluxCompetitorAuditDiscoveryMode('curated_domains'), 'curated_domains');
});

test('domainFromCuratedSeed normalizes website-like input', () => {
  assert.equal(domainFromCuratedSeed({ domain: 'https://www.VisitDenver.com/' }), 'visitdenver.com');
});

test('parseFluxCuratedDomains dedupes, normalizes, trims names, and caps list length', () => {
  const seeds = [
    { domain: 'https://www.VisitDenver.com/', name: ' Visit Denver ' },
    { domain: 'visitdenver.com', name: 'Duplicate' },
    { domain: 'tripadvisor.com' },
    ...Array.from({ length: MAX_CURATED_COMPETITOR_DOMAINS + 3 }, (_, i) => ({
      domain: `https://example${i}.com`,
      name: `Example ${i}`,
    })),
  ];
  const parsed = parseFluxCuratedDomains(seeds);
  assert.equal(parsed[0]?.domain, 'visitdenver.com');
  assert.equal(parsed[0]?.name, 'Visit Denver');
  assert.equal(parsed[1]?.domain, 'tripadvisor.com');
  assert.equal(parsed.length, MAX_CURATED_COMPETITOR_DOMAINS);
});

test('resolveEffectiveCuratedDomains prefers prospect override only when it has at least three valid seeds', () => {
  const blockDomains = [
    { domain: 'visitdenver.com' },
    { domain: 'tripadvisor.com' },
    { domain: 'expedia.com' },
  ];
  const prospectDomains = [
    { domain: 'visitaustin.org' },
    { domain: 'booking.com' },
    { domain: 'travelandleisure.com' },
  ];
  assert.deepEqual(resolveEffectiveCuratedDomains({ blockDomains, prospectDomains }), [
    { domain: 'visitaustin.org' },
    { domain: 'booking.com' },
    { domain: 'travelandleisure.com' },
  ]);
  assert.deepEqual(
    resolveEffectiveCuratedDomains({
      blockDomains,
      prospectDomains: [{ domain: 'visitaustin.org' }, { domain: 'booking.com' }],
    }),
    blockDomains,
  );
});
