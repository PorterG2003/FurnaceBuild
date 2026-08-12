import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { mergeCompanies, normalizeDomain, prepCompanies, rowToCompany } from './prepCompanies.js';

describe('normalizeDomain', () => {
  it('strips protocol www and path', () => {
    assert.equal(normalizeDomain('https://www.Acme.com/about'), 'acme.com');
    assert.equal(normalizeDomain('HTTP://FOO.IO/'), 'foo.io');
  });
});

describe('rowToCompany', () => {
  it('reads Zoho Domain / Company Name columns', () => {
    const company = rowToCompany(
      { Domain: 'teramind.co', 'Company Name': 'Teramind' },
      'new-hire.csv',
    );
    assert.deepEqual(company, {
      company_name: 'Teramind',
      company_domain: 'teramind.co',
      source_lists: 'new-hire.csv',
    });
  });

  it('reads Company Domain column', () => {
    const company = rowToCompany(
      { 'Company Domain': 'agoradata.com', 'Company Name': 'Agora Data, Inc.' },
      'jobs.csv',
    );
    assert.equal(company?.company_domain, 'agoradata.com');
  });
});

describe('mergeCompanies', () => {
  it('dedupes domains and merges source lists', () => {
    const merged = mergeCompanies([
      { company_name: 'A', company_domain: 'a.com', source_lists: 'one.csv' },
      { company_name: 'A Inc', company_domain: 'a.com', source_lists: 'two.csv' },
      { company_name: 'B', company_domain: 'b.com', source_lists: 'one.csv' },
    ]);
    assert.equal(merged.length, 2);
    const a = merged.find((c) => c.company_domain === 'a.com');
    assert.ok(a?.source_lists.includes('one.csv'));
    assert.ok(a?.source_lists.includes('two.csv'));
  });
});

describe('prepCompanies', () => {
  it('writes companies.csv and copies sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'company-contacts-prep-'));
    const a = join(dir, 'a.csv');
    const b = join(dir, 'b.csv');
    writeFileSync(a, 'Company Name,Domain\nAcme,acme.com\nDup,dup.com\n');
    writeFileSync(b, 'Company Name,Company Domain\nDup Co,dup.com\nBeta,beta.io\n');
    const runDir = join(dir, 'run');
    try {
      const result = prepCompanies({ inputPaths: [a, b], runDir });
      assert.equal(result.companies.length, 3);
      const csv = readFileSync(join(runDir, 'companies.csv'), 'utf8');
      assert.ok(csv.includes('acme.com'));
      assert.ok(csv.includes('dup.com'));
      assert.ok(csv.includes('a.csv|b.csv') || csv.includes('b.csv|a.csv'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
