import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expandRegistrationUrls, expandUrl } from './urlExpander.js';

describe('urlExpander', () => {
  it('skips network expansion in fixture mode', async () => {
    const cache: Record<string, string> = {};
    const url = 'https://lnkd.in/abc123';
    const result = await expandUrl(url, cache, { useFixtures: true });
    assert.equal(result, url);
    assert.equal(cache[url], url);
  });

  it('dedupes expanded registration urls', async () => {
    const cache: Record<string, string> = {};
    const { expanded } = await expandRegistrationUrls(
      ['https://acme.com/reg', 'https://acme.com/reg'],
      cache,
      { useFixtures: true },
    );
    assert.equal(expanded.length, 1);
    assert.equal(expanded[0], 'https://acme.com/reg');
  });
});
