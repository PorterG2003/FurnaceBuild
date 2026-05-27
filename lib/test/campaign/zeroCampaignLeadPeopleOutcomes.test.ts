import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SAVED_LIST_COLUMNS } from '@/lib/leads/columns/defaults';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';
import { loadRollupRow } from './add-to-campaign-rpc-helpers';

async function loadGlobalLeadId(harness: CampaignDbHarness, leadId: string): Promise<string> {
  const { data, error } = await harness.supabase
    .from('leads')
    .select('global_lead_id')
    .eq('id', leadId)
    .single();
  assert.equal(error, null);
  return data!.global_lead_id as string;
}

test('remove last campaign membership retains rollup at campaign_count zero', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('zero-rollup') });
  const email = `zero-rollup-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Zero Rollup',
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

    const { error: removeError } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(removeError, null);

    const rollup = await loadRollupRow(harness, globalLeadId);
    assert.ok(rollup);
    assert.equal(Number(rollup!.campaign_count), 0);
    assert.equal(rollup!.email, email);
  } finally {
    await harness.cleanup();
  }
});

test('account_lead_people_page still returns person after remove with no filters', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('zero-explorer') });
  const email = `zero-explorer-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Zero Explorer',
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

    const globalLeadId = await loadGlobalLeadId(harness, graph.leadsByKey.get('lead')!.leadId);

    const { data: beforePage, error: beforeError } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [globalLeadId],
      p_limit: 10,
      p_offset: 0,
    });
    assert.equal(beforeError, null);
    assert.equal((beforePage ?? []).length, 1);
    const beforeTotal = (beforePage?.[0] as { total_count: number }).total_count;

    const { error: removeError } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(removeError, null);

    const { data: afterPage, error: afterError } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [globalLeadId],
      p_limit: 10,
      p_offset: 0,
    });
    assert.equal(afterError, null);
    assert.equal((afterPage ?? []).length, 1);
    assert.equal((afterPage?.[0] as { email: string }).email, email);
    assert.equal(Number((afterPage?.[0] as { campaign_count: number }).campaign_count), 0);
    assert.equal((afterPage?.[0] as { total_count: number }).total_count, beforeTotal);
  } finally {
    await harness.cleanup();
  }
});

test('account_lead_people_page excludes zero-campaign person when campaign filter is set', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('zero-filter') });
  const email = `zero-filter-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Zero Filter',
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

    const globalLeadId = await loadGlobalLeadId(harness, graph.leadsByKey.get('lead')!.leadId);

    const { error: removeError } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(removeError, null);

    const { data: filtered, error: filterError } = await harness.supabase.rpc('account_lead_people_page', {
      p_account_id: harness.env.accountId,
      p_global_lead_ids: [globalLeadId],
      p_campaign_ids: [graph.campaignId],
      p_limit: 10,
      p_offset: 0,
    });
    assert.equal(filterError, null);
    assert.equal((filtered ?? []).length, 0);
  } finally {
    await harness.cleanup();
  }
});

test('saved_lead_list_people_page still returns member after remove from only campaign', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('zero-saved-list') });
  const email = `zero-saved-list-${harness.namespace}@furnace.test`;
  let listId: string | null = null;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Zero Saved List',
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

    const globalLeadId = await loadGlobalLeadId(harness, graph.leadsByKey.get('lead')!.leadId);

    const { data: listRow, error: listError } = await harness.supabase
      .from('lead_saved_lists')
      .insert({
        account_id: harness.env.accountId,
        name: `Zero list ${harness.namespace}`,
        description: null,
        column_layout: DEFAULT_SAVED_LIST_COLUMNS as never,
      })
      .select('id')
      .single();
    assert.equal(listError, null);
    listId = listRow!.id as string;

    const { error: membersError } = await harness.supabase.from('lead_saved_list_members').insert({
      list_id: listId,
      account_id: harness.env.accountId,
      global_lead_id: globalLeadId,
      source: 'selection' as const,
    });
    assert.equal(membersError, null);

    const { data: beforePage, error: beforeError } = await harness.supabase.rpc('saved_lead_list_people_page', {
      p_account_id: harness.env.accountId,
      p_list_id: listId,
      p_limit: 10,
      p_offset: 0,
    });
    assert.equal(beforeError, null);
    assert.equal((beforePage ?? []).length, 1);
    const beforeTotal = (beforePage?.[0] as { total_count: number }).total_count;

    const { error: removeError } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(removeError, null);

    const { data: afterPage, error: afterError } = await harness.supabase.rpc('saved_lead_list_people_page', {
      p_account_id: harness.env.accountId,
      p_list_id: listId,
      p_limit: 10,
      p_offset: 0,
    });
    assert.equal(afterError, null);
    assert.equal((afterPage ?? []).length, 1);
    assert.equal((afterPage?.[0] as { email: string }).email, email);
    assert.equal(Number((afterPage?.[0] as { campaign_count: number }).campaign_count), 0);
    assert.equal((afterPage?.[0] as { total_count: number }).total_count, beforeTotal);
  } finally {
    if (listId) {
      await harness.supabase.from('lead_saved_list_members').delete().eq('list_id', listId);
      await harness.supabase.from('lead_saved_lists').delete().eq('id', listId);
    }
    await harness.cleanup();
  }
});

test('zero-campaign person has rollup identity and no active lead rows for detail fallback', async () => {
  const harness = new CampaignDbHarness({ namespace: createCampaignTestNamespace('zero-detail') });
  const email = `zero-detail-${harness.namespace}@furnace.test`;

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Zero Detail',
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

    const globalLeadId = await loadGlobalLeadId(harness, graph.leadsByKey.get('lead')!.leadId);

    const { error: removeError } = await harness.supabase.rpc('remove_global_leads_from_campaign', {
      p_account_id: harness.env.accountId,
      p_campaign_id: graph.campaignId,
      p_global_lead_ids: [globalLeadId],
    });
    assert.equal(removeError, null);

    const rollup = await loadRollupRow(harness, globalLeadId);
    assert.ok(rollup);
    assert.equal(rollup!.email, email);
    assert.equal(Number(rollup!.campaign_count), 0);

    const { data: activeLeads, error: activeError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('account_id', harness.env.accountId)
      .eq('global_lead_id', globalLeadId)
      .is('deleted_at', null);
    assert.equal(activeError, null);
    assert.equal((activeLeads ?? []).length, 0);

    const { data: historicalLeads, error: historicalError } = await harness.supabase
      .from('leads')
      .select('id')
      .eq('account_id', harness.env.accountId)
      .eq('global_lead_id', globalLeadId);
    assert.equal(historicalError, null);
    assert.ok((historicalLeads ?? []).length >= 1);
  } finally {
    await harness.cleanup();
  }
});
