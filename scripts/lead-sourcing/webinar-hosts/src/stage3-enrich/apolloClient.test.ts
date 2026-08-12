import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapOrganization, splitName, pickBestContact, enrichPersonByLinkedIn } from './apolloClient.js';

describe('apolloClient mapping', () => {
  it('maps organization fields', () => {
    const mapped = mapOrganization({
      id: 'org_1',
      name: 'Acme',
      primary_domain: 'acme.com',
      linkedin_url: 'https://linkedin.com/company/acme',
      estimated_num_employees: 50,
      industry: 'Software',
    });
    assert.equal(mapped.company_name, 'Acme');
    assert.equal(mapped.employee_count, '50');
  });

  it('splits names and picks contact with email', () => {
    assert.deepEqual(splitName('Jane Doe'), { first_name: 'Jane', last_name: 'Doe' });
    const best = pickBestContact([
      { first_name: 'A', last_name: 'B' },
      { first_name: 'C', last_name: 'D', email: 'c@example.com' },
    ]);
    assert.equal(best?.email, 'c@example.com');
  });

  it('enriches person by linkedin url via people/match fixtures', async () => {
    const person = await enrichPersonByLinkedIn('https://www.linkedin.com/in/jane-doe-12345', {
      useFixtures: true,
    });
    assert.equal(person?.organization?.name, 'GrowthCo');
    assert.equal(person?.email, 'jane.doe@growthco.io');
  });
});
