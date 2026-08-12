import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { readCsv } from '../../webinar-hosts/src/lib/csv.js';
import { normalizeLinkedInProfileUrl } from '../../webinar-hosts/src/stage2-linkedin/linkedinParser.js';
import { writeOutputs } from './checkpoint.js';
import { enrichReactorProfile } from './enrichPerson.js';
import type { ScrapeRow } from './types.js';

const fixturesSample = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../fixtures/sample-reactors.csv',
);

describe('enrichReactorProfile fixtures', () => {
  it('resolves ACo member URL via name match and vanity URL via LinkedIn match', async () => {
    const counter = new CallCounter();
    const options = { useFixtures: true, counter };

    const aco: ScrapeRow = {
      source: 'Joe',
      post_url: 'https://example.com/1',
      reactor_name: 'Mike Roberts',
      reactor_profile_url: 'https://www.linkedin.com/in/ACoAAGASxXQBAnJoI2pBoc-PKeDwAOmE66g539c',
      reactor_headline: 'Superintendent at Heard County Schools, Georgia',
      k12_role: 'K-12 Admin',
      reaction_type: 'LIKE',
    };
    const acoUrl = normalizeLinkedInProfileUrl(aco.reactor_profile_url);
    const acoResult = await enrichReactorProfile(aco, acoUrl, options);
    assert.equal(acoResult.row.enrichment_status, 'email_found');
    assert.equal(acoResult.row.match_method, 'name');
    assert.equal(acoResult.row.email, 'mike.roberts@heard.k12.ga.us');

    const vanity: ScrapeRow = {
      source: 'Joe',
      post_url: 'https://example.com/2',
      reactor_name: 'Jane Doe',
      reactor_profile_url: 'https://www.linkedin.com/in/jane-doe-12345',
      reactor_headline: 'Growth Marketing Manager at GrowthCo',
      k12_role: 'K-12 Principal',
      reaction_type: 'LIKE',
    };
    const vanityUrl = normalizeLinkedInProfileUrl(vanity.reactor_profile_url);
    const vanityResult = await enrichReactorProfile(vanity, vanityUrl, options);
    assert.equal(vanityResult.row.enrichment_status, 'email_found');
    assert.equal(vanityResult.row.match_method, 'linkedin_url');
    assert.equal(vanityResult.row.email, 'jane.doe@growthco.io');

    assert.ok(counter.counts.apollo_people_calls >= 2);
  });

  it('writes with_email output for fixture sample rows', async () => {
    const counter = new CallCounter();
    const options = { useFixtures: true, counter };
    const rows = readCsv(fixturesSample);
    const unique = new Map<string, ScrapeRow>();
    for (const raw of rows) {
      const row: ScrapeRow = {
        source: raw.source ?? '',
        post_url: raw.post_url ?? '',
        reactor_name: raw.reactor_name ?? '',
        reactor_profile_url: raw.reactor_profile_url ?? '',
        reactor_headline: raw.reactor_headline ?? '',
        k12_role: raw.k12_role ?? '',
        reaction_type: raw.reaction_type ?? '',
      };
      const url = normalizeLinkedInProfileUrl(row.reactor_profile_url);
      if (!unique.has(url)) unique.set(url, row);
    }

    const results = [];
    for (const [url, sample] of unique) {
      const { row } = await enrichReactorProfile(sample, url, options);
      results.push(row);
    }

    const dir = mkdtempSync(join(tmpdir(), 'email-from-linkedin-'));
    try {
      writeOutputs(dir, results);
      const withEmail = readCsv(join(dir, 'with_email.csv'));
      assert.ok(withEmail.length >= 2);
      assert.ok(withEmail.every((row) => row.email?.includes('@')));
      const uniqueCsv = readFileSync(join(dir, 'enriched_unique.csv'), 'utf8');
      assert.match(uniqueCsv, /email_found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
