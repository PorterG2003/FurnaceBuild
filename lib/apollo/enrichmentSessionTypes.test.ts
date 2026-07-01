import test from 'node:test';
import assert from 'node:assert/strict';
import { isPendingEnrichmentSession, isTerminalEnrichmentSession } from './enrichmentSessionTypes';

test('isPendingEnrichmentSession is true only for non-expired pending_phone', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isPendingEnrichmentSession({ status: 'pending_phone', expires_at: future }), true);
  assert.equal(isPendingEnrichmentSession({ status: 'pending_phone', expires_at: past }), false);
  assert.equal(isPendingEnrichmentSession({ status: 'complete', expires_at: future }), false);
});

test('isTerminalEnrichmentSession excludes pending_phone', () => {
  assert.equal(isTerminalEnrichmentSession('pending_phone'), false);
  assert.equal(isTerminalEnrichmentSession('no_match'), true);
  assert.equal(isTerminalEnrichmentSession('no_phone'), true);
});
