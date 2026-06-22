import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClientApiDbHarness,
  createClientApiTestNamespace,
} from './harness.js';
import { buildSeedInterestedMetadata } from '../../../scripts/seed/scenarios/smart-handling-flow/payloads';

async function ensureInboxInteractionSchema(
  harness: ClientApiDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase
    .from('inbox_interactions')
    .select('id')
    .limit(1);
  if (error) {
    t.skip(`Inbox interaction schema not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

async function createInboxGraph(harness: ClientApiDbHarness) {
  return harness.campaignHarness.createCampaignGraph({
    name: 'Client API Inbox Outcomes',
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
          subject: 'Furnace API inbox expansion',
          lastMessageAt: new Date().toISOString(),
          category: 'Neutral',
          conversationStatus: 'open',
          messages: [
            {
              direction: 'sent',
              subject: 'Furnace API inbox expansion',
              bodyText: 'First touch',
              fromEmail: `sender-${harness.namespace}@example.com`,
              toEmail: `lead-${harness.namespace}@example.com`,
              receivedAt: new Date(Date.now() - 120_000).toISOString(),
              messageId: `<sent-${harness.namespace}@example.com>`,
            },
            {
              direction: 'received',
              subject: 'Re: Furnace API inbox expansion',
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
}

test('client api inbox list filters return matching threads', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('inbox-filters'),
  });

  try {
    const graph = await createInboxGraph(harness);
    const apiKey = await harness.createApiKey();
    const threadId = graph.leadsByKey.get('lead-1')!.threadId!;

    const byCampaign = await harness.request(`/v1/threads?campaign_id=${graph.campaignId}&category=Neutral`, {
      apiKey: apiKey.secret,
    });
    assert.equal(byCampaign.status, 200);
    const byCampaignBody = await byCampaign.json() as { data: Array<{ id: string }> };
    assert.ok(byCampaignBody.data.some((thread) => thread.id === threadId));

    const bySearch = await harness.request(`/v1/threads?q=${encodeURIComponent('inbox expansion')}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(bySearch.status, 200);
    const bySearchBody = await bySearch.json() as { data: Array<{ id: string }> };
    assert.ok(bySearchBody.data.some((thread) => thread.id === threadId));

    const unread = await harness.request('/v1/threads?unread_only=true', {
      apiKey: apiKey.secret,
    });
    assert.equal(unread.status, 200);
    const unreadBody = await unread.json() as { data: Array<{ id: string }> };
    assert.ok(unreadBody.data.some((thread) => thread.id === threadId));

    const missing = await harness.request('/v1/threads?category=Interested', {
      apiKey: apiKey.secret,
    });
    assert.equal(missing.status, 200);
    const missingBody = await missing.json() as { data: Array<{ id: string }> };
    assert.equal(missingBody.data.some((thread) => thread.id === threadId), false);
  } finally {
    await harness.cleanup();
  }
});

test('client api inbox PATCH updates category, status, and read state', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('inbox-patch'),
  });

  try {
    if (!(await ensureInboxInteractionSchema(harness, t))) return;
    const graph = await createInboxGraph(harness);
    const apiKey = await harness.createApiKey();
    const threadId = graph.leadsByKey.get('lead-1')!.threadId!;
    const { error: seedError } = await harness.supabase
      .from('email_threads')
      .update({
        classification_status: 'complete',
        classification_completed_at: '2026-06-22T18:00:00.000Z',
        handling_metadata: buildSeedInterestedMetadata() as any,
      })
      .eq('id', threadId);
    assert.equal(seedError, null);

    const response = await harness.request(`/v1/threads/${threadId}`, {
      method: 'PATCH',
      apiKey: apiKey.secret,
      body: {
        category: 'Interested',
        conversation_status: 'closed',
        read: true,
      },
    });
    assert.equal(response.status, 200);

    const { data: thread, error: threadError } = await harness.supabase
      .from('email_threads')
      .select('category, conversation_status')
      .eq('id', threadId)
      .single();
    assert.equal(threadError, null);
    assert.equal(thread?.category, 'Interested');
    assert.equal(thread?.conversation_status, 'closed');

    const { data: messages, error: messageError } = await harness.supabase
      .from('email_messages')
      .select('read_at')
      .eq('thread_id', threadId)
      .eq('direction', 'received');
    assert.equal(messageError, null);
    assert.ok((messages ?? []).every((message) => message.read_at != null));

    const { data: interactions, error: interactionError } = await harness.supabase
      .from('inbox_interactions')
      .select('action, source, intent')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    assert.equal(interactionError, null);
    assert.deepEqual(
      (interactions ?? []).map((row) => row.action),
      ['thread.set_category', 'thread.close_conversation'],
    );
    assert.equal(interactions?.[0]?.source, 'client_api');
    assert.equal((interactions?.[0]?.intent as any)?.action_id, 'mark_interested');
  } finally {
    await harness.cleanup();
  }
});

