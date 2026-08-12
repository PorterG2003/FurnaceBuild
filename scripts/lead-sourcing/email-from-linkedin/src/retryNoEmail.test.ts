import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { createSchoolDomainResolver } from './resolveSchoolDomain.js';
import { retryNoEmailRow } from './retryNoEmail.js';
import type { EnrichedUniqueRow } from './types.js';

describe('retryNoEmailRow fixtures', () => {
  it('finds email via waterfall after domain resolve when rematch has no email', async () => {
    const counter = new CallCounter();
    const apolloOptions = { useFixtures: true, counter };
    const row: EnrichedUniqueRow = {
      linkedin_url: 'https://www.linkedin.com/in/ACoAAMikeRobertsStub',
      reactor_name: 'Mike Roberts',
      reactor_headline: 'Superintendent at Heard County Schools, Georgia',
      k12_role: 'K-12 Admin',
      source: 'Joe',
      email: '',
      first_name: 'Mike',
      last_name: 'Roberts',
      title: 'Superintendent',
      company_name: '',
      company_domain: '',
      apollo_person_id: '',
      enrichment_status: 'matched_no_email',
      match_method: 'name',
      error: '',
    };

    const result = await retryNoEmailRow(row, {
      apolloOptions,
      mvOptions: { useFixtures: true },
      resolveDomain: createSchoolDomainResolver(apolloOptions),
      waterfallInbox: { token: 'fixture', url: 'https://webhook.site/fixture' },
    });

    assert.equal(result.row.enrichment_status, 'email_found');
    assert.equal(result.row.email, 'mike.roberts@example.com');
    assert.equal(result.pass, 'pass1_waterfall');
    assert.equal(result.row.match_method, 'waterfall');
    // Domain-first should have resolved a school domain before waterfall
    assert.ok(result.row.company_domain, 'expected company_domain to be seeded');
    assert.match(result.row.company_domain, /\.k12\.us$/);
  });

  it('finds email via pattern+MV when Apollo has domain but no person email', async () => {
    const counter = new CallCounter();
    const apolloOptions = { useFixtures: true, counter };
    const email = 'unknown.person@acme-corp.com';
    const row: EnrichedUniqueRow = {
      linkedin_url: 'https://www.linkedin.com/in/ACoAAUnknownPattern',
      reactor_name: 'Unknown Person',
      reactor_headline: 'Principal at Acme Corp',
      k12_role: 'K-12 Principal',
      source: 'Joe',
      email: '',
      first_name: 'Unknown',
      last_name: 'Person',
      title: 'Principal',
      company_name: 'Acme Corp',
      company_domain: 'acme-corp.com',
      apollo_person_id: '',
      enrichment_status: 'matched_no_email',
      match_method: 'none',
      error: '',
    };

    const result = await retryNoEmailRow(row, {
      apolloOptions,
      mvOptions: {
        useFixtures: true,
        fixtureResults: {
          [email]: { email, result: 'ok', quality: 'good' },
        },
      },
      resolveDomain: createSchoolDomainResolver(apolloOptions),
    });

    assert.equal(result.row.enrichment_status, 'email_found');
    assert.equal(result.row.email, email);
    assert.equal(result.pass, 'pass3_pattern_mv');
    assert.equal(result.row.match_method, 'pattern_mv');
  });

  it('uses LLM fixture org when regex parse misses, then pattern+MV', async () => {
    const counter = new CallCounter();
    const apolloOptions = { useFixtures: true, counter };
    const email = 'paul.kish@clearviewlocalschools.k12.us';
    const row: EnrichedUniqueRow = {
      linkedin_url: 'https://www.linkedin.com/in/ACoAAClearviewLlm',
      reactor_name: 'Paul Kish',
      reactor_headline:
        'Director of Curriculum and Instruction Clearview Local Schools @PaulKish',
      k12_role: 'K-12 Admin',
      source: 'Joe',
      email: '',
      first_name: 'Paul',
      last_name: 'Kish',
      title: '',
      company_name: '',
      company_domain: '',
      apollo_person_id: '',
      enrichment_status: 'matched_no_email',
      match_method: 'none',
      error: '',
    };

    const result = await retryNoEmailRow(row, {
      apolloOptions,
      mvOptions: {
        useFixtures: true,
        fixtureResults: {
          [email]: { email, result: 'ok', quality: 'good' },
          'paul.kish@clearviewlocalschools.k12.us': { email, result: 'ok', quality: 'good' },
        },
      },
      resolveDomain: createSchoolDomainResolver(apolloOptions),
      llmOptions: { useFixtures: true, counter, enabled: true },
    });

    assert.equal(result.row.enrichment_status, 'email_found');
    assert.equal(result.pass, 'pass3_pattern_mv');
    assert.match(result.row.company_domain, /clearview/i);
    assert.ok(counter.counts.openrouter_calls >= 1);
  });
});
