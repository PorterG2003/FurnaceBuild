import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  buildCampaignThread,
  createCampaignTestNamespace,
} from './fixtures';
import { getEnrollmentRow } from './categorizer-helpers';

/**
 * Sweep safety-net outcomes: sweep_parked_categorizer_enrollments wakes
 * exactly the enrollments that have something actionable (a lost wake event)
 * and never touches the >99% reply-less parked majority - parked enrollments
 * cost zero polling and the sweep only ever lifts the rare stragglers.
 *
 * NOTE: the sweep RPC is global. Assertions are made on OUR seeded rows
 * (woken vs untouched), never on the RPC's global return count.
 */

function parkedAtCategorizer() {
  return buildCampaignEnrollment({
    state: 'active',
    currentFlowNodeId: 'aiCategorizer-1',
    nextRunAt: null,
  });
}

async function runSweep(harness: CampaignDbHarness): Promise<void> {
  const { error } = await harness.supabase.rpc('sweep_parked_categorizer_enrollments', {
    p_batch_size: 500,
  });
  assert.equal(error, null);
}

test('AI flow sweep matrix: wakes lost-wake stragglers only, leaves Auto Reply / reply-less / branched / scheduled parked rows alone', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-sweep-ai') });
  const now = new Date().toISOString();
  const futureRun = new Date(Date.now() + 60 * 60_000).toISOString();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Sweep Matrix AI',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        // Lost wake: categorized thread but still parked -> sweep wakes it.
        buildCampaignLead({
          key: 'lost-wake-categorized',
          email: `lostwake-${harness.namespace}@furnace.test`,
          enrollment: parkedAtCategorizer(),
          thread: buildCampaignThread({
            subject: 'Categorized but parked',
            lastMessageAt: now,
            category: 'Interested',
            categorySource: 'user',
          }),
        }),
        // Lost park-RPC wake: uncategorized reply + AI on -> sweep wakes it.
        buildCampaignLead({
          key: 'lost-wake-uncategorized',
          email: `lostpark-${harness.namespace}@furnace.test`,
          enrollment: parkedAtCategorizer(),
          thread: buildCampaignThread({
            subject: 'Uncategorized reply, AI on',
            lastMessageAt: now,
            category: null,
            categorySource: null,
          }),
        }),
        // Auto Reply thread: waking would start a classify/re-park LLM loop.
        buildCampaignLead({
          key: 'auto-reply-parked',
          email: `autoreply-${harness.namespace}@furnace.test`,
          enrollment: parkedAtCategorizer(),
          thread: buildCampaignThread({
            subject: 'OOO stamped',
            lastMessageAt: now,
            category: 'Auto Reply',
            categorySource: 'system',
          }),
        }),
        // The >99% case: parked with no reply at all - must stay invisible.
        buildCampaignLead({
          key: 'no-reply-parked',
          email: `noreply-${harness.namespace}@furnace.test`,
          enrollment: parkedAtCategorizer(),
        }),
        // Already branched: the categorizer is done with this enrollment.
        buildCampaignLead({
          key: 'already-branched',
          email: `branched-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: null,
            attachReplyThread: true,
          }),
          thread: buildCampaignThread({
            subject: 'Already branched',
            lastMessageAt: now,
            category: 'Interested',
            categorySource: 'ai',
          }),
        }),
        // Not parked (scheduled retry in flight): sweep must not pull it earlier.
        buildCampaignLead({
          key: 'scheduled-retry',
          email: `scheduled-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'aiCategorizer-1',
            nextRunAt: futureRun,
          }),
          thread: buildCampaignThread({
            subject: 'Retry already scheduled',
            lastMessageAt: now,
            category: 'Interested',
            categorySource: 'user',
          }),
        }),
      ],
    });

    await runSweep(harness);

    const expectWoken = ['lost-wake-categorized', 'lost-wake-uncategorized'];
    const expectParked = ['auto-reply-parked', 'no-reply-parked', 'already-branched'];

    for (const key of expectWoken) {
      const enrollment = await getEnrollmentRow(harness, graph.leadsByKey.get(key)!.enrollmentId!);
      assert.ok(enrollment.next_run_at, `${key}: sweep must wake this enrollment`);
      assert.equal(enrollment.state, 'active');
    }
    for (const key of expectParked) {
      const enrollment = await getEnrollmentRow(harness, graph.leadsByKey.get(key)!.enrollmentId!);
      assert.equal(enrollment.next_run_at, null, `${key}: sweep must leave this enrollment parked`);
    }

    const scheduled = await getEnrollmentRow(
      harness,
      graph.leadsByKey.get('scheduled-retry')!.enrollmentId!,
    );
    assert.equal(
      new Date(scheduled.next_run_at).toISOString(),
      futureRun,
      'scheduled-retry: sweep must not move an existing next_run_at',
    );

    // Idempotent: a second sweep finds nothing new among our rows.
    await runSweep(harness);
    for (const key of expectParked) {
      const enrollment = await getEnrollmentRow(harness, graph.leadsByKey.get(key)!.enrollmentId!);
      assert.equal(enrollment.next_run_at, null, `${key}: still parked after a second sweep`);
    }
  } finally {
    await harness.cleanup();
  }
});