test('client api inbox reply, forward, and message job lifecycle work', async (t) => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('inbox-send'),
  });

  const trackedJobIds: string[] = [];

  try {
    if (!(await ensureInboxInteractionSchema(harness, t))) return;
    const graph = await createInboxGraph(harness);
    const apiKey = await harness.createApiKey();
    const threadId = graph.leadsByKey.get('lead-1')!.threadId!;
    const { error: seedError } = await harness.supabase
      .from('email_threads')
      .update({
        classification_status: 'complete',
        classification_completed_at: '2026-06-22T18:00:00.000Z',
        handling_metadata: buildSeedInterestedMetadata() as any,
      })
      .eq('id', threadId);
    assert.equal(seedError, null);

    const messagesResponse = await harness.request(`/v1/threads/${threadId}/messages`, {
      apiKey: apiKey.secret,
    });
    const messagesBody = await messagesResponse.json() as {
      data: Array<{ id: string; direction: string }>;
    };
    const sentMessage = messagesBody.data.find((message) => message.direction === 'sent');
    const receivedMessage = messagesBody.data.find((message) => message.direction === 'received');
    assert.ok(sentMessage && receivedMessage);

    const reply = await harness.request(`/v1/threads/${threadId}/reply`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        in_reply_to_message_id: sentMessage.id,
        body_text: 'Replying to the original outbound message.',
      },
    });
    assert.equal(reply.status, 202);
    const replyBody = await reply.json() as { data: { id: string } };
    trackedJobIds.push(replyBody.data.id);

    const { data: replyJob, error: replyJobError } = await harness.supabase
      .from('message_jobs')
      .select('message_type, message_data')
      .eq('id', replyBody.data.id)
      .single();
    assert.equal(replyJobError, null);
    assert.equal(replyJob?.message_type, 'inbox_reply');
    const replyJobData = replyJob?.message_data as { in_reply_to_message_id?: string };
    assert.equal(replyJobData.in_reply_to_message_id, sentMessage.id);

    const jobStatus = await harness.request(`/v1/message-jobs/${replyBody.data.id}`, {
      apiKey: apiKey.secret,
    });
    assert.equal(jobStatus.status, 200);
    const jobStatusBody = await jobStatus.json() as {
      data: { id: string; message_type: string | null; thread_id: string | null; status: string };
    };
    assert.equal(jobStatusBody.data.id, replyBody.data.id);
    assert.equal(jobStatusBody.data.message_type, 'inbox_reply');
    assert.equal(jobStatusBody.data.thread_id, threadId);

    const cancel = await harness.request(`/v1/message-jobs/${replyBody.data.id}/cancel`, {
      method: 'POST',
      apiKey: apiKey.secret,
    });
    assert.equal(cancel.status, 200);
    const cancelBody = await cancel.json() as { data: { status: string } };
    assert.equal(cancelBody.data.status, 'cancelled');

    const forwardMissing = await harness.request(`/v1/threads/${threadId}/forward`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        to_email: 'forward@example.com',
        body_text: 'Forwarding without message id.',
      },
    });
    assert.equal(forwardMissing.status, 400);

    const forward = await harness.request(`/v1/threads/${threadId}/forward`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        forward_message_id: receivedMessage.id,
        to_email: 'forward@example.com',
        body_text: 'Forwarding the inbound reply.',
      },
    });
    assert.equal(forward.status, 202);
    const forwardBody = await forward.json() as { data: { id: string } };
    trackedJobIds.push(forwardBody.data.id);

    const { data: forwardJob, error: forwardJobError } = await harness.supabase
      .from('message_jobs')
      .select('message_type')
      .eq('id', forwardBody.data.id)
      .single();
    assert.equal(forwardJobError, null);
    assert.equal(forwardJob?.message_type, 'inbox_forward');

    const { data: interactions, error: interactionError } = await harness.supabase
      .from('inbox_interactions')
      .select('action, source, changes')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    assert.equal(interactionError, null);
    assert.deepEqual(
      (interactions ?? []).map((row) => row.action),
      ['thread.reply_sent', 'thread.forward_sent'],
    );
    assert.equal(interactions?.[0]?.source, 'client_api');
    assert.equal((interactions?.[0]?.changes as any)?.[0]?.field, 'reply_job_created');
    assert.equal((interactions?.[1]?.changes as any)?.[0]?.field, 'forward_job_created');
  } finally {
    for (const jobId of trackedJobIds) {
      await harness.supabase.from('message_jobs').delete().eq('id', jobId);
    }
    await harness.cleanup();
  }
});

