import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCeWebinarText, mergeWebinarHostsIntoProspects } from './mergeHosts.js';
import type { ProspectRow } from '../lib/types.js';

describe('webinar-hosts CE slice', () => {
  it('detects CE credit language', () => {
    assert.equal(isCeWebinarText('Earn 1 CE credit'), true);
    assert.equal(isCeWebinarText('Join our product launch'), false);
  });

  it('dedupes webinar hosts onto directory prospects by domain', () => {
    const existing: ProspectRow[] = [
      {
        company_name: 'PESI',
        fit_tier: 0,
        host_tier: 1,
        activity_count: 1,
        entity_class: 'education_company',
        self_provided: false,
        is_free: null,
        registration_kind: 'own_domain',
        registration_host_domain: 'pesi.com',
        audience_profession: 'counselor',
        audience_relationship: 'customer',
        company_sells_what: '',
        has_formal_grant_program: false,
        ce_formats: 'live_online',
        primary_ce_format: 'live_online',
        has_live_online: true,
        source_directories: 'nbcc',
        example_urls: 'https://pesi.com/webinars',
        needs_review: false,
        easy_audience_access_review: '',
      },
    ];
    const merged = mergeWebinarHostsIntoProspects(existing, [
      { company_name: 'PESI, Inc', company_domain: 'pesi.com', sample_url: 'https://linkedin.com/x', snippet: 'CE' },
      { company_name: 'NextTherapist', company_domain: 'nexttherapist.com', sample_url: 'https://linkedin.com/y', snippet: 'CEU' },
    ]);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((r) => /nexttherapist/i.test(r.company_name)));
  });
});
