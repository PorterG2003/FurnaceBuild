import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';

test('client api creates idempotent leads and persists one webhook event', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('lead-create'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Lead Create',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();

    const first = await harness.request(`/v1/campaigns/${graph.campaignId}/leads`, {
      method: 'POST',
      apiKey: apiKey.secret,
      headers: { 'Idempotency-Key': `${harness.namespace}-lead-create` },
      body: {
        email: `casey-${harness.namespace}@example.com`,
        first_name: 'Casey',
      },
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { data: { id: string; email: string }; created: boolean };
    assert.equal(firstBody.created, true);

    const second = await harness.request(`/v1/campaigns/${graph.campaignId}/leads`, {
      method: 'POST',
      apiKey: apiKey.secret,
      headers: { 'Idempotency-Key': `${harness.namespace}-lead-create` },
      body: {
        email: `casey-${harness.namespace}@example.com`,
        first_name: 'Casey',
      },
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json() as { data: { id: string; email: string }; created: boolean };
    assert.equal(secondBody.data.id, firstBody.data.id);
    assert.equal(secondBody.created, true);

    const { data: leads, error: leadsError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', graph.campaignId)
      .eq('email', `casey-${harness.namespace}@example.com`)
      .is('deleted_at', null);
    assert.equal(leadsError, null);
    assert.equal(leads?.length, 1);

    const { data: idempotencyKeys, error: idempotencyError } = await harness.supabase
      .from('api_idempotency_keys')
      .select('id')
      .eq('account_id', harness.accountId)
      .eq('idempotency_key', `${harness.namespace}-lead-create`);
    assert.equal(idempotencyError, null);
    assert.equal(idempotencyKeys?.length, 1);

    const { data: webhookEvents, error: webhookError } = await harness.supabase
      .from('webhook_events')
      .select('event_type, payload')
      .eq('account_id', harness.accountId)
      .eq('campaign_id', graph.campaignId);
    assert.equal(webhookError, null);
    assert.equal(webhookEvents?.length, 1);
    assert.equal(webhookEvents?.[0]?.event_type, 'lead.created');
  } finally {
    await harness.cleanup();
  }
});

test('client api hides mailbox secrets and allows lead deletion', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('mailboxes'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Mailboxes',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        {
          key: 'lead-1',
          email: `lead-${harness.namespace}@example.com`,
        },
      ],
    });
    const apiKey = await harness.createApiKey();
    const leadId = graph.leadsByKey.get('lead-1')!.leadId;
    const mailboxId = graph.mailboxIdsByKey.get('mailbox-1')!;

    const mailboxes = await harness.request(`/v1/mailboxes/${mailboxId}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(mailboxes.status, 200);
    const mailboxBody = await mailboxes.json() as { data: Record<string, unknown> };
    assert.equal('smtp_password' in mailboxBody.data, false);
    assert.equal('imap_password' in mailboxBody.data, false);

    const deleted = await harness.request(`/v1/campaigns/${graph.campaignId}/leads/${leadId}`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
    });
    assert.equal(deleted.status, 200);
  } finally {
    await harness.cleanup();
  }
});

test('client api lists inbox threads, creates reply jobs, and manages block list plus stats', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('inbox'),
  });

  let replyJobId: string | null = null;

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Inbox',
      status: 'running',
      flowKind: 'emailOnly',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        {
          key: 'lead-1',
          email: `lead-${harness.namespace}@example.com`,
          mailboxKey: 'mailbox-1',
          enrollment: {
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date().toISOString(),
          },
          thread: {
            subject: 'Re: Furnace API thread',
            lastMessageAt: new Date().toISOString(),
            messages: [
              {
                direction: 'sent',
                subject: 'Furnace API thread',
                bodyText: 'First touch',
                fromEmail: `sender-${harness.namespace}@example.com`,
                toEmail: `lead-${harness.namespace}@example.com`,
                receivedAt: new Date(Date.now() - 60_000).toISOString(),
                messageId: `<sent-${harness.namespace}@example.com>`,
              },
              {
                direction: 'received',
                subject: 'Re: Furnace API thread',
                bodyText: 'Reply received',
                fromEmail: `lead-${harness.namespace}@example.com`,
                toEmail: `sender-${harness.namespace}@example.com`,
                receivedAt: new Date().toISOString(),
                inReplyTo: `<sent-${harness.namespace}@example.com>`,
                messageId: `<received-${harness.namespace}@example.com>`,
              },
            ],
          },
        },
      ],
    });
    const apiKey = await harness.createApiKey();
    const lead = graph.leadsByKey.get('lead-1')!;
    const threadId = lead.threadId!;

    const threads = await harness.request(`/v1/threads?campaign_id=${graph.campaignId}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(threads.status, 200);
    const threadsBody = await threads.json() as { data: Array<{ id: string }> };
    assert.ok(threadsBody.data.some((thread) => thread.id === threadId));

    const messages = await harness.request(`/v1/threads/${threadId}/messages`, {
      apiKey: apiKey.secret,
    });
    assert.equal(messages.status, 200);
    const messagesBody = await messages.json() as { data: Array<{ direction: string }> };
    assert.equal(messagesBody.data.length, 2);

    const reply = await harness.request(`/v1/threads/${threadId}/reply`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        body_text: 'Thanks for the reply.',
      },
    });
    assert.equal(reply.status, 202);
    const replyBody = await reply.json() as { data: { id: string } };
    replyJobId = replyBody.data.id;

    const stats = await harness.request(`/v1/campaigns/${graph.campaignId}/stats`, {
      apiKey: apiKey.secret,
    });
    assert.equal(stats.status, 200);
    const statsBody = await stats.json() as {
      data: { totals: { enrollmentCount: number } };
    };
    assert.equal(statsBody.data.totals.enrollmentCount >= 1, true);

    const blockAdded = await harness.request('/v1/block-list', {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        value: `blocked-${harness.namespace}@example.com`,
        type: 'email',
        reason: 'test',
      },
    });
    assert.equal(blockAdded.status, 201);
    const blockBody = await blockAdded.json() as { data: { id: string; value: string } };
    assert.equal(blockBody.data.value, `blocked-${harness.namespace}@example.com`);

    const blockList = await harness.request(`/v1/block-list?q=blocked-${harness.namespace}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(blockList.status, 200);
    const blockListBody = await blockList.json() as { data: Array<{ id: string }> };
    assert.ok(blockListBody.data.some((row) => row.id === blockBody.data.id));

    const blockDelete = await harness.request(`/v1/block-list/${blockBody.data.id}`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
    });
    assert.equal(blockDelete.status, 200);
  } finally {
    if (replyJobId) {
      const { error } = await harness.supabase.from('message_jobs').delete().eq('id', replyJobId);
      assert.equal(error, null);
    }
    await harness.cleanup();
  }
});

test('client api rejects smartlead campaign mutation and enforces async import concurrency caps', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('smartlead'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Smartlead',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();

    const { error: sourceError } = await harness.supabase
      .from('campaigns')
      .update({ source: 'smartlead' } as never)
      .eq('id', graph.campaignId);
    assert.equal(sourceError, null);

    const patch = await harness.request(`/v1/campaigns/${graph.campaignId}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: { name: 'Should Fail' },
    });
    assert.equal(patch.status, 403);
    const patchBody = await patch.json() as { error: { code: string } };
    assert.equal(patchBody.error.code, 'smartlead_read_only');

    const { error: restoreError } = await harness.supabase
      .from('campaigns')
      .update({ source: null } as never)
      .eq('id', graph.campaignId);
    assert.equal(restoreError, null);

    for (let index = 0; index < 3; index += 1) {
      const { data, error } = await harness.supabase
        .from('api_import_jobs')
        .insert({
          account_id: harness.accountId,
          campaign_id: graph.campaignId,
          created_by_api_key_id: apiKey.id,
          status: 'queued',
          input: { leads: [] },
          result: {},
          errors: [],
        } as never)
        .select('id')
        .single();
      assert.equal(error, null);
      harness.trackedImportJobIds.add(data.id);
    }

    const limited = await harness.request(`/v1/campaigns/${graph.campaignId}/leads/bulk/async`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        leads: [{ email: `queued-${harness.namespace}@example.com` }],
      },
    });
    assert.equal(limited.status, 429);
    const limitedBody = await limited.json() as { error: { code: string } };
    assert.equal(limitedBody.error.code, 'too_many_async_jobs');
  } finally {
    await harness.cleanup();
  }
});

test('client api returns created async jobs from the jobs endpoint', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('jobs'),
  });

  try {
    const graph = await harness.campaignHarness.createCampaignGraph({
      name: 'Client API Jobs',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });
    const apiKey = await harness.createApiKey();

    const created = await harness.request(`/v1/campaigns/${graph.campaignId}/leads/bulk/async`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        leads: [{ email: `job-${harness.namespace}@example.com` }],
      },
    });
    assert.equal(created.status, 202);
    const createdBody = await created.json() as { data: { id: string; status: string } };
    assert.equal(createdBody.data.status, 'queued');

    const fetched = await harness.request(`/v1/jobs/${createdBody.data.id}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(fetched.status, 200);
    const fetchedBody = await fetched.json() as { data: { id: string; campaign_id: string } };
    assert.equal(fetchedBody.data.id, createdBody.data.id);
    assert.equal(fetchedBody.data.campaign_id, graph.campaignId);
  } finally {
    await harness.cleanup();
  }
});
