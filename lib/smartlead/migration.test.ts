import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeFinalImportedCampaignStats,
  dedupeSmartleadLeadsById,
  fetchSmartleadCampaignStats,
  fetchSmartleadCampaignStatsByDay,
  mapSmartleadCategoryToFurnace,
  parseSmartleadInboxReplyLead,
  upsertSmartleadConversationThread,
  upsertCampaignFromSmartlead,
  upsertLeadsFromSmartlead,
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

test('dedupeSmartleadLeadsById keeps one row per smartlead id (last wins)', () => {
  const deduped = dedupeSmartleadLeadsById([
    { id: 10, email: 'first@example.com' },
    { id: 20, email: 'b@example.com' },
    { id: 10, email: 'second@example.com' },
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped.find((l) => l.id === 10)?.email, 'second@example.com');
});

test('upsertLeadsFromSmartlead dedupes duplicate ids within a batch before upsert', async () => {
  const upsertedRows: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      assert.equal(table, 'leads');
      return {
        upsert(rows: Record<string, unknown>[]) {
          upsertedRows.push(...rows);
          return {
            select() {
              return Promise.resolve({
                data: rows.map((_, i) => ({ id: `lead-${i}` })),
                error: null,
              });
            },
          };
        },
      };
    },
  };

  await upsertLeadsFromSmartlead(
    'campaign-id',
    'bucket-id',
    'account-id',
    [
      { id: 1, email: 'a@example.com' },
      { id: 1, email: 'a-dup@example.com' },
      { id: 2, email: 'b@example.com' },
    ],
    db,
  );

  assert.equal(upsertedRows.length, 2);
  assert.equal(upsertedRows[0].smartlead_lead_id, 1);
  assert.equal(upsertedRows[0].email, 'a-dup@example.com');
});

test('upsertSmartleadConversationThread defaults imported Smartlead threads to closed', async () => {
  const capture: { upsertRow?: Record<string, unknown> } = {};

  await upsertSmartleadConversationThread({
    accountId: 'account-id',
    campaignId: 'campaign-id',
    leadId: 'lead-id',
    enrollmentId: 'enrollment-id',
    smartleadLeadId: 123,
    category: 'Interested',
    messages: [
      {
        from: 'sender@example.com',
        to: 'lead@example.com',
        type: 'REPLY',
        time: '2026-06-17T12:00:00.000Z',
        subject: 'Re: Smartlead thread',
        email_body: 'hello',
        raw: {},
      },
    ],
    db: createMockMigrationDb(capture) as any,
  });

  assert.equal(capture.upsertRow?.conversation_status, 'closed');
  assert.equal(capture.upsertRow?.conversation_status_source, 'system');
  assert.equal(capture.upsertRow?.smartlead_lead_id, 123);
});

test('computeFinalImportedCampaignStats prefers inbox thread counts when higher than analytics', () => {
  const finalStats = computeFinalImportedCampaignStats(
    { sent: 7937, replied: 52, positiveReply: 0, bounce: 8, lastBounceAt: null },
    61,
    3,
  );
  assert.deepEqual(finalStats, {
    sent: 7937,
    replied: 61,
    positiveReply: 3,
    bounce: 8,
    lastBounceAt: null,
  });
});

test('parseSmartleadInboxReplyLead extracts nested category', () => {
  const parsed = parseSmartleadInboxReplyLead({
    email_lead_id: 99,
    email_campaign_id: 123,
    lead_email: 'lead@example.com',
    category: { id: 1, name: 'Interested' },
  });
  assert.equal(parsed?.email_lead_id, 99);
  assert.equal(parsed?.categoryId, 1);
  assert.equal(parsed?.categoryName, 'Interested');
});

test('mapSmartleadCategoryToFurnace maps positive sentiment to Interested', () => {
  const category = mapSmartleadCategoryToFurnace(
    5,
    'Meeting Booked',
    [{ id: 5, name: 'Meeting Booked', sentiment_type: 'positive' }],
  );
  assert.equal(category, 'Interested');
});

test('mapSmartleadCategoryToFurnace maps negative sentiment to Not Interested', () => {
  const category = mapSmartleadCategoryToFurnace(
    3,
    'Not Interested',
    [{ id: 3, name: 'Not Interested', sentiment_type: 'negative' }],
  );
  assert.equal(category, 'Not Interested');
});
