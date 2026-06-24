import test from 'node:test';
import assert from 'node:assert/strict';
import { processImportJobById } from '../../../amplify/functions/clientApiBulkImport/handler.js';
import {
  dedupeWithinFile,
  filterBlockedEmails,
  filterExistingCampaignEmails,
  runCsvDedupePipeline,
} from '../../leads/csv-dedupe';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function isCsvImportDedupeRpcSchemaMismatch(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '');
  if (
    !message.includes('preview_emails_in_campaigns') &&
    !message.includes('create_csv_lead_import_job') &&
    !message.includes('append_csv_import_staging_rows')
  ) {
    return false;
  }
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === 'PGRST203';
}

test('preview_emails_in_campaigns returns only emails from specified campaigns', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('csv-preview') });
  const sharedEmail = `shared-${harness.namespace}@furnace.test`;
  const onlyAEmail = `only-a-${harness.namespace}@furnace.test`;

  try {
    const graphA = await harness.createCampaignGraph({
      name: 'CSV Preview A',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'a-shared',
          email: sharedEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
        buildCampaignLead({
          key: 'a-only',
          email: onlyAEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const graphB = await harness.createCampaignGraph({
      name: 'CSV Preview B',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'b-shared',
          email: sharedEmail,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data, error } = await harness.supabase.rpc('preview_emails_in_campaigns', {
      p_account_id: harness.env.accountId,
      p_campaign_ids: [graphA.campaignId],
      p_emails: [sharedEmail, onlyAEmail, `missing-${harness.namespace}@furnace.test`],
    });

    if (isCsvImportDedupeRpcSchemaMismatch(error)) {
      t.skip(
        'DB-backed test target has not applied csv import dedupe migration; refresh PostgREST schema after migrate',
      );
      return;
    }
    assert.equal(error, null);
    const row = (data ?? {}) as { matchingEmails?: string[] };
    const matching = new Set(row.matchingEmails ?? []);
    assert.ok(matching.has(sharedEmail.toLowerCase()));
    assert.ok(matching.has(onlyAEmail.toLowerCase()));
    assert.equal(matching.size, 2);
    void graphB;
  } finally {
    await harness.cleanup();
  }
});

test('import_api_leads_to_campaign upserts existing email without duplicating rows', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('csv-upsert') });
  const email = `csv-upsert-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'CSV Upsert Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const leadPayload = [{ email, first_name: 'First', last_name: 'Import' }];

    const first = await harness.supabase.rpc('import_api_leads_to_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_leads: leadPayload,
      p_options: { emit_row_webhooks: false },
    });
    assert.equal(first.error, null);
    assert.equal((first.data as { created?: number }).created, 1);

    const second = await harness.supabase.rpc('import_api_leads_to_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_leads: [{ ...leadPayload[0], company_name: 'Updated Co' }],
      p_options: { emit_row_webhooks: false },
    });
    assert.equal(second.error, null);
    assert.equal((second.data as { created?: number }).created, 0);
    assert.equal((second.data as { updated?: number }).updated, 1);

    const { data: leads, error: leadsError } = await harness.supabase
      .from('leads')
      .select('id, company_name')
      .eq('campaign_id', graph.campaignId)
      .eq('email', email)
      .is('deleted_at', null);
    assert.equal(leadsError, null);
    assert.equal(leads?.length, 1);
    assert.equal(leads?.[0]?.company_name, 'Updated Co');
  } finally {
    await harness.cleanup();
  }
});

test('csv_lead_import_staged job imports staged rows and cleans up staging', async (t) => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('csv-staged') });
  const email = `csv-staged-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'CSV Staged Target',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [],
    });

    const { data: jobId, error: createError } = await harness.supabase.rpc('create_csv_lead_import_job', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
    });
    if (isCsvImportDedupeRpcSchemaMismatch(createError)) {
      t.skip(
        'DB-backed test target has not applied csv import dedupe migration; refresh PostgREST schema after migrate',
      );
      return;
    }
    assert.equal(createError, null);
    assert.ok(jobId);

    const { error: appendError } = await harness.supabase.rpc('append_csv_import_staging_rows', {
      p_job_id: jobId,
      p_rows: [{ email, first_name: 'Staged', last_name: 'Import' }],
    });
    assert.equal(appendError, null);

    const { error: finalizeError } = await harness.supabase.rpc('finalize_csv_lead_import_job', {
      p_job_id: jobId,
    });
    assert.equal(finalizeError, null);

    await processImportJobById(jobId as string, { supabase: harness.supabase as never });

    const { data: job, error: jobError } = await harness.supabase
      .from('api_import_jobs')
      .select('status, result')
      .eq('id', jobId as string)
      .single();
    assert.equal(jobError, null);
    assert.equal(job?.status, 'completed');

    const { count: leadCount } = await harness.supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', graph.campaignId)
      .eq('email', email)
      .is('deleted_at', null);
    assert.equal(leadCount, 1);

    const { count: stagingCount } = await harness.supabase
      .from('csv_import_staging')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId as string);
    assert.equal(stagingCount, 0);
  } finally {
    await harness.cleanup();
  }
});

test('CSV dedupe pipeline excludes campaign and block-list matches', () => {
  const rows = [
    { email: 'dup@test.com' },
    { email: 'dup@test.com' },
    { email: 'exists@test.com' },
    { email: 'blocked@test.com' },
    { email: 'fresh@test.com' },
  ];

  const blockList = [
    {
      id: '1',
      account_id: 'a',
      value: 'blocked@test.com',
      type: 'email' as const,
      reason: 'manual',
      created_at: new Date().toISOString(),
    },
  ];

  const result = runCsvDedupePipeline(rows, {
    dedupeWithinFile: true,
    filterInCampaigns: true,
    filterBlockList: true,
    emailColumn: 'email',
    matchingCampaignEmails: new Set(['exists@test.com']),
    blockListEntries: blockList,
  });

  assert.equal(result.stats.removedWithinFile, 1);
  assert.equal(result.stats.removedInCampaigns, 1);
  assert.equal(result.stats.removedBlocked, 1);
  assert.equal(result.stats.kept, 2);

  const { kept: afterDup } = dedupeWithinFile(rows, 'email');
  const { kept: afterCampaign } = filterExistingCampaignEmails(afterDup, 'email', new Set(['exists@test.com']));
  const { kept: afterBlock } = filterBlockedEmails(afterCampaign, 'email', blockList);
  assert.equal(afterBlock.length, result.stats.kept);
});
