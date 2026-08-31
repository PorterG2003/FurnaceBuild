import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { mergeHighDomains, serperEstimate } from './discoverCeDomains.js';

describe('serperEstimate', () => {
  it('prices one query at $0.001', () => {
    assert.equal(serperEstimate(1045, null).queries, 1045);
    assert.equal(serperEstimate(1045, null).dollars, 1.045);
    assert.equal(serperEstimate(1045, 40).queries, 40);
    assert.equal(serperEstimate(1045, 40).dollars, 0.04);
  });
});

describe('mergeHighDomains', () => {
  it('appends new high-confidence domains and skips duplicates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ce-serper-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'companies.csv'), 'company_name,company_domain,source_lists\nAcme,acme.com,ce-vendor-prospects\n');
    try {
      mergeHighDomains(dir, [
        { company_name: 'Acme', discovered_domain: 'acme.com' },
        { company_name: 'NewCo', discovered_domain: 'https://www.newco.com/about' },
      ]);
      const csv = readFileSync(join(dir, 'companies.csv'), 'utf8');
      assert.ok(csv.includes('newco.com'));
      assert.equal(csv.split('\n').filter((l) => l.includes('acme.com')).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
