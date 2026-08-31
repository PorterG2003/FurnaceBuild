import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyCompany } from '../types.js';
import { applyEnrichedOrg, enrichRequest } from './orgEnrich.js';

test('enrich prefers domain, then apollo id, then name', () => {
  assert.deepEqual(enrichRequest(emptyCompany({ company_id: 'a', name: 'Acme', domain: 'acme.com' })), {
    domain: 'acme.com',
  });
  assert.deepEqual(
    enrichRequest(emptyCompany({ company_id: 'b', name: 'Acme', apollo_org_id: 'org_1' })),
    { id: 'org_1' },
  );
  assert.deepEqual(enrichRequest(emptyCompany({ company_id: 'c', name: 'Acme' })), { name: 'Acme' });
});

test('applyEnrichedOrg fills missing street and employees and treats revenue 0 as unknown', () => {
  const company = emptyCompany({
    company_id: 'dom:acme.com',
    name: 'Acme',
    domain: 'acme.com',
    street: '',
    employees: null,
    revenue_est: 0,
  });
  const next = applyEnrichedOrg(
    company,
    {
      id: 'org_1',
      primary_domain: 'acme.com',
      street_address: '100 Main St',
      city: 'Lehi',
      state: 'Utah',
      estimated_num_employees: 32,
      annual_revenue: 2_400_000,
    },
    'hash-1',
  );
  assert.equal(next.street, '100 Main St');
  assert.equal(next.city, 'Lehi');
  assert.equal(next.employees, 32);
  assert.equal(next.revenue_est, 2_400_000);
  assert.equal(next.provenance.street.source, 'apollo-enrich');
});
