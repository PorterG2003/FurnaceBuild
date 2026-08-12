import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankContacts } from './contactRanker.js';
import { loadIcpConfig } from '../lib/config.js';
import type { ApolloPerson } from '../stage3-enrich/apolloClient.js';

const tiers = loadIcpConfig().contact_search.contact_tiers;

describe('contactRanker', () => {
  it('ranks marketing contact above engineer when both have emails', () => {
    const people: ApolloPerson[] = [
      {
        id: 'dev',
        first_name: 'Dev',
        last_name: 'Engineer',
        title: 'Software Engineer',
        email: 'dev@acme.com',
      },
      {
        id: 'sam',
        first_name: 'Sam',
        last_name: 'Growth',
        title: 'Director of Marketing',
        email: 'sam@acme.com',
      },
    ];

    const { people: ranked } = rankContacts(people, 2, tiers);
    assert.equal(ranked[0]!.email, 'sam@acme.com');
    assert.equal(ranked.length, 1);
  });

  it('prefers marketing and CEO for small companies after enrichment', () => {
    const people: ApolloPerson[] = [
      {
        id: 'partnerships',
        first_name: 'Adam',
        last_name: 'Partnerships',
        title: 'Head of Customer Partnerships',
        email: 'adam@ruli.ai',
      },
      {
        id: 'ceo',
        first_name: 'Bryan',
        last_name: 'Van',
        title: 'Co-founder & CEO',
        email: 'bryan@ruli.ai',
      },
      {
        id: 'mkt',
        first_name: 'Jenna',
        last_name: 'Marketing',
        title: 'Marketing Associate',
        email: 'jenna@ruli.ai',
      },
    ];

    const { people: ranked, slots } = rankContacts(people, 2, tiers);
    assert.equal(ranked[0]!.email, 'jenna@ruli.ai');
    assert.equal(ranked[1]!.email, 'bryan@ruli.ai');
    assert.equal(slots[0]!.tier, 'webinar_fill');
    assert.equal(slots[1]!.tier, 'executive');
  });

  it('returns only people with emails', () => {
    const people: ApolloPerson[] = [
      { id: 'no', first_name: 'No', last_name: 'Email', title: 'CEO' },
      { id: 'has', first_name: 'Has', last_name: 'Email', title: 'Founder', email: 'has@acme.com' },
    ];
    const { people: ranked } = rankContacts(people, 2, tiers);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]!.email, 'has@acme.com');
  });
});
