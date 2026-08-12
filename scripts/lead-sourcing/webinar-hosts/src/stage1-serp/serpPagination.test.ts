import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLastSerpPage, SERP_RESULTS_PER_PAGE } from './serpPagination.js';

describe('serpPagination', () => {
  it('detects last SERP page from result count', () => {
    assert.equal(isLastSerpPage(0), true);
    assert.equal(isLastSerpPage(7), true);
    assert.equal(isLastSerpPage(SERP_RESULTS_PER_PAGE), false);
  });
});
