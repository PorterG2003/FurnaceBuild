import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIcp, filterEntities, buildPostTextByUrl } from './icpFilter.js';
import type { Stage3Row } from '../lib/types.js';
import { loadIcpConfig } from '../lib/config.js';

const baseConfig = loadIcpConfig();

function entity(overrides: Partial<Stage3Row>): Stage3Row {
  return {
    company_name: 'Acme',
    company_domain: 'acme.com',
    company_linkedin_url: '',
    employee_count: '100',
    industry: 'Software',
    apollo_org_id: 'org_1',
    webinar_topic: '',
    webinar_date_mention: '',
    target_audience: '',
    registration_urls: '',
    sample_post_url: 'https://example.com/post-1',
    post_count: '1',
    entity_source: 'company_page',
    enrichment_status: 'ok',
    ...overrides,
  };
}

describe('icpFilter', () => {
  it('rejects not found enrichment', () => {
    const postTextByUrl = new Map<string, string>();
    const decision = evaluateIcp(entity({ enrichment_status: 'not_found' }), baseConfig, postTextByUrl);
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, 'enrichment_not_found');
  });

  it('rejects entities without apollo org id', () => {
    const postTextByUrl = new Map<string, string>();
    const decision = evaluateIcp(entity({ apollo_org_id: '' }), baseConfig, postTextByUrl);
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, 'no_apollo_org_id');
  });

  it('passes tiny company with pipeline post', () => {
    const postTextByUrl = new Map([
      ['https://example.com/post-1', 'Register for our webinar on demand generation.'],
    ]);
    const decision = evaluateIcp(entity({ employee_count: '3' }), baseConfig, postTextByUrl);
    assert.equal(decision.pass, true);
  });

  it('rejects pipeline-not-plausible post', () => {
    const postTextByUrl = new Map([
      ['https://example.com/post-1', 'Join our all-hands town hall for employees only.'],
    ]);
    const decision = evaluateIcp(entity({}), baseConfig, postTextByUrl);
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, 'pipeline_not_plausible');
  });

  it('filters entities into passed and rejected', () => {
    const postTextByUrl = buildPostTextByUrl([
      { result_url: 'https://example.com/good', post_text: 'Register for our product webinar.' },
      { result_url: 'https://example.com/bad', post_text: 'Mandatory staff training for employees only.' },
    ]);

    const { passed, rejected } = filterEntities(
      [
        entity({ sample_post_url: 'https://example.com/good' }),
        entity({ sample_post_url: 'https://example.com/bad', company_name: 'Internal Co' }),
      ],
      { icpConfig: baseConfig, postTextByUrl },
    );
    assert.equal(passed.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]!.rejection_reason, 'pipeline_not_plausible');
  });

  it('rejects blocked industries', () => {
    const postTextByUrl = new Map<string, string>();
    const decision = evaluateIcp(
      entity({ industry: 'Government Administration' }),
      baseConfig,
      postTextByUrl,
    );
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, 'industry_blocked');
  });

  it('rejects blocked entity names', () => {
    const postTextByUrl = new Map<string, string>();
    const decision = evaluateIcp(
      entity({ company_name: 'Canadian Armed Forces | Forces armées canadiennes', industry: 'Defense' }),
      baseConfig,
      postTextByUrl,
    );
    assert.equal(decision.pass, false);
    assert.equal(decision.reason, 'entity_blocked');
  });
});
