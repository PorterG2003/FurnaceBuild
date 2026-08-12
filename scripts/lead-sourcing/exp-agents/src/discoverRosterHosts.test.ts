import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDiscoveryCandidates,
  evaluateDiscoveryPlateau,
} from './discoverRosterHosts.ts';

describe('roster host discovery helpers', () => {
  it('includes seeded state hosts and known extras', () => {
    const hosts = buildDiscoveryCandidates({ jurisdictions: ['NC', 'TX'] });
    assert.ok(hosts.some((host) => host.host === 'https://wnc.exprealty.com'));
    assert.ok(hosts.some((host) => host.host === 'https://tx.exprealty.com'));
  });

  it('detects yield plateau over a 20-host window', () => {
    const tiny = Array.from({ length: 20 }, () => 1);
    assert.equal(evaluateDiscoveryPlateau(tiny, 10000), true);
    const growing = Array.from({ length: 20 }, () => 200);
    assert.equal(evaluateDiscoveryPlateau(growing, 1000), false);
  });
});
