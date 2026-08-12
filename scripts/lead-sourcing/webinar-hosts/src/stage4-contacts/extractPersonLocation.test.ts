import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractPersonLocation } from '../stage3-enrich/apolloClient.js';

describe('extractPersonLocation', () => {
  it('prefers person city/state/country', () => {
    assert.deepEqual(
      extractPersonLocation({
        city: 'Austin',
        state: 'Texas',
        country: 'United States',
        organization: { city: 'London', state: '', country: 'United Kingdom' },
      }),
      { city: 'Austin', state: 'Texas', country: 'United States' },
    );
  });

  it('falls back to organization location', () => {
    assert.deepEqual(
      extractPersonLocation({
        organization: { city: 'Toronto', state: 'Ontario', country: 'Canada' },
      }),
      { city: 'Toronto', state: 'Ontario', country: 'Canada' },
    );
  });

  it('returns empty strings when missing', () => {
    assert.deepEqual(extractPersonLocation(null), { city: '', state: '', country: '' });
  });
});