test('client api inbox OOO, replace lead, and thread tags work', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('inbox-ops'),
  });

  let tagId: string | null = null;
  const trackedJobIds: string[] = [];

  try {
    const graph = await createInboxGraph(harness);
    const apiKey = await harness.createApiKey();
    const threadId = graph.leadsByKey.get('lead-1')!.threadId!;
    const oldLeadId = graph.leadsByKey.get('lead-1')!.leadId;

    const ooo = await harness.request(`/v1/threads/${threadId}/out-of-office`, {
      method: 'PUT',
      apiKey: apiKey.secret,
      body: {
        resume_mode: 'none',
      },
    });
    assert.equal(ooo.status, 200);
    const { data: oooThread, error: oooError } = await harness.supabase
      .from('email_threads')
      .select('out_of_office')
      .eq('id', threadId)
      .single();
    assert.equal(oooError, null);
    assert.equal(oooThread?.out_of_office, true);

    const clearOoo = await harness.request(`/v1/threads/${threadId}/out-of-office`, {
      method: 'DELETE',
      apiKey: apiKey.secret,
    });
    assert.equal(clearOoo.status, 200);

    const { data: tagRow, error: tagError } = await harness.supabase
      .from('thread_tags')
      .insert({
        account_id: harness.accountId,
        name: `api-tag-${harness.namespace}`,
        color: '#F3440D',
      })
      .select('id')
      .single();
    assert.equal(tagError, null);
    tagId = tagRow!.id as string;

    const addTag = await harness.request(`/v1/threads/${threadId}/tags:add`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { tag_id: tagId },
    });
    assert.equal(addTag.status, 200);

    const { data: assignment, error: assignmentError } = await harness.supabase
      .from('thread_tag_assignments')
      .select('thread_id')
      .eq('thread_id', threadId)
      .eq('tag_id', tagId)
      .maybeSingle();
    assert.equal(assignmentError, null);
    assert.ok(assignment);

    const listTags = await harness.request('/v1/thread-tags', {
      apiKey: apiKey.secret,
    });
    assert.equal(listTags.status, 200);
    const listTagsBody = await listTags.json() as { data: Array<{ id: string }> };
    assert.ok(listTagsBody.data.some((tag) => tag.id === tagId));

    const removeTag = await harness.request(`/v1/threads/${threadId}/tags:remove`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: { tag_id: tagId },
    });
    assert.equal(removeTag.status, 200);

    const messagesResponse = await harness.request(`/v1/threads/${threadId}/messages`, {
      apiKey: apiKey.secret,
    });
    const messagesBody = await messagesResponse.json() as { data: Array<{ id: string }> };
    const receivedMessage = messagesBody.data.at(-1);
    assert.ok(receivedMessage);

    const replacementEmail = `replacement-${harness.namespace}@example.com`;
    const replaceLead = await harness.request(`/v1/threads/${threadId}/replace-lead`, {
      method: 'POST',
      apiKey: apiKey.secret,
      body: {
        new_email: replacementEmail,
        new_name: 'Replacement Contact',
        forward_message_id: receivedMessage.id,
      },
    });
    assert.equal(replaceLead.status, 200);
    const replaceBody = await replaceLead.json() as {
      data: { new_lead_id: string; replacement_id: string; forward_job_id?: string | null };
    };
    assert.ok(replaceBody.data.new_lead_id);
    assert.ok(replaceBody.data.replacement_id);
    if (replaceBody.data.forward_job_id) {
      trackedJobIds.push(replaceBody.data.forward_job_id);
    }

    const { data: refreshedThread, error: refreshedThreadError } = await harness.supabase
      .from('email_threads')
      .select('lead_id')
      .eq('id', threadId)
      .single();
    assert.equal(refreshedThreadError, null);
    assert.notEqual(refreshedThread?.lead_id, oldLeadId);
    assert.equal(refreshedThread?.lead_id, replaceBody.data.new_lead_id);
  } finally {
    if (tagId) {
      await harness.supabase.from('thread_tags').delete().eq('id', tagId);
    }
    for (const jobId of trackedJobIds) {
      await harness.supabase.from('message_jobs').delete().eq('id', jobId);
    }
    await harness.cleanup();
  }
});

test('client api inbox rejects missing threads', async () => {
  const harness = new ClientApiDbHarness({
    namespace: createClientApiTestNamespace('inbox-auth'),
  });

  try {
    const graph = await createInboxGraph(harness);
    const apiKey = await harness.createApiKey();
    const missing = await harness.request(`/v1/threads/00000000-0000-4000-8000-000000000001`, {
      apiKey: apiKey.secret,
    });
    assert.equal(missing.status, 404);

    const wrongThread = await harness.request(`/v1/threads/00000000-0000-4000-8000-000000000001/messages`, {
      apiKey: apiKey.secret,
    });
    assert.equal(wrongThread.status, 404);
    assert.ok(graph.campaignId);
  } finally {
    await harness.cleanup();
  }
});
