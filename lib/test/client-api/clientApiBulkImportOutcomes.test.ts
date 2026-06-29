import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { processImportJobById } from '../../../amplify/functions/clientApiBulkImport/handler.js';
import { CampaignDbHarness } from '../campaign/harness';
import { buildCampaignEnrollment, buildCampaignJob, buildCampaignLead, createCampaignTestNamespace } from '../campaign/fixtures';

function hashGlobalLeadId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

test('processImportJobById completes api_lead_import job with leads and enrollments', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('import-worker') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Import Worker Campaign',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const email = `import-worker-${harness.namespace}@furnace.test`;
    const { data: job, error: insertError } = await harness.supabase
      .from('api_import_jobs')
      .insert({
        account_id: harness.env.accountId,
        campaign_id: graph.campaignId,
        status: 'queued',
        progress: 0,
        cursor: 0,
        input: {
          operation: 'api_lead_import',
          leads: [{ email, first_name: 'Import', last_name: 'Worker' }],
        },
        result: {},
        errors: [],
      } as never)
      .select('id')
      .single();
    assert.equal(insertError, null);

    await processImportJobById(job!.id as string, { supabase: harness.supabase as any });

    const { data: finished, error: loadError } = await harness.supabase
      .from('api_import_jobs')
      .select('status, result')
      .eq('id', job!.id)
      .single();
    assert.equal(loadError, null);
    assert.equal(finished!.status, 'completed');

    const { data: leads, error: leadsError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', graph.campaignId)
      .eq('email', email)
      .is('deleted_at', null);
    assert.equal(leadsError, null);
    assert.equal(leads?.length, 1);

    const { data: enrollments, error: enrollmentError } = await harness.supabase
      .from('enrollments')
      .select('id, state')
      .eq('lead_id', leads![0]!.id as string)
      .is('deleted_at', null);
    assert.equal(enrollmentError, null);
    assert.equal(enrollments?.length, 1);
    assert.equal(enrollments![0]!.state, 'active');
  } finally {
    await harness.cleanup();
  }
});

test('processImportJobById surfaces incomplete rows in the api_lead_import job result', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('import-incomplete') });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Import Worker Incomplete',
      status: 'running',
      flowKind: 'emailOnly',
      leadSourceCustomFieldKeys: ['Industry'],
      leads: [],
    });

    const completeEmail = `import-complete-${harness.namespace}@furnace.test`;
    const incompleteEmail = `import-incomplete-${harness.namespace}@furnace.test`;
    const { data: job, error: insertError } = await harness.supabase
      .from('api_import_jobs')
      .insert({
        account_id: harness.env.accountId,
        campaign_id: graph.campaignId,
        status: 'queued',
        progress: 0,
        cursor: 0,
        input: {
          operation: 'api_lead_import',
          leads: [
            { email: completeEmail, custom_lead_data: { Industry: 'SaaS' } },
            { email: incompleteEmail },
          ],
        },
        result: {},
        errors: [],
      } as never)
      .select('id')
      .single();
    assert.equal(insertError, null);

    await processImportJobById(job!.id as string, { supabase: harness.supabase as any });

    const { data: finished, error: loadError } = await harness.supabase
      .from('api_import_jobs')
      .select('status, result')
      .eq('id', job!.id)
      .single();
    assert.equal(loadError, null);
    assert.equal(finished!.status, 'completed');
    assert.equal((finished!.result as { incomplete?: number }).incomplete, 1);

    const { count } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', graph.campaignId)
      .in('email', [completeEmail, incompleteEmail])
      .is('deleted_at', null);
    assert.equal(count, 2);
  } finally {
    await harness.cleanup();
  }
});

test('processImportJobById completes add_to_campaign operation', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('import-add-campaign') });
  const email = `import-add-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const sourceGraph = await harness.createCampaignGraph({
      name: 'Import Add Source',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'source',
          email,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const targetGraph = await harness.createCampaignGraph({
      name: 'Import Add Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const { data: job, error: insertError } = await harness.supabase
      .from('api_import_jobs')
      .insert({
        account_id: harness.env.accountId,
        campaign_id: targetGraph.campaignId,
        status: 'queued',
        progress: 0,
        cursor: 0,
        input: {
          operation: 'add_to_campaign',
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

    const { count } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', targetGraph.campaignId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(count, 1);
    void sourceGraph;
  } finally {
    await harness.cleanup();
  }
});

test('processImportJobById completes pause_enrollments operation', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('import-pause-enr') });
  const email = `import-pause-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Import Pause Campaign',
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
          operation: 'pause_enrollments',
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
    assert.equal((finished!.result as { paused?: number }).paused, 1);

    const lead = graph.leadsByKey.get('lead')!;
    const { data: enrollment } = await harness.supabase
      .from('enrollments')
      .select('state')
      .eq('id', lead.enrollmentId!)
      .single();
    assert.equal(enrollment?.state, 'paused');
  } finally {
    await harness.cleanup();
  }
});

test('processImportJobById completes remove_from_campaign and emits batch completion webhook', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('import-remove-campaign') });
  const email = `import-remove-${harness.namespace}@furnace.test`;
  const globalLeadId = hashGlobalLeadId(email);

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Import Remove Campaign',
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

    const { data: events } = await harness.supabase
      .from('webhook_events')
      .select('event_type, payload')
      .eq('account_id', harness.env.accountId)
      .eq('campaign_id', graph.campaignId);
    assert.equal(events?.filter((row) => row.event_type === 'lead.removed_from_campaign.completed').length, 1);
    assert.equal(events?.filter((row) => row.event_type === 'lead.deleted').length, 0);
  } finally {
    await harness.cleanup();
  }
});
