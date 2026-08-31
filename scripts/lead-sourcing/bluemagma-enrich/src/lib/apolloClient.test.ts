import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fundingFieldsFromOrg,
  emptyFundingFields,
  type ApolloOrganization,
} from './apolloClient.js';

describe('fundingFieldsFromOrg', () => {
  it('extracts funding from a fully-populated org', () => {
    const org: ApolloOrganization = {
      id: 'org_1',
      name: 'Acme',
      total_funding: 50000000,
      total_funding_printed: '50M',
      latest_funding_stage: 'Series C',
      latest_funding_round_date: '2024-03-15T00:00:00.000+00:00',
      funding_events: [
        { id: 'e1', date: '2024-03-15T00:00:00.000+00:00', type: 'Series C', amount: '30M', currency: '$', investors: 'Sequoia' },
        { id: 'e2', date: '2022-01-10T00:00:00.000+00:00', type: 'Series B', amount: '20M', currency: '$', investors: 'a16z' },
      ],
    };
    const f = fundingFieldsFromOrg(org);
    assert.equal(f.total_funding, '50000000');
    assert.equal(f.total_funding_printed, '50M');
    assert.equal(f.latest_funding_stage, 'Series C');
    assert.equal(f.latest_funding_round_date, '2024-03-15');
    const events = JSON.parse(f.funding_events);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'Series C');
  });

  it('returns empty strings for null org', () => {
    const f = fundingFieldsFromOrg(null);
    assert.deepEqual(f, emptyFundingFields());
  });

  it('returns empty strings for org without funding', () => {
    const org: ApolloOrganization = { id: 'org_2', name: 'NoCash Inc' };
    const f = fundingFieldsFromOrg(org);
    assert.equal(f.total_funding, '');
    assert.equal(f.total_funding_printed, '');
    assert.equal(f.latest_funding_stage, '');
    assert.equal(f.latest_funding_round_date, '');
    assert.equal(f.funding_events, '');
  });

  it('handles zero total_funding distinctly from missing', () => {
    const org: ApolloOrganization = { id: 'org_3', name: 'Bootstrap', total_funding: 0 };
    const f = fundingFieldsFromOrg(org);
    assert.equal(f.total_funding, '0');
  });

  it('returns empty events string for empty array', () => {
    const org: ApolloOrganization = { id: 'org_4', name: 'Test', funding_events: [] };
    const f = fundingFieldsFromOrg(org);
    assert.equal(f.funding_events, '');
  });
});
