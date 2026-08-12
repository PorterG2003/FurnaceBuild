import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeDomain, toCohortCompany } from './types.js';
import { estimateLinkedInProspeo, estimateMetaApollo } from './cohortPrep.js';

describe('normalizeDomain', () => {
  it('strips protocol and www', () => {
    assert.equal(normalizeDomain('https://www.Example.com/path'), 'example.com');
  });

  it('rejects generic landing hosts', () => {
    assert.equal(normalizeDomain('zoom.us'), '');
    assert.equal(normalizeDomain('https://facebook.com/page'), '');
    assert.equal(normalizeDomain('bit.ly/abc'), '');
    assert.equal(normalizeDomain('lnkd.in/xyz'), '');
  });

  it('keeps real company domains', () => {
    assert.equal(normalizeDomain('acme.io'), 'acme.io');
  });
});

describe('estimates', () => {
  it('splits linkedin named vs company path', () => {
    const companies = [
      toCohortCompany({
        platform: 'linkedin',
        company_name: 'A',
        company_url: '',
        landing_url: 'https://a.com',
        landing_domain: 'a.com',
        person_name: 'Jane Doe',
        ad_library_url: '',
        ad_id: '1',
        ad_headline: '',
        ad_copy: '',
        ad_active_from: '',
        phrases_found: '',
        qualifying_ad_count: '',
        source_runs: '',
      }),
      toCohortCompany({
        platform: 'linkedin',
        company_name: 'B',
        company_url: '',
        landing_url: '',
        landing_domain: '',
        person_name: '',
        ad_library_url: '',
        ad_id: '2',
        ad_headline: '',
        ad_copy: '',
        ad_active_from: '',
        phrases_found: '',
        qualifying_ad_count: '',
        source_runs: '',
      }),
    ];
    const est = estimateLinkedInProspeo(companies);
    assert.equal(est.named_person_rows, 1);
    assert.equal(est.company_path_rows, 1);
    assert.ok(est.estimated_credits_worst >= 4);
  });

  it('gates meta apollo on usable domain', () => {
    const companies = [
      toCohortCompany({
        platform: 'meta',
        company_name: 'With Domain',
        company_url: '',
        landing_url: 'https://good.co',
        landing_domain: 'good.co',
        person_name: '',
        ad_library_url: '',
        ad_id: '1',
        ad_headline: '',
        ad_copy: '',
        ad_active_from: '',
        phrases_found: '',
        qualifying_ad_count: '',
        source_runs: '',
      }),
      toCohortCompany({
        platform: 'meta',
        company_name: 'Zoom Landing',
        company_url: '',
        landing_url: 'https://zoom.us/j/1',
        landing_domain: 'zoom.us',
        person_name: '',
        ad_library_url: '',
        ad_id: '2',
        ad_headline: '',
        ad_copy: '',
        ad_active_from: '',
        phrases_found: '',
        qualifying_ad_count: '',
        source_runs: '',
      }),
    ];
    const est = estimateMetaApollo(companies);
    assert.equal(est.domain_gated, 1);
    assert.equal(est.deferred_no_domain, 1);
    assert.equal(est.estimated_apollo_org_calls, 1);
  });
});
