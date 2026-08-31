import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFetchableUrl } from './url.js';
import { mapWithConcurrency } from './pool.js';

describe('fetch helpers', () => {
  it('rejects empty or concatenated directory websites', () => {
    assert.equal(isFetchableUrl('http://'), false);
    assert.equal(isFetchableUrl('http://www.16pf.com AND https://www.psionline.com/talent-measurement/'), false);
    assert.equal(isFetchableUrl('https://pesi.com/ce'), true);
  });

  it('maps with a bounded worker pool in input order', async () => {
    const seen: number[] = [];
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    assert.equal(seen.length, 5);
  });
});
