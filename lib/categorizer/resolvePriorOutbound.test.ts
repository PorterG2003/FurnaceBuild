import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePriorOutbound, isCampaignFamilyMessageType } from './resolvePriorOutbound';
import { normalizeMessageId } from '../email/threadHeaders';

/**
 * Minimal thenable query builder that records filters and returns scripted rows.
 */
function createFakeSupabase(script: {
  sentByMessageId?: Record<string, any>;
  latestSent?: any[];
  rootJob?: { id: string; message_type: string | null } | null;
  rootSent?: any | null;
}) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];

  function makeBuilder(table: string) {
    const state: {
      filters: Record<string, unknown>;
      inValues?: string[];
      orderDesc?: boolean;
      limitN?: number;
      maybeSingle?: boolean;
    } = { filters: {} };

    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        state.filters[col] = val;
        return builder;
      },
      in(col: string, vals: string[]) {
        state.filters[`in:${col}`] = vals;
        state.inValues = vals;
        return builder;
      },
      lte(col: string, val: unknown) {
        state.filters[`lte:${col}`] = val;
        return builder;
      },
      order() {
        state.orderDesc = true;
        return builder;
      },
      limit(n: number) {
        state.limitN = n;
        return builder;
      },
      maybeSingle() {
        state.maybeSingle = true;
        return builder;
      },
      then(resolve: (value: unknown) => void) {
        calls.push({ table, filters: { ...state.filters } });

        if (table === 'message_jobs') {
          resolve({ data: script.rootJob ?? null, error: null });
          return;
        }

        if (table === 'email_messages') {
          if (state.inValues) {
            const rows = state.inValues
              .map((id) => script.sentByMessageId?.[id])
              .filter(Boolean);
            resolve({ data: rows, error: null });
            return;
          }
          if (state.filters.message_job_id) {
            resolve({
              data: state.maybeSingle ? script.rootSent ?? null : script.rootSent ? [script.rootSent] : [],
              error: null,
            });
            return;
          }
          // latest campaign-family query
          const rows = script.latestSent ?? [];
          resolve({ data: rows, error: null });
          return;
        }

        resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  return {
    calls,
    from(table: string) {
      return makeBuilder(table);
    },
  };
}

const CAMPAIGN_BODY = 'Want me to send the link to the July training?';
const INBOX_BODY = 'Thanks — looping back from our inbox reply.';

function sentRow(params: {
  messageId: string;
  bodyText: string;
  messageType: string | null;
  receivedAt: string;
  jobId?: string;
}) {
  return {
    id: `msg-${params.messageId}`,
    subject: 'Quick question',
    body_text: params.bodyText,
    body_html: null,
    message_id: normalizeMessageId(params.messageId),
    message_job_id: params.jobId ?? `job-${params.messageId}`,
    received_at: params.receivedAt,
    message_jobs: { message_type: params.messageType },
  };
}

test('resolvePriorOutbound prefers campaign over later inbox_reply via latest-before-reply', async () => {
  const campaignMid = 'campaign@furnace.test';
  const inboxMid = 'inbox@furnace.test';
  const fake = createFakeSupabase({
    sentByMessageId: {},
    latestSent: [
      sentRow({
        messageId: inboxMid,
        bodyText: INBOX_BODY,
        messageType: 'inbox_reply',
        receivedAt: '2026-06-10T12:00:00.000Z',
      }),
      sentRow({
        messageId: campaignMid,
        bodyText: CAMPAIGN_BODY,
        messageType: 'campaign',
        receivedAt: '2026-06-10T11:00:00.000Z',
      }),
    ],
  });

  const prior = await resolvePriorOutbound(fake as any, {
    threadId: 'thread-1',
    inbound: {
      receivedAt: '2026-06-10T13:00:00.000Z',
      inReplyTo: null,
      referenceMessageIds: null,
    },
    threadMessageJobId: null,
  });

  assert.ok(prior);
  assert.ok(prior!.bodyText?.includes('Want me to send the link'));
  assert.ok(!prior!.bodyText?.includes('inbox reply'));
});

test('resolvePriorOutbound picks In-Reply-To campaign Message-ID body', async () => {
  const campaignMid = 'campaign-cta@furnace.test';
  const fake = createFakeSupabase({
    sentByMessageId: {
      [campaignMid]: sentRow({
        messageId: campaignMid,
        bodyText: CAMPAIGN_BODY,
        messageType: 'campaign',
        receivedAt: '2026-06-10T11:00:00.000Z',
      }),
    },
  });

  const prior = await resolvePriorOutbound(fake as any, {
    threadId: 'thread-1',
    inbound: {
      receivedAt: '2026-06-10T13:00:00.000Z',
      inReplyTo: `<${campaignMid}>`,
      referenceMessageIds: null,
    },
    threadMessageJobId: null,
  });

  assert.ok(prior);
  assert.ok(prior!.bodyText?.includes('Want me to send the link'));
});

test('resolvePriorOutbound omits when only inbox_reply sends exist', async () => {
  const inboxMid = 'only-inbox@furnace.test';
  const fake = createFakeSupabase({
    sentByMessageId: {
      [inboxMid]: sentRow({
        messageId: inboxMid,
        bodyText: INBOX_BODY,
        messageType: 'inbox_reply',
        receivedAt: '2026-06-10T12:00:00.000Z',
      }),
    },
    latestSent: [
      sentRow({
        messageId: inboxMid,
        bodyText: INBOX_BODY,
        messageType: 'inbox_reply',
        receivedAt: '2026-06-10T12:00:00.000Z',
      }),
    ],
    rootJob: null,
  });

  const prior = await resolvePriorOutbound(fake as any, {
    threadId: 'thread-1',
    inbound: {
      receivedAt: '2026-06-10T13:00:00.000Z',
      inReplyTo: `<${inboxMid}>`,
      referenceMessageIds: null,
    },
    threadMessageJobId: null,
  });

  assert.equal(prior, null);
});

test('resolvePriorOutbound falls back to thread root campaign job send', async () => {
  const rootJobId = 'root-job-1';
  const fake = createFakeSupabase({
    sentByMessageId: {},
    latestSent: [
      sentRow({
        messageId: 'inbox@furnace.test',
        bodyText: INBOX_BODY,
        messageType: 'inbox_reply',
        receivedAt: '2026-06-10T12:00:00.000Z',
      }),
    ],
    rootJob: { id: rootJobId, message_type: 'campaign' },
    rootSent: sentRow({
      messageId: 'root-campaign@furnace.test',
      bodyText: CAMPAIGN_BODY,
      messageType: 'campaign',
      receivedAt: '2026-06-10T10:00:00.000Z',
      jobId: rootJobId,
    }),
  });

  const prior = await resolvePriorOutbound(fake as any, {
    threadId: 'thread-1',
    inbound: {
      receivedAt: '2026-06-10T13:00:00.000Z',
      inReplyTo: null,
      referenceMessageIds: null,
    },
    threadMessageJobId: rootJobId,
  });

  assert.ok(prior);
  assert.ok(prior!.bodyText?.includes('Want me to send the link'));
});

test('isCampaignFamilyMessageType contract', () => {
  assert.equal(isCampaignFamilyMessageType('campaign'), true);
  assert.equal(isCampaignFamilyMessageType('inbox_reply'), false);
});
