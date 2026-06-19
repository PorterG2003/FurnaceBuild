import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFinalizeSteps } from '../../inbox/threadActionDefinitions';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  buildCampaignThread,
  buildThreadMessage,
  createCampaignTestNamespace,
} from '../campaign/fixtures';

async function ensureInboxRedesignSchema(
  harness: CampaignDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase
    .from('email_threads')
    .select('conversation_status, classification_status, handling_metadata')
    .limit(1);
  if (error) {
    t.skip(`Inbox redesign schema not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

async function getThread(harness: CampaignDbHarness, threadId: string) {
  const { data, error } = await harness.supabase
    .from('email_threads')
    .select('conversation_status, conversation_status_source, category, lead_id')
    .eq('id', threadId)
    .single();
  assert.equal(error, null);
  return data as {
    conversation_status: string;
    conversation_status_source: string | null;
    category: string | null;
    lead_id: string;
  };
}

async function applyFinalizeOnHarness(
  harness: CampaignDbHarness,
  params: {
    threadId: string;
    actionId: 'replace_lead' | 'mark_ooo_custom' | 'mark_out_of_office';
    source: 'smart_handling' | 'message_menu';
  },
) {
  const steps = resolveFinalizeSteps(params.actionId, params.source, 'complete');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (steps.setCategoryOnComplete) {
    patch.category = steps.setCategoryOnComplete;
    patch.category_source = 'user';
  }
  if (steps.closeConversation) {
    patch.conversation_status = 'closed';
    patch.conversation_status_source = 'system';
  }

  if (Object.keys(patch).length > 1) {
    const { error } = await harness.supabase
      .from('email_threads')
      .update(patch)
      .eq('id', params.threadId);
    assert.equal(error, null);
  }

  return steps;
}

async function replaceLeadOnHarness(
  harness: CampaignDbHarness,
  oldLeadId: string,
  newEmail: string,
) {
  const { data, error } = await harness.supabase.rpc('replace_lead_with_new_contact', {
    p_old_lead_id: oldLeadId,
    p_new_email: newEmail,
    p_new_name: null,
    p_new_first_name: null,
    p_new_last_name: null,
    p_new_phone_number: null,
    p_reason: 'wrong_contact',
    p_reason_note: null,
    p_source_message_id: null,
  });
  assert.equal(error, null);
  return Array.isArray(data) ? data[0] : null;
}

test('replace lead finalize from smart handling closes the open conversation', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('deferred-replace-close'),
  });
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: 'Deferred Replace Lead Close',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `lead-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              providerMessageId: `<orig-${harness.namespace}@furnace.test>`,
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
              sentAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Re: Wrong contact',
            hasReply: true,
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                messageId: `<orig-${harness.namespace}@furnace.test>`,
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 10 * 60_000).toISOString(),
              }),
              buildThreadMessage({
                direction: 'received',
                messageId: `<reply-${harness.namespace}@furnace.test>`,
                inReplyTo: `<orig-${harness.namespace}@furnace.test>`,
                fromEmail: `alt-${harness.namespace}@furnace.test`,
                bodyText: 'Please contact my colleague instead.',
                receivedAt: new Date(now - 5 * 60_000).toISOString(),
                readAt: null,
              }),
            ],
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const { error: seedError } = await harness.supabase
      .from('email_threads')
      .update({
        conversation_status: 'open',
        classification_status: 'complete',
        handling_metadata: {
          mode: 'manual',
          primary: { action: 'replace_lead', label: 'Replace + forward with message' },
          header_mismatch: true,
        },
      })
      .eq('id', lead.threadId!);
    assert.equal(seedError, null);

    const newEmail = `replacement-${harness.namespace}@furnace.test`;
    const replacement = await replaceLeadOnHarness(harness, lead.leadId, newEmail);
    assert.ok(replacement?.new_lead_id);

    const steps = await applyFinalizeOnHarness(harness, {
      threadId: lead.threadId!,
      actionId: 'replace_lead',
      source: 'smart_handling',
    });
    assert.equal(steps.closeConversation, true);
    assert.equal(steps.dismissSmartHandling, true);

    const thread = await getThread(harness, lead.threadId!);
    assert.equal(thread.conversation_status, 'closed');
    assert.equal(thread.conversation_status_source, 'system');
    assert.equal(thread.lead_id, replacement.new_lead_id);
  } finally {
    await harness.cleanup();
  }
});

test('replace lead finalize from message menu keeps the conversation open', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('deferred-replace-menu'),
  });
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: 'Deferred Replace Lead Menu',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `lead-menu-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              providerMessageId: `<orig-menu-${harness.namespace}@furnace.test>`,
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
              sentAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Re: Menu replace',
            hasReply: true,
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                messageId: `<orig-menu-${harness.namespace}@furnace.test>`,
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 10 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const { error: seedError } = await harness.supabase
      .from('email_threads')
      .update({ conversation_status: 'open' })
      .eq('id', lead.threadId!);
    assert.equal(seedError, null);

    await replaceLeadOnHarness(harness, lead.leadId, `menu-replacement-${harness.namespace}@furnace.test`);

    const steps = await applyFinalizeOnHarness(harness, {
      threadId: lead.threadId!,
      actionId: 'replace_lead',
      source: 'message_menu',
    });
    assert.equal(steps.closeConversation, false);

    const thread = await getThread(harness, lead.threadId!);
    assert.equal(thread.conversation_status, 'open');
  } finally {
    await harness.cleanup();
  }
});

test('mark_ooo_custom finalize from smart handling closes the conversation and relies on shared OOO save state', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('deferred-ooo-close'),
  });
  const now = Date.now();

  try {
    if (!(await ensureInboxRedesignSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: 'Deferred OOO Custom Close',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `ooo-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment(),
          jobs: [
            buildCampaignJob({
              key: 'sent-1',
              status: 'sent',
              providerMessageId: `<orig-ooo-${harness.namespace}@furnace.test>`,
              scheduledAt: new Date(now - 10 * 60_000).toISOString(),
              sentAt: new Date(now - 10 * 60_000).toISOString(),
            }),
          ],
          thread: buildCampaignThread({
            subject: 'Re: OOO custom',
            hasReply: true,
            messageJobKey: 'sent-1',
            messages: [
              buildThreadMessage({
                direction: 'sent',
                messageId: `<orig-ooo-${harness.namespace}@furnace.test>`,
                receivedAt: new Date(now - 10 * 60_000).toISOString(),
                readAt: new Date(now - 10 * 60_000).toISOString(),
              }),
            ],
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const { error: seedError } = await harness.supabase
      .from('email_threads')
      .update({
        conversation_status: 'open',
        classification_status: 'complete',
        handling_metadata: {
          mode: 'manual',
          category: 'Auto Reply',
          primary: { action: 'mark_ooo_custom', label: 'Choose return date' },
        },
      })
      .eq('id', lead.threadId!);
    assert.equal(seedError, null);

    const steps = await applyFinalizeOnHarness(harness, {
      threadId: lead.threadId!,
      actionId: 'mark_ooo_custom',
      source: 'smart_handling',
    });
    assert.equal(steps.setCategoryOnComplete, null);
    assert.equal(steps.closeConversation, true);

    const thread = await getThread(harness, lead.threadId!);
    assert.equal(thread.category, null);
    assert.equal(thread.conversation_status, 'closed');
  } finally {
    await harness.cleanup();
  }
});
