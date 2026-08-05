/**
 * Outcome coverage for interrupted worker claims.
 *
 * Complements selfRecoveryOutcomes / imapScheduleOutcomes with an explicit
 * "SIGTERM mid-batch" contract: stale reserved work must not become `sent`,
 * and reclaim returns an eligible retry path without duplicating a successful send.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function isReclaimRpcSchemaMismatch(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '');
  if (!message.includes('reclaim_stale_campaign_message_jobs')) {
    return false;
  }
  const code = (error as { code?: string } | null)?.code;
  return (
    message.includes('p_reserved_stale_minutes') ||
    code === 'PGRST202' ||
    code === 'PGRST203'
  );
}

test('interrupted reserved send work is never marked sent and becomes eligible after reclaim', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('shutdown-claim'),
  });
  const now = Date.now();

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Shutdown Claim Recovery',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'interrupted',
          email: `interrupted-${harness.namespace}@furnace.test`,
          mailboxKey: 'mailbox-1',
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: null,
          }),
          jobs: [
            buildCampaignJob({
              key: 'attempt-1',
              nodeFlowNodeId: 'email-1',
              status: 'reserved',
              reservedAt: new Date(now - 10 * 60_000).toISOString(),
              leaseExpiresAt: new Date(now - 5 * 60_000).toISOString(),
              claimToken: 'shutdown-claim-token',
              scheduledAt: new Date(now - 20 * 60_000).toISOString(),
            }),
          ],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('interrupted')!;
    const attemptId = lead.messageJobIdsByKey.get('attempt-1')!;

    const reclaimResult = await harness.supabase.rpc('reclaim_stale_campaign_message_jobs', {
      p_batch_size: 50,
      p_rearm_delay_seconds: 60,
      p_reserved_stale_minutes: 5,
    });
    if (isReclaimRpcSchemaMismatch(reclaimResult.error)) {
      t.skip(
        'DB-backed test target has not applied reclaim_stale_campaign_message_jobs (3-arg) migration',
      );
      return;
    }
    assert.equal(reclaimResult.error, null);

    const { data: attempt, error } = await harness.supabase
      .from('message_jobs')
      .select('id, status, status_reason, claim_token, sent_at')
      .eq('id', attemptId)
      .single();
    assert.equal(error, null);
    assert.notEqual(attempt?.status, 'sent');
    assert.equal(attempt?.sent_at, null);
    assert.equal(attempt?.status, 'deferred');
    assert.equal(attempt?.claim_token, null);

    const { count, error: countError } = await harness.supabase
      .from('message_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('enrollment_id', lead.enrollmentId!)
      .eq('status', 'sent');
    assert.equal(countError, null);
    assert.equal(count ?? 0, 0, 'reclaim must not create a sent duplicate');
  } finally {
    await harness.cleanup();
  }
});
