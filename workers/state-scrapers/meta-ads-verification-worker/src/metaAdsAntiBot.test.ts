import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEmptyNoResult,
  pickSessionRotationInterval,
  shouldRetryEmptyNoResult,
} from './metaAdsAntiBot.js';
import type { MetaAdLibraryLookupResult } from './metaAdLibraryLookup.js';

function emptyNoResult(): MetaAdLibraryLookupResult {
  return {
    result: 'no',
    search_domain: 'acme.com',
    input_domain: 'acme.com',
    search_term_used: 'acme.com',
    fallback_search_term: null,
    matched_page_id: null,
    matched_page_name: null,
    page_url: null,
    latest_ad_last_shown_at: null,
    signals: {
      search_attempts: [
        {
          result_card_count: 0,
          reason: 'no_results',
        },
      ],
    },
    lookup_stats: {},
  };
}

test('isEmptyNoResult detects Meta empty responses', () => {
  assert.equal(isEmptyNoResult(emptyNoResult()), true);
  assert.equal(
    isEmptyNoResult({
      ...emptyNoResult(),
      result: 'yes',
    }),
    false,
  );
});

test('shouldRetryEmptyNoResult stops after max retries', () => {
  const result = emptyNoResult();
  assert.equal(shouldRetryEmptyNoResult(result, 0, 2), true);
  assert.equal(shouldRetryEmptyNoResult(result, 2, 2), false);
});

test('pickSessionRotationInterval stays near base', () => {
  const value = pickSessionRotationInterval(20, 5);
  assert.ok(value >= 15 && value <= 25);
});
