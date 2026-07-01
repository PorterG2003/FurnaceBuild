import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEnrollmentProgressState } from '../../campaigns/enrollment-progress-state';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

type ProgressBucketsRow = {
  total_leads: number;
  not_started: number;
  in_progress: number;
  paused: number;
  completed: number;
  stopped: number;
};

async function loadProgressBuckets(
  harness: CampaignDbHarness,
  campaignId: string,
): Promise<ProgressBucketsRow> {
  const { data, error } = await harness.supabase.rpc('get_campaign_lead_progress_buckets', {
    p_campaign_id: campaignId,
  });
  assert.equal(error, null, error?.message);
  assert.equal((data ?? []).length, 1);
  return data![0] as ProgressBucketsRow;
}

async function loadContactedLeadIds(harness: CampaignDbHarness, campaignId: string): Promise<Set<string>> {
  const { data, error } = await harness.supabase.rpc('get_campaign_contacted_lead_ids', {
    p_campaign_id: campaignId,
  });
  assert.equal(error, null, error?.message);
  return new Set((data ?? []).filter(Boolean));
}

async function loadEnrollmentStateByLeadId(harness: CampaignDbHarness, campaignId: string) {
  const { data, error } = await harness.supabase
    .from('enrollments')
    .select('lead_id, state')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null);
  assert.equal(error, null);
  const map = new Map<string, 'active' | 'paused' | 'completed' | 'stopped' | null>();
  for (const row of data ?? []) {
    if (!row.lead_id) continue;
    const state = row.state;
    map.set(
      row.lead_id,
      state === 'active' || state === 'paused' || state === 'completed' || state === 'stopped'
        ? state
        : null,
    );
  }
  return map;
}

async function filterLeadIdsByProgressStates(
  harness: CampaignDbHarness,
  campaignId: string,
  progressStates: Array<'not_started' | 'active' | 'paused' | 'completed' | 'stopped'>,
): Promise<string[]> {
  const contactedLeadIds = await loadContactedLeadIds(harness, campaignId);
  const enrollmentByLeadId = await loadEnrollmentStateByLeadId(harness, campaignId);
  const { data: leads, error } = await harness.supabase
    .from('leads')
    .select('id')
    .eq('campaign_id', campaignId)
    .is('deleted_at', null);
  assert.equal(error, null);

  const selected = new Set(progressStates);
  return (leads ?? [])
    .map((lead) => lead.id)
    .filter((leadId) => {
      const progressState = getEnrollmentProgressState(
        enrollmentByLeadId.get(leadId) ?? null,
        contactedLeadIds.has(leadId),
      );
      return selected.has(progressState);
    });
}

test('get_campaign_lead_progress_buckets counts queued active enrollments as not_started', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('progress-queued') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Progress Queued',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead-a',
          email: `queued-a-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'lead-b',
          email: `queued-b-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const buckets = await loadProgressBuckets(harness, graph.campaignId);
    assert.equal(buckets.total_leads, 2);
    assert.equal(buckets.not_started, 2);
    assert.equal(buckets.in_progress, 0);
    assert.equal(
      buckets.not_started + buckets.in_progress + buckets.paused + buckets.completed + buckets.stopped,
      buckets.total_leads,
    );
  } finally {
    await harness.cleanup();
  }
});

test('get_campaign_lead_progress_buckets splits contacted and uncontacted active enrollments', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('progress-partial') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Progress Partial',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'uncontacted',
          email: `partial-uncontacted-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'contacted',
          email: `partial-contacted-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent-job', status: 'sent' })],
        }),
      ],
    });

    const buckets = await loadProgressBuckets(harness, graph.campaignId);
    assert.equal(buckets.total_leads, 2);
    assert.equal(buckets.not_started, 1);
    assert.equal(buckets.in_progress, 1);

    const contactedLeadIds = await loadContactedLeadIds(harness, graph.campaignId);
    assert.equal(contactedLeadIds.size, 1);
    assert.equal(contactedLeadIds.has(graph.leadsByKey.get('contacted')!.leadId), true);
  } finally {
    await harness.cleanup();
  }
});

