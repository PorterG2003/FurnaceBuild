import assert from 'node:assert/strict';
import test from 'node:test';
import { apolloOrgToHit, normalizeApolloRecord, queryCityFromLocation } from './apolloSearch.js';

test('accounts bucket uses organization_id not account id', () => {
  const n = normalizeApolloRecord(
    {
      id: 'acct_wce',
      organization_id: 'org_wce',
      domain: 'wasatchce.test',
      organization: { id: 'org_wce', name: 'Wasatch CE Institute', primary_domain: 'wasatchce.test' },
    },
    'accounts',
  );
  assert.equal(n.orgId, 'org_wce');
  assert.equal(n.domain, 'wasatchce.test');
  const hit = apolloOrgToHit(n.org, n.orgId, n.domain, 'h', {
    query_city: 'Lehi',
    search_employee_band: '11,20',
  });
  assert.equal(hit.apollo_org_id, 'org_wce');
  assert.equal(hit.query_city, 'Lehi');
  assert.equal(hit.search_employee_band, '11,20');
});

test('organizations bucket uses id and primary_domain', () => {
  const n = normalizeApolloRecord(
    { id: 'org_acme', name: 'Acme', primary_domain: 'acmeindustrial.test' },
    'organizations',
  );
  assert.equal(n.orgId, 'org_acme');
  assert.equal(n.domain, 'acmeindustrial.test');
});

test('query city is the Apollo location prefix', () => {
  assert.equal(queryCityFromLocation('Lehi, Utah, United States'), 'Lehi');
  assert.equal(queryCityFromLocation('Salt Lake City, Utah, United States'), 'Salt Lake City');
});
