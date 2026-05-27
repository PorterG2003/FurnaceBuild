import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { processImportJobById } from '../../../amplify/functions/clientApiBulkImport/handler.js';
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

async function loadGlobalLeadId(harness: CampaignDbHarness, leadId: string): Promise<string> {
  const { data, error } = await harness.supabase
    .from('leads')
    .select('global_lead_id')
    .eq('id', leadId)
    .single();
  assert.equal(error, null);
  return data!.global_lead_id as string;
}

test('remove_global_leads_from_campaign soft-deletes lead, stops enrollment, cancels queued job', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rm-campaign') });
  const email = `rm-campaign-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Remove One Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'job', status: 'queued' })],
        }),
      ],
    });

    const lead = graph.leadsByKey.get('lead')!;
    const globalLeadId = await loadGlobalLeadId(harness, lead.leadId);
    const jobId = [...lead.messageJobIdsByKey.values()][0]!;

    const { data, error } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(error, null);
    assert.equal((data as { removed: number }).removed, 1);
    assert.equal((data as { skipped: number }).skipped, 0);

    const { data: leadRow, error: leadError } = await harness.supabase
      .from('leads')
      .select('deleted_at')
      .eq('id', lead.leadId)
      .single();
    assert.equal(leadError, null);
    assert.ok(leadRow?.deleted_at);

    const { data: enrollment, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('state, deleted_at, next_run_at')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollmentError, null);
    assert.equal(enrollment?.state, 'stopped');
    assert.ok(enrollment?.deleted_at);
    assert.equal(enrollment?.next_run_at, null);

    const { data: job, error: jobError } = await harness.supabase
      .from('message_jobs')
      .select('status, status_reason')
      .eq('id', jobId)
      .single();
    assert.equal(jobError, null);
    assert.equal(job?.status, 'cancelled');
    assert.equal(job?.status_reason, 'lead_deleted');
  } finally {
    await harness.cleanup();
  }
});

test('remove_global_leads_from_campaign skip counts reflect unmutated selections', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rm-skip-counts') });
  const emailInCampaign = `rm-in-${harness.namespace}@furnace.test`;
  const emailAlreadyRemoved = `rm-gone-${harness.namespace}@furnace.test`;
  const emailMissing = `rm-missing-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Remove Skip Counts',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'in_campaign',
          email: emailInCampaign,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'already_removed',
          email: emailAlreadyRemoved,
          enrollment: buildCampaignEnrollment({ state: 'stopped' }),
        }),
      ],
    });

    const inCampaignGlobalId = await loadGlobalLeadId(
      harness,
      graph.leadsByKey.get('in_campaign')!.leadId,
    );
    const alreadyRemovedLead = graph.leadsByKey.get('already_removed')!;
    const alreadyRemovedGlobalId = await loadGlobalLeadId(harness, alreadyRemovedLead.leadId);
    const missingGlobalId = hashGlobalLeadId(emailMissing);

    const { error: markDeletedError } = await harness.supabase
      .from('leads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', alreadyRemovedLead.leadId);
    assert.equal(markDeletedError, null);

    const { data, error } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [inCampaignGlobalId, alreadyRemovedGlobalId, missingGlobalId],
    });
    assert.equal(error, null);
    assert.equal((data as { removed: number }).removed, 1);
    assert.equal((data as { skipped: number }).skipped, 2);
  } finally {
    await harness.cleanup();
  }
});

