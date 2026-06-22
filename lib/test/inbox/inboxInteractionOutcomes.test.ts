import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInboxInteractionContext, extractSuggestionVersion } from '../../inbox/buildInboxInteractionContext';
import { buildInteractionIntent } from '../../inbox/buildInteractionIntent';
import { buildSeedInterestedMetadata } from '../../../scripts/seed/scenarios/smart-handling-flow/payloads';
import { CampaignDbHarness } from '../campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildCampaignThread,
  createCampaignTestNamespace,
} from '../campaign/fixtures';

async function ensureInboxInteractionSchema(
  harness: CampaignDbHarness,
  t: test.TestContext,
): Promise<boolean> {
  const { error } = await harness.supabase
    .from('inbox_interactions')
    .select('id, suggestion_version')
    .limit(1);
  if (error) {
    t.skip(`Inbox interaction schema not applied in shared test DB: ${error.message}`);
    return false;
  }
  return true;
}

test('inbox interactions persist scenario matrix rows with denormalized version fields', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('inbox-interactions'),
  });

  try {
    if (!(await ensureInboxInteractionSchema(harness, t))) return;

    const graph = await harness.createCampaignGraph({
      name: 'Inbox Interaction Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `lead-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment(),
          thread: buildCampaignThread({
            subject: 'Re: Interaction logging',
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const metadata = buildSeedInterestedMetadata();
    const { error: updateError } = await harness.supabase
      .from('email_threads')
      .update({
        classification_status: 'complete',
        classification_completed_at: '2026-06-22T18:00:00.000Z',
        handling_metadata: metadata as any,
      })
      .eq('id', lead.threadId!);
    assert.equal(updateError, null);

    const { data: thread } = await harness.supabase
      .from('email_threads')
      .select('*')
      .eq('id', lead.threadId!)
      .single();
    const { data: leadRow } = await harness.supabase
      .from('leads')
      .select('*')
      .eq('id', lead.leadId)
      .single();
    const { data: messageRows } = await harness.supabase
      .from('email_messages')
      .select('*')
      .eq('thread_id', lead.threadId!)
      .eq('direction', 'received')
      .limit(1);

    assert.ok(thread);
    assert.ok(leadRow);
    assert.ok(messageRows?.[0]);

    const context = buildInboxInteractionContext({
      thread: thread as any,
      lead: leadRow as any,
      triggerMessage: messageRows[0] as any,
      smartHandlingMetadata: metadata,
    });
    assert.ok(context);

    const { suggestion_mode, suggestion_version } = extractSuggestionVersion(metadata);
    const insertBase = {
      account_id: graph.accountId,
      thread_id: lead.threadId!,
      lead_id: lead.leadId,
      trigger_message_id: messageRows[0].id,
      classification_completed_at: '2026-06-22T18:00:00.000Z',
      suggestion_mode,
      suggestion_version,
      actor_type: 'api' as const,
      actor_user_id: null,
      actor_api_key_id: null,
      context: context!,
    };

    const { error: insertError } = await harness.supabase.from('inbox_interactions').insert([
      {
        ...insertBase,
        action: 'thread.mark_interested_reply',
        source: 'smart_handling_bar',
        intent: buildInteractionIntent({ metadata, actionId: 'mark_interested_reply' }) as any,
        changes: [{ field: 'category', from: null, to: 'Interested' }] as any,
      },
      {
        ...insertBase,
        action: 'thread.mark_interested',
        source: 'smart_handling_bar',
        intent: buildInteractionIntent({ metadata, actionId: 'mark_interested' }) as any,
      },
      {
        ...insertBase,
        action: 'thread.set_category',
        source: 'category_picker',
        intent: buildInteractionIntent({ metadata, categorySelection: 'Not Interested' }) as any,
      },
      {
        ...insertBase,
        action: 'thread.dismiss_suggestion',
        source: 'smart_handling_bar',
        intent: buildInteractionIntent({ metadata, actionId: 'dismiss' }) as any,
      },
      {
        ...insertBase,
        action: 'thread.reopen_conversation',
        source: 'thread_header',
        suggestion_mode: null,
        suggestion_version: null,
        intent: null,
      },
    ]);
    assert.equal(insertError, null);

    const { data: rows, error: selectError } = await harness.supabase
      .from('inbox_interactions')
      .select('action, source, suggestion_mode, suggestion_version, intent, context')
      .eq('thread_id', lead.threadId!)
      .order('created_at', { ascending: true });
    assert.equal(selectError, null);
    assert.equal(rows?.length, 5);
    const rowsByAction = new Map((rows ?? []).map((row) => [row.action, row]));
    assert.equal(rowsByAction.get('thread.mark_interested_reply')?.suggestion_mode, 'manual');
    assert.equal(rowsByAction.get('thread.mark_interested_reply')?.suggestion_version, metadata.suggestion_version);
    assert.equal((rowsByAction.get('thread.mark_interested_reply')?.intent as any)?.matched_suggestion, true);
    assert.equal((rowsByAction.get('thread.mark_interested')?.intent as any)?.matched_suggestion, false);
    assert.equal((rowsByAction.get('thread.set_category')?.intent as any)?.action_id, 'mark_not_interested');
    assert.equal((rowsByAction.get('thread.dismiss_suggestion')?.intent as any)?.action_id, 'dismiss');
    assert.equal(rowsByAction.get('thread.reopen_conversation')?.suggestion_version, null);
    assert.equal(
      (rowsByAction.get('thread.mark_interested_reply')?.context as any)?.thread?.handling_metadata?.suggestion_version,
      metadata.suggestion_version,
    );
  } finally {
    await harness.cleanup();
  }
});
