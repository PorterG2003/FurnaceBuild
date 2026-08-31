import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixturesDir } from './lib/env.js';
import { readCsv } from './lib/csv.js';
import { prepAvoidList } from './prep.js';
import { decideResult, resolveLookups } from './resolve.js';
import { mergeResults } from './merge.js';

describe('fixture pipeline', () => {
  it('does not promote a website hostname without an observed email', () => {
    const result = decideResult({
      lookup: {
        lookup_key: 'district:example',
        kind: 'district',
        name: 'Example School District',
        city: 'Example',
        state: 'CA',
        mega: false,
      },
      query: '"Example School District" official website',
      best: {
        url: 'https://exampledistrict.org',
        domain: 'exampledistrict.org',
        source: 'organic',
        position: 1,
        score: 0.8,
        tier: 'high',
        reasons: ['domain_brand_token'],
        vendor: false,
      },
      websiteUrl: 'https://exampledistrict.org',
      websiteTitle: 'Example School District',
      emails: [],
      extraNotes: [],
    });

    assert.equal(result.chosen_domain, '');
    assert.equal(result.confidence, 'ask');
    assert.match(result.notes, /website_domain_only:exampledistrict\.org/);
  });

  it('resolves observed school and district email domains, including mega-districts', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'tm-avoid-domains-'));
    try {
      const prep = prepAvoidList({
        inputCsv: join(fixturesDir, 'avoid-list-sample.csv'),
        runDir,
      });
      assert.equal(prep.accounts, 7);
      assert.equal(prep.skipped, 1);
      assert.equal(prep.lookups, 6);

      await resolveLookups({ runDir, fixtures: true });
      const lookups = readCsv(join(runDir, 'lookup_results.csv'));
      const byName = Object.fromEntries(lookups.map((r) => [r.name, r]));

      assert.equal(byName['San Bernardino City Unified School District']?.chosen_domain, 'sbcusd.com');
      assert.equal(byName['San Bernardino City Unified School District']?.confidence, 'high');
      assert.match(byName['San Bernardino City Unified School District']?.extracted_emails ?? '', /sbcusd\.com/);

      assert.equal(byName['Annunciation Catholic Academy']?.chosen_domain, 'acaschool.org');
      assert.equal(byName['Annunciation Catholic Academy']?.confidence, 'high');

      assert.equal(byName['Alpine District']?.chosen_domain, 'alpinedistrict.org');
      assert.equal(byName['Alpine District']?.confidence, 'high');

      assert.equal(byName['Los Angeles Unified']?.chosen_domain, 'lausd.net');
      assert.equal(byName['Los Angeles Unified']?.confidence, 'high');

      assert.equal(byName['Pinecrest Academy of Northern Nevada']?.chosen_domain, 'pinecrestnnv.org');
      assert.equal(byName['Encino Charter Elementary']?.chosen_domain, 'encinocharter.net');
      assert.equal(byName['Encino Charter Elementary']?.confidence, 'high');

      const merged = mergeResults(runDir);
      assert.equal(merged.review, 7);

      const unique = readCsv(join(runDir, 'unique_domains.csv'));
      const uniqueSet = new Set(unique.map((r) => r.domain));
      assert.ok(uniqueSet.has('sbcusd.com'));
      assert.ok(uniqueSet.has('acaschool.org'));
      assert.ok(uniqueSet.has('alpinedistrict.org'));
      assert.ok(uniqueSet.has('pinecrestnnv.org'));
      assert.ok(uniqueSet.has('encinocharter.net'));
      assert.ok(uniqueSet.has('lausd.net'));

      const ask = readCsv(join(runDir, 'ask_queue.csv'));
      assert.equal(ask.length, 0);

      const review = readCsv(join(runDir, 'row_review.csv'));
      const testRow = review.find((r) => r.account_name === 'JP TEST ACCOUNT');
      assert.equal(testRow?.skipped, 'true');
      const delRosa = review.find((r) => r.account_name === 'Del Rosa Elementary');
      assert.equal(delRosa?.chosen_domains, 'sbcusd.com');
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
