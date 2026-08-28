import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

const OLDER_CREATED_AT = '2026-01-01T00:00:00.000Z';
const NEWER_CREATED_AT = '2026-01-01T01:00:00.000Z';
const TIE_CREATED_AT = '2026-02-01T00:00:00.000Z';

async function setJobCreatedAt(
  harness: CampaignDbHarness,
  jobId: string,
  createdAt: string,
): Promise<void> {
  const { error } = await harness.supabase
    .from('message_jobs')
    .update({ created_at: createdAt })
    .eq('id', jobId);
  assert.equal(error, null, error?.message);
}

function rowByEnrollment(
  rows: Array<{ id: string; enrollment_id: string; node_id: string }> | null,
  enrollmentId: string,
) {
  return (rows ?? []).find((row) => row.enrollment_id === enrollmentId) ?? null;
}

test('get_latest_message_jobs_for_pairs does not treat a cross enrollment/node job as latest', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('latest-job-pairs'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Latest Job Pair Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmail',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `lead-a-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'a-on-email-1',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
            }),
            buildCampaignJob({
              key: 'a-on-email-2-cross',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
            }),
          ],
        }),
        buildCampaignLead({
          key: 'lead-b',
          email: `lead-b-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-2',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'b-on-email-2',
              nodeFlowNodeId: 'email-2',
              status: 'sent',
            }),
          ],
        }),
      ],
    });

    const leadA = graph.leadsByKey.get('lead-a')!;
    const leadB = graph.leadsByKey.get('lead-b')!;
    const nodeEmail1 = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const nodeEmail2 = graph.nodeIdsByFlowNodeId.get('email-2')!;
    const jobAOnEmail1 = leadA.messageJobIdsByKey.get('a-on-email-1')!;
    const jobACross = leadA.messageJobIdsByKey.get('a-on-email-2-cross')!;
    const jobBOnEmail2 = leadB.messageJobIdsByKey.get('b-on-email-2')!;
    const missingEnrollmentId = randomUUID();
    const missingNodeId = randomUUID();

    const { data, error } = await harness.supabase.rpc('get_latest_message_jobs_for_pairs', {
      p_pairs: [
        { enrollment_id: leadA.enrollmentId, node_id: nodeEmail1 },
        { enrollment_id: leadB.enrollmentId, node_id: nodeEmail2 },
        { enrollment_id: missingEnrollmentId, node_id: missingNodeId },
      ],
    });
    assert.equal(error, null, error?.message);

    const rows = (data ?? []) as Array<{ id: string; enrollment_id: string; node_id: string }>;
    const ids = rows.map((row) => row.id);
    assert.equal(rows.length, 2);
    assert.equal(rowByEnrollment(rows, leadA.enrollmentId)?.id, jobAOnEmail1);
    assert.equal(rowByEnrollment(rows, leadA.enrollmentId)?.node_id, nodeEmail1);
    assert.equal(rowByEnrollment(rows, leadB.enrollmentId)?.id, jobBOnEmail2);
    assert.equal(rowByEnrollment(rows, leadB.enrollmentId)?.node_id, nodeEmail2);
    assert.equal(ids.includes(jobACross), false);
    assert.equal(
      rows.some((row) => row.enrollment_id === missingEnrollmentId),
      false,
    );
  } finally {
    await harness.cleanup();
  }
});

test('get_latest_message_jobs_for_pairs returns the newest attempt including ties and duplicate input', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('latest-job-wins'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Latest Job Wins Outcomes',
      status: 'running',
      flowKind: 'emailWaitEmail',
      mailboxes: [
        {
          key: 'mailbox-1',
          emailAddress: `sender-${harness.namespace}@example.com`,
          displayName: 'Sender',
        },
      ],
      leads: [
        buildCampaignLead({
          key: 'lead-latest',
          email: `lead-latest-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'older-sent',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
            }),
            buildCampaignJob({
              key: 'newer-deferred',
              nodeFlowNodeId: 'email-1',
              status: 'deferred',
              statusReason: 'transient_read_error',
            }),
          ],
        }),
        buildCampaignLead({
          key: 'lead-tie',
          email: `lead-tie-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-2',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
          jobs: [
            buildCampaignJob({
              key: 'tie-a',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
            }),
            buildCampaignJob({
              key: 'tie-b',
              nodeFlowNodeId: 'email-2',
              status: 'queued',
            }),
          ],
        }),
      ],
    });

    const leadLatest = graph.leadsByKey.get('lead-latest')!;
    const leadTie = graph.leadsByKey.get('lead-tie')!;
    const nodeEmail1 = graph.nodeIdsByFlowNodeId.get('email-1')!;
    const nodeEmail2 = graph.nodeIdsByFlowNodeId.get('email-2')!;
    const olderSentId = leadLatest.messageJobIdsByKey.get('older-sent')!;
    const newerDeferredId = leadLatest.messageJobIdsByKey.get('newer-deferred')!;
    const tieAId = leadTie.messageJobIdsByKey.get('tie-a')!;
    const tieBId = leadTie.messageJobIdsByKey.get('tie-b')!;
    const tieWinnerId = tieAId > tieBId ? tieAId : tieBId;

    await setJobCreatedAt(harness, olderSentId, OLDER_CREATED_AT);
    await setJobCreatedAt(harness, newerDeferredId, NEWER_CREATED_AT);
    await setJobCreatedAt(harness, tieAId, TIE_CREATED_AT);
    await setJobCreatedAt(harness, tieBId, TIE_CREATED_AT);

    const { data, error } = await harness.supabase.rpc('get_latest_message_jobs_for_pairs', {
      p_pairs: [
        { enrollment_id: leadLatest.enrollmentId, node_id: nodeEmail1 },
        { enrollment_id: leadLatest.enrollmentId, node_id: nodeEmail1 },
        { enrollment_id: leadTie.enrollmentId, node_id: nodeEmail2 },
      ],
    });
    assert.equal(error, null, error?.message);

    const rows = (data ?? []) as Array<{ id: string; enrollment_id: string; status: string }>;
    assert.equal(rows.length, 2);
    assert.equal(rowByEnrollment(rows, leadLatest.enrollmentId)?.id, newerDeferredId);
    assert.equal(rowByEnrollment(rows, leadLatest.enrollmentId)?.status, 'deferred');
    assert.equal(rowByEnrollment(rows, leadTie.enrollmentId)?.id, tieWinnerId);
  } finally {
    await harness.cleanup();
  }
});

test('get_latest_message_jobs_for_pairs returns empty for empty input and caps at 200 pairs', async () => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('latest-job-cap'),
  });

  try {
    await harness.createCampaignGraph({
      name: 'Latest Job Cap Outcomes',
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
        buildCampaignLead({
          key: 'unused',
          email: `unused-${harness.namespace}@example.com`,
          enrollment: buildCampaignEnrollment({
            state: 'active',
            currentFlowNodeId: 'email-1',
            nextRunAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        }),
      ],
    });

    const emptyResult = await harness.supabase.rpc('get_latest_message_jobs_for_pairs', {
      p_pairs: [],
    });
    assert.equal(emptyResult.error, null, emptyResult.error?.message);
    assert.equal((emptyResult.data ?? []).length, 0);

    const nullResult = await harness.supabase.rpc('get_latest_message_jobs_for_pairs', {
      p_pairs: null,
    });
    assert.equal(nullResult.error, null, nullResult.error?.message);
    assert.equal((nullResult.data ?? []).length, 0);

    const oversizedPairs = Array.from({ length: 201 }, () => ({
      enrollment_id: randomUUID(),
      node_id: randomUUID(),
    }));
    const capResult = await harness.supabase.rpc('get_latest_message_jobs_for_pairs', {
      p_pairs: oversizedPairs,
    });
    assert.equal(capResult.error, null, capResult.error?.message);
    assert.ok(
      (capResult.data ?? []).length <= 200,
      `expected at most 200 rows, got ${(capResult.data ?? []).length}`,
    );
  } finally {
    await harness.cleanup();
  }
});
