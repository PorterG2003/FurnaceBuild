import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichPersonWithWaterfallEmail } from './apolloWaterfall.js';

describe('enrichPersonWithWaterfallEmail fixtures', () => {
  it('returns fixture email when useFixtures is true', async () => {
    const result = await enrichPersonWithWaterfallEmail(
      { firstName: 'Jane', lastName: 'Doe' },
      { token: 't', url: 'https://webhook.site/t' },
      { useFixtures: true },
    );
    assert.equal(result.email, 'jane.doe@example.com');
    assert.equal(result.waterfallStatus, 'accepted');
  });
});