test('get_campaign_lead_progress_buckets includes unenrolled leads in not_started', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('progress-unenrolled') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Progress Unenrolled',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'enrolled-a',
          email: `unenrolled-a-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'enrolled-b',
          email: `unenrolled-b-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'not-enrolled',
          email: `unenrolled-c-${harness.namespace}@furnace.test`,
          enrollment: null,
        }),
      ],
    });

    const buckets = await loadProgressBuckets(harness, graph.campaignId);
    assert.equal(buckets.total_leads, 3);
    assert.equal(buckets.not_started, 3);
    assert.equal(buckets.in_progress, 0);
    void graph;
  } finally {
    await harness.cleanup();
  }
});

test('campaign lead progress filters match contacted vs queued enrollments', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('progress-filter') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Progress Filter',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'uncontacted',
          email: `filter-uncontacted-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'contacted',
          email: `filter-contacted-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent-job', status: 'sent' })],
        }),
      ],
    });

    const uncontactedLeadId = graph.leadsByKey.get('uncontacted')!.leadId;
    const contactedLeadId = graph.leadsByKey.get('contacted')!.leadId;

    const notStartedLeadIds = await filterLeadIdsByProgressStates(harness, graph.campaignId, ['not_started']);
    assert.deepEqual(notStartedLeadIds.sort(), [uncontactedLeadId].sort());

    const inProgressLeadIds = await filterLeadIdsByProgressStates(harness, graph.campaignId, ['active']);
    assert.deepEqual(inProgressLeadIds.sort(), [contactedLeadId].sort());

    const contactedLeadIds = await loadContactedLeadIds(harness, graph.campaignId);
    const enrollmentByLeadId = await loadEnrollmentStateByLeadId(harness, graph.campaignId);
    assert.equal(
      getEnrollmentProgressState(enrollmentByLeadId.get(uncontactedLeadId) ?? null, contactedLeadIds.has(uncontactedLeadId)),
      'not_started',
    );
    assert.equal(
      getEnrollmentProgressState(enrollmentByLeadId.get(contactedLeadId) ?? null, contactedLeadIds.has(contactedLeadId)),
      'active',
    );
  } finally {
    await harness.cleanup();
  }
});

test('account_lead_people_page enrollment filters use progress semantics', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('people-progress-filter') });

  try {
    const uncontactedEmail = `people-uncontacted-${harness.namespace}@furnace.test`;
    const contactedEmail = `people-contacted-${harness.namespace}@furnace.test`;

    await harness.createCampaignGraph({
      name: 'People Progress Filter',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'uncontacted',
          email: uncontactedEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'contacted',
          email: contactedEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'sent-job', status: 'sent' })],
        }),
      ],
    });

    await harness.supabase.rpc('backfill_account_lead_people_batch', {
      p_account_id: harness.env.accountId,
      p_limit: 500,
    });

    const globalLeadIds = [uncontactedEmail, contactedEmail].map((email) => hashGlobalLeadId(email));

    const { data: notStartedRows, error: notStartedError } = await harness.supabase.rpc(
      'account_lead_people_page',
      {
        p_account_id: harness.env.accountId,
        p_global_lead_ids: globalLeadIds,
        p_enrollment_states: ['not_started'],
        p_limit: 10,
        p_offset: 0,
      },
    );
    assert.equal(notStartedError, null, notStartedError?.message);
    const notStartedIds = new Set((notStartedRows ?? []).map((row) => (row as { global_lead_id: string }).global_lead_id));
    assert.equal(notStartedIds.size, 1);
    assert.equal(notStartedIds.has(hashGlobalLeadId(uncontactedEmail)), true);

    const { data: inProgressRows, error: inProgressError } = await harness.supabase.rpc(
      'account_lead_people_page',
      {
        p_account_id: harness.env.accountId,
        p_global_lead_ids: globalLeadIds,
        p_enrollment_states: ['active'],
        p_limit: 10,
        p_offset: 0,
      },
    );
    assert.equal(inProgressError, null, inProgressError?.message);
    const inProgressIds = new Set((inProgressRows ?? []).map((row) => (row as { global_lead_id: string }).global_lead_id));
    assert.equal(inProgressIds.size, 1);
    assert.equal(inProgressIds.has(hashGlobalLeadId(contactedEmail)), true);
  } finally {
    await harness.cleanup();
  }
});