test('manual flow sweep: categorized threads wake, uncategorized stay parked for the user', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-sweep-manual') });
  const now = new Date().toISOString();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Sweep Matrix Manual',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: false,
      leads: [
        // Manual + categorized (lost manual-wake event) -> sweep recovers it.
        buildCampaignLead({
          key: 'manual-categorized',
          email: `mcat-${harness.namespace}@furnace.test`,
          enrollment: parkedAtCategorizer(),
          thread: buildCampaignThread({
            subject: 'User categorized, wake lost',
            lastMessageAt: now,
            category: 'Not Interested',
            categorySource: 'user',
          }),
        }),
        // Manual + uncategorized: nothing to do until the user acts - waking
        // would just burn a scheduler tick re-parking it.
        buildCampaignLead({
          key: 'manual-uncategorized',
          email: `muncat-${harness.namespace}@furnace.test`,
          enrollment: parkedAtCategorizer(),
          thread: buildCampaignThread({
            subject: 'Waiting on the user',
            lastMessageAt: now,
            category: null,
            categorySource: null,
          }),
        }),
      ],
    });

    await runSweep(harness);

    const categorized = await getEnrollmentRow(
      harness,
      graph.leadsByKey.get('manual-categorized')!.enrollmentId!,
    );
    assert.ok(categorized.next_run_at, 'manual categorized straggler must be woken');

    const uncategorized = await getEnrollmentRow(
      harness,
      graph.leadsByKey.get('manual-uncategorized')!.enrollmentId!,
    );
    assert.equal(uncategorized.next_run_at, null, 'manual uncategorized must stay parked');
  } finally {
    await harness.cleanup();
  }
});

test('sweep classifies by the LATEST replied thread, not stale older ones', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('cat-sweep-latest') });
  const now = Date.now();

  try {
    // One enrollment, two replied threads: the older one is categorized, the
    // newest is Auto Reply. The sweep must follow the newest and stay parked.
    const graph = await harness.createCampaignGraph({
      name: 'Categorizer Sweep Latest Thread',
      status: 'running',
      flowKind: 'emailWaitEmailCategorizer',
      categorizerUseAi: true,
      leads: [
        buildCampaignLead({
          key: 'subject',
          email: `latest-${harness.namespace}@furnace.test`,
          enrollment: parkedAtCategorizer(),
          thread: buildCampaignThread({
            subject: 'Older categorized thread',
            lastMessageAt: new Date(now - 24 * 60 * 60_000).toISOString(),
            category: 'Interested',
            categorySource: 'user',
          }),
        }),
      ],
    });

    const lead = graph.leadsByKey.get('subject')!;
    const { data: oldThread } = await harness.supabase
      .from('email_threads')
      .select('account_id, mailbox_id, message_job_id')
      .eq('id', lead.threadId!)
      .single();

    // Newer Auto Reply thread on the same enrollment.
    const { data: newThread, error: newThreadError } = await harness.supabase
      .from('email_threads')
      .insert({
        account_id: oldThread!.account_id,
        campaign_id: graph.campaignId,
        lead_id: lead.leadId,
        enrollment_id: lead.enrollmentId,
        message_job_id: null,
        mailbox_id: oldThread!.mailbox_id,
        subject: 'Newest thread is OOO',
        participants: [],
        last_message_at: new Date(now).toISOString(),
        message_count: 2,
        has_reply: true,
        category: 'Auto Reply',
        category_source: 'system',
      } as any)
      .select('id')
      .single();
    assert.equal(newThreadError, null);

    try {
      await runSweep(harness);
      const enrollment = await getEnrollmentRow(harness, lead.enrollmentId!);
      assert.equal(
        enrollment.next_run_at,
        null,
        'latest thread is Auto Reply: the sweep must not wake on the stale categorized one',
      );
    } finally {
      await harness.supabase.from('email_threads').delete().eq('id', newThread!.id);
    }
  } finally {
    await harness.cleanup();
  }
});
