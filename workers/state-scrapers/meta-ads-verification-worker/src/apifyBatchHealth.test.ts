import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countPostCliffEmptyNoResults,
  detectCliffIndex,
  findKnownAdvertiserFalseNegatives,
  isEmptyNoResultRow,
  orderResultsByCompletion,
  summarizeWindow,
} from './apifyBatchHealth.js';
import {
  createEmptyApifyCheckpoint,
  unmarkApifyCheckpointDomains,
} from './metaAdLibraryApifyCheckpoint.js';

function emptyRow(domain: string): Record<string, unknown> {
  return {
    company_domain: domain,
    meta_ads_result: 'no',
    classification_reason: 'no_results',
    apify_total_count: 0,
  };
}

function yesRow(domain: string): Record<string, unknown> {
  return {
    company_domain: domain,
    meta_ads_result: 'yes',
    classification_reason: 'single_domain_match',
    apify_total_count: 3,
  };
}

test('isEmptyNoResultRow detects poisoned empties', () => {
  assert.equal(isEmptyNoResultRow(emptyRow('a.com')), true);
  assert.equal(isEmptyNoResultRow(yesRow('a.com')), false);
  assert.equal(
    isEmptyNoResultRow({
      meta_ads_result: 'no',
      classification_reason: 'no_results',
      apify_total_count: 2,
    }),
    false,
  );
});

test('detectCliffIndex finds first all-empty window', () => {
  const domains = [...Array.from({ length: 30 }, (_, i) => `early${i}.com`), ...Array.from({ length: 60 }, (_, i) => `late${i}.com`)];
  const results = [
    ...Array.from({ length: 30 }, (_, i) => yesRow(`early${i}.com`)),
    ...Array.from({ length: 60 }, (_, i) => emptyRow(`late${i}.com`)),
  ];
  const ordered = orderResultsByCompletion(domains, results);
  const cliff = detectCliffIndex(ordered, 50);
  assert.equal(cliff, 30);
  assert.equal(countPostCliffEmptyNoResults(ordered, cliff!), 60);
});

test('findKnownAdvertiserFalseNegatives lists google empties', () => {
  const ordered = orderResultsByCompletion(
    ['zendesk.com', 'google.com'],
    [yesRow('zendesk.com'), emptyRow('google.com')],
  );
  const hits = findKnownAdvertiserFalseNegatives(ordered);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.domain, 'google.com');
});

test('summarizeWindow counts hits', () => {
  const ordered = orderResultsByCompletion(
    ['a.com', 'b.com'],
    [yesRow('a.com'), emptyRow('b.com')],
  );
  const stats = summarizeWindow(ordered, 0, 2);
  assert.equal(stats.yes, 1);
  assert.equal(stats.apifyHits, 1);
  assert.equal(stats.emptyNoResults, 1);
});

test('unmarkApifyCheckpointDomains removes streak domains', () => {
  const checkpoint = createEmptyApifyCheckpoint({
    csvPath: '/tmp/x.csv',
    outDir: '/tmp/out',
    batchMode: 'all',
    maxRows: null,
    actor: 'leadsbrary',
    webinarScanDays: 90,
  });
  checkpoint.completedDomains = ['a.com', 'b.com', 'c.com'];
  checkpoint.results = [yesRow('a.com'), emptyRow('b.com'), emptyRow('c.com')];
  const removed = unmarkApifyCheckpointDomains(checkpoint, ['b.com', 'c.com']);
  assert.equal(removed, 2);
  assert.deepEqual(checkpoint.completedDomains, ['a.com']);
  assert.equal(checkpoint.results.length, 1);
});

test('isMetaRateLimitText detects Meta #613', async () => {
  const { isMetaRateLimitText } = await import('./apifyMetaAdsClient.js');
  assert.equal(
    isMetaRateLimitText('Meta API 400: (#613) Calls to this api have exceeded the rate limit.'),
    true,
  );
  assert.equal(isMetaRateLimitText('Found 1 ads'), false);
});
