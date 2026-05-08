import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchSmartleadCampaignStats, fetchSmartleadCampaignStatsByDay } from './migration';

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