test('remove_global_leads_from_campaign skips people not in campaign', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rm-skip') });
  const email = `rm-skip-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Remove Skip',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const { data, error } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(error, null);
    assert.equal((data as { removed: number }).removed, 0);
    assert.equal((data as { skipped: number }).skipped, 1);
    void graph;
  } finally {
    await harness.cleanup();
  }
});

test('remove_global_leads_from_all_campaigns removes native memberships across campaigns', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rm-all') });
  const email = `rm-all-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const graphA = await harness.createCampaignGraph({
      name: 'Remove All A',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const graphB = await harness.createCampaignGraph({
      name: 'Remove All B',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data, error } = await harness.supabase.rpc('remove_global_leads_from_all_campaigns', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(error, null);
    assert.equal((data as { removed: number }).removed, 2);
    assert.equal((data as { skipped: number }).skipped, 0);

    const { count: countA } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', graphA.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(countA, 0);

    const { count: countB } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', graphB.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(countB, 0);
  } finally {
    await harness.cleanup();
  }
});

test('remove_global_leads_from_all_campaigns skip counts reflect people without native removals', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rm-all-skip') });
  const emailNative = `rm-all-native-${harness.namespace}@furnace.test`;
  const emailSmartleadOnly = `rm-all-sl-only-${harness.namespace}@furnace.test`;
  const emailMissing = `rm-all-missing-${harness.namespace}@furnace.test`;

  try {
    const nativeGraph = await harness.createCampaignGraph({
      name: 'Remove All Skip Native',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'native',
          email: emailNative,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const smartleadGraph = await harness.createCampaignGraph({
      name: 'Remove All Skip SL',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'smartlead_only',
          email: emailSmartleadOnly,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { error: markSmartleadError } = await harness.supabase
      .from('campaigns')
      .update({ source: 'smartlead' })
      .eq('id', smartleadGraph.campaignId);
    assert.equal(markSmartleadError, null);

    const nativeGlobalId = await loadGlobalLeadId(harness, nativeGraph.leadsByKey.get('native')!.leadId);
    const smartleadGlobalId = await loadGlobalLeadId(
      harness,
      smartleadGraph.leadsByKey.get('smartlead_only')!.leadId,
    );
    const missingGlobalId = hashGlobalLeadId(emailMissing);

    const { data, error } = await harness.supabase.rpc('remove_global_leads_from_all_campaigns', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [nativeGlobalId, smartleadGlobalId, missingGlobalId],
    });
    assert.equal(error, null);
    assert.equal((data as { removed: number }).removed, 1);
    assert.equal((data as { skipped: number }).skipped, 2);
    void nativeGraph;
  } finally {
    await harness.cleanup();
  }
});

test('remove_global_leads_from_all_campaigns skips smartlead campaigns', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rm-sl-skip') });
  const email = `rm-sl-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const nativeGraph = await harness.createCampaignGraph({
      name: 'Remove Native',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const smartleadGraph = await harness.createCampaignGraph({
      name: 'Remove Smartlead',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { error: markSmartleadError } = await harness.supabase
      .from('campaigns')
      .update({ source: 'smartlead' })
      .eq('id', smartleadGraph.campaignId);
    assert.equal(markSmartleadError, null);

    const { data, error } = await harness.supabase.rpc('remove_global_leads_from_all_campaigns', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(error, null);
    assert.equal((data as { removed: number }).removed, 1);
    assert.equal((data as { skipped: number }).skipped, 0);

    const { count: nativeCount } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', nativeGraph.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(nativeCount, 0);

    const { count: smartleadCount } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', smartleadGraph.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(smartleadCount, 1);
  } finally {
    await harness.cleanup();
  }
});

test('processImportJobById completes remove_from_campaign operation', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('rm-import-job') });
  const email = `rm-import-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Remove Import Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [buildCampaignJob({ key: 'job', status: 'queued' })],
        }),
      ],
    });

    const { data: job, error: insertError } = await harness.supabase
      .from('api_import_jobs')
      .insert({
        account_id: harness.env.accountId,
        campaign_id: graph.campaignId,
        status: 'queued',
        progress: 0,
        cursor: 0,
        input: {
          operation: 'remove_from_campaign',
          global_lead_ids: [globalLeadId],
        },
        result: {},
        errors: [],
      } as never)
      .select('id')
      .single();
    assert.equal(insertError, null);

    await processImportJobById(job!.id as string, { supabase: harness.supabase as any });

    const { data: finished } = await harness.supabase
      .from('api_import_jobs')
      .select('status, result')
      .eq('id', job!.id)
      .single();
    assert.equal(finished!.status, 'completed');
    assert.equal((finished!.result as { removed?: number }).removed, 1);

    const { count } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', graph.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(count, 0);
  } finally {
    await harness.cleanup();
  }
});
