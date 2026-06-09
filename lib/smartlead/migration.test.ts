import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchSmartleadCampaignStats,
  fetchSmartleadCampaignStatsByDay,
  upsertCampaignFromSmartlead,
} from './migration';

function createMockMigrationDb(capture: { upsertRow?: Record<string, unknown> }) {
  const chain = {
    upsert(row: Record<string, unknown>) {
      capture.upsertRow = row;
      return chain;
    },
    select() {
      return chain;
    },
    single() {
      return Promise.resolve({
        data: { id: 'campaign-uuid', ...capture.upsertRow },
        error: null,
      });
    },
  };

  return {
    from() {
      return chain;
    },
  };
}

test('upsertCampaignFromSmartlead uses Smartlead created_at for campaigns.created_at', async () => {
  const capture: { upsertRow?: Record<string, unknown> } = {};
  const smartleadCreatedAt = '2024-06-15T10:30:00.000Z';

  await upsertCampaignFromSmartlead(
    { id: 42, name: 'Test Campaign', created_at: smartleadCreatedAt },
    'account-id',
    'owner-id',
    createMockMigrationDb(capture),
  );

  assert.equal(capture.upsertRow?.created_at, smartleadCreatedAt);
  assert.equal(capture.upsertRow?.smartlead_created_at, smartleadCreatedAt);
});

test('upsertCampaignFromSmartlead falls back to now when Smartlead created_at is missing', async () => {
  const capture: { upsertRow?: Record<string, unknown> } = {};
  const before = Date.now();

  await upsertCampaignFromSmartlead(
    { id: 43, name: 'No Date Campaign' },
    'account-id',
    'owner-id',
    createMockMigrationDb(capture),
  );

  const after = Date.now();
  assert.equal(capture.upsertRow?.smartlead_created_at, null);
  assert.equal(typeof capture.upsertRow?.created_at, 'string');
  const createdAtMs = new Date(capture.upsertRow!.created_at as string).getTime();
  assert.ok(createdAtMs >= before && createdAtMs <= after);
});

test('fetchSmartleadCampaignStats parses reply_count from Smartlead totals responses', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          emails_sent: 12,
          reply_count: 7,
          positive_reply_count: 2,
          bounce_count: 1,
          last_bounce_at: '2026-03-16T03:54:05.000Z',
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );

  try {
    const stats = await fetchSmartleadCampaignStats('api-key', 123);

    assert.deepEqual(stats, {
      sent: 12,
      replied: 7,
      positiveReply: 2,
      bounce: 1,
      lastBounceAt: '2026-03-16T03:54:05.000Z',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchSmartleadCampaignStatsByDay keeps reply_count parsing aligned with totals import', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          sent_count: 4,
          reply_count: 3,
          positive_reply_count: 1,
          bounce_count: 0,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );

  try {
    const stats = await fetchSmartleadCampaignStatsByDay('api-key', 123, '2026-03-01', '2026-03-01');

    assert.deepEqual(stats, [
      {
        date: '2026-03-01',
        sent: 4,
        replied: 3,
        positiveReply: 1,
        bounce: 0,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
