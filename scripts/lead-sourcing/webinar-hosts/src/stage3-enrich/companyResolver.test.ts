import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectNameCandidates,
  extractRealDomainFromUrls,
  isPlatformDomain,
  resolveCompany,
} from './companyResolver.js';
import { rowToRecord, type Stage2Row } from '../lib/types.js';
import { CallCounter } from '../lib/callCounter.js';

function stage2Row(partial: Partial<Stage2Row>): Stage2Row {
  return rowToRecord({
    result_url: 'https://www.linkedin.com/posts/acme-corp_webinar-activity-123',
    result_title: 'Acme Corp on LinkedIn: Register for our webinar',
    result_snippet: '',
    search_query: '',
    serp_position: '1',
    serp_page: '1',
    collected_at: '',
    slug_hint: 'acme-corp register for our webinar',
    also_matched_queries: '',
    post_text: '',
    author_name: 'Acme Corp',
    author_profile_url: 'https://www.linkedin.com/company/acme-corp',
    author_employer_name: '',
    author_employer_linkedin_url: '',
    entity_type: 'company',
    registration_urls: '',
    posted_at: '',
    extraction_status: 'ok',
    extraction_error: '',
    ...partial,
  }) as Stage2Row;
}

describe('companyResolver', () => {
  it('excludes webinar platform and shortlink domains', () => {
    assert.equal(isPlatformDomain('zoom.us'), true);
    assert.equal(isPlatformDomain('www.eventbrite.com'), true);
    assert.equal(isPlatformDomain('lnkd.in'), true);
    assert.equal(isPlatformDomain('bit.ly'), true);
    assert.equal(isPlatformDomain('acme.com'), false);
  });

  it('picks real domain from registration urls skipping platforms', () => {
    const domain = extractRealDomainFromUrls([
      'https://lnkd.in/abc123',
      'https://us06web.zoom.us/webinar/register/WN_abc',
      'https://www.acme.com/webinar/register',
    ]);
    assert.equal(domain, 'acme.com');
  });

  it('collects name candidates from post mentions', () => {
    const row = stage2Row({
      post_text: 'Join us at BeNeering for a masterclass with @Acme Corp partners',
      author_name: 'Jane Doe',
      entity_type: 'person',
    });
    const names = collectNameCandidates(row);
    assert.ok(names.some((n) => n.includes('BeNeering') || n.includes('Acme')));
  });

  it('never drops row with free hints when apollo budget exhausted', async () => {
    const row = stage2Row({
      entity_type: 'person',
      author_name: 'Jane Doe',
      author_profile_url: 'https://www.linkedin.com/in/jane-doe-12345',
      registration_urls: 'https://www.example-host.com/register',
    });
    const counter = new CallCounter();
    counter.counts.apollo_org_calls = 100;
    counter.counts.apollo_people_calls = 100;

    const result = await resolveCompany(row, ['https://www.example-host.com/register'], {
      apolloOptions: { useFixtures: true, counter },
      apolloBudgetRemaining: () => false,
    });

    assert.equal(result.enrichmentStatus, 'partial');
    assert.equal(result.freeDomain, 'example-host.com');
    assert.equal(counter.counts.apollo_org_calls, 100);
  });

  it('resolves company page via linkedin before person search in fixtures', async () => {
    const row = stage2Row({});
    const counter = new CallCounter();

    const result = await resolveCompany(row, [], {
      apolloOptions: { useFixtures: true, counter },
      apolloBudgetRemaining: () => true,
    });

    assert.equal(result.enrichmentStatus, 'ok');
    assert.equal(result.entitySource, 'company_page');
    assert.equal(counter.counts.apollo_people_calls, 0);
  });

  it('prioritizes profile employer name over serp fallback for person posts', () => {
    const row = stage2Row({
      entity_type: 'person',
      author_name: 'Jane Doe',
      author_employer_name: 'GrowthCo',
      result_title: "Jane Doe's Post - LinkedIn",
    });
    const names = collectNameCandidates(row);
    assert.equal(names[0], 'GrowthCo');
  });
});
