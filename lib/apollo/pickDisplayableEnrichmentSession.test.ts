import test from 'node:test';
import assert from 'node:assert/strict';
import type { ApolloEnrichmentSessionRow } from './enrichmentSessionTypes';
import {
  hasDisplayableEnrichmentSession,
  pickDisplayableEnrichmentSession,
} from './pickDisplayableEnrichmentSession';

const futureExpiry = new Date(Date.now() + 60 * 60_000).toISOString();
const pastExpiry = new Date(Date.now() - 60_000).toISOString();

function session(
  overrides: Partial<ApolloEnrichmentSessionRow> & Pick<ApolloEnrichmentSessionRow, 'id' | 'status'>,
): ApolloEnrichmentSessionRow {
  return {
    account_id: 'acc-1',
    global_lead_id: 'lead-1',
    created_by: null,
    sync_suggestion: null,
    phone_numbers: null,
    expires_at: futureExpiry,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
    ...overrides,
  };
}

test('pickDisplayableEnrichmentSession prefers newer pending over older complete', () => {
  const rows = [
    session({
      id: 'pending-1',
      status: 'pending_phone',
      created_at: '2026-06-02T12:00:00.000Z',
      sync_suggestion: { name: 'Pending Match' },
    }),
    session({
      id: 'complete-1',
      status: 'complete',
      created_at: '2026-06-01T12:00:00.000Z',
      sync_suggestion: { name: 'Old Match' },
    }),
  ];

  const picked = pickDisplayableEnrichmentSession(rows);
  assert.equal(picked?.id, 'pending-1');
});

test('pickDisplayableEnrichmentSession skips expired pending_phone', () => {
  const rows = [
    session({
      id: 'stale-pending',
      status: 'pending_phone',
      expires_at: pastExpiry,
      sync_suggestion: { name: 'Stale' },
    }),
    session({
      id: 'no-match',
      status: 'no_match',
      created_at: '2026-06-01T11:00:00.000Z',
    }),
  ];

  const picked = pickDisplayableEnrichmentSession(rows);
  assert.equal(picked?.id, 'no-match');
});

test('pickDisplayableEnrichmentSession returns no_match without sync_suggestion', () => {
  const rows = [
    session({ id: 'no-match', status: 'no_match' }),
  ];
  assert.equal(pickDisplayableEnrichmentSession(rows)?.id, 'no-match');
  assert.equal(hasDisplayableEnrichmentSession(rows), true);
});

test('pickDisplayableEnrichmentSession ignores failed and complete without suggestion', () => {
  const rows = [
    session({ id: 'failed', status: 'failed' as ApolloEnrichmentSessionRow['status'] }),
    session({ id: 'empty-complete', status: 'complete', sync_suggestion: null }),
  ];
  assert.equal(pickDisplayableEnrichmentSession(rows), null);
  assert.equal(hasDisplayableEnrichmentSession(rows), false);
});

test('pickDisplayableEnrichmentSession accepts complete with sync_suggestion', () => {
  const rows = [
    session({
      id: 'complete',
      status: 'complete',
      sync_suggestion: { name: 'Jane Doe' },
    }),
  ];
  assert.equal(pickDisplayableEnrichmentSession(rows)?.id, 'complete');
});
