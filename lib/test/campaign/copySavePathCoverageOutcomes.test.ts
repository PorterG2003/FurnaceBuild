import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { COPY_PIECE_KINDS } from '../../copy/kinds';
import type { Json } from '../../supabase/types/database';
import { updateCampaignFlowDataWithClient } from '../../supabase/services/campaigns/update-campaign-flow-with-client';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

type FlowData = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

function withUniqueEmailCopy(flow: FlowData, marker: string): FlowData {
  return {
    ...flow,
    nodes: flow.nodes.map((node) => {
      if (node.type !== 'email') return node;
      const data = node.data as Record<string, unknown>;
      const variants = (data.variants as Array<Record<string, unknown>>).map(
        (variant, index) => ({
          ...variant,
          id: randomUUID(),
          subject: `Coverage ${marker} ${index}`,
          template: `Unique coverage hook ${marker} ${index}. Worth a look?`,
        }),
      );
      return { ...node, data: { ...data, variants } };
    }),
  };
}

async function assertLatestVersionRegistered(
  harness: CampaignDbHarness,
  campaignId: string,
  marker: string,
) {
  const { data: version, error: versionError } = await harness.supabase
    .from('campaign_flow_versions')
    .select('id, version_number, copy_registered_at')
    .eq('campaign_id', campaignId)
    .order('version_number', { ascending: false })
    .limit(1)
    .single();
  assert.equal(versionError, null, versionError?.message);
  assert.ok(version?.copy_registered_at, `${marker}: version must be registered`);

  const { data: maps, error: mapError } = await harness.supabase
    .from('copy_variant_content_map')
    .select('content_id, copy_contents!inner(parse_status, subject, template)')
    .eq('campaign_id', campaignId)
    .eq('flow_version_number', version!.version_number);
  assert.equal(mapError, null, mapError?.message);
  const matching = (maps ?? []).filter((row) => {
    const content = row.copy_contents as unknown as { subject: string; template: string };
    return content.subject.includes(marker) || content.template.includes(marker);
  });
  assert.ok(matching.length > 0, `${marker}: mapping and content must exist`);
  assert.ok(
    matching.every(
      (row) =>
        (row.copy_contents as unknown as { parse_status: string }).parse_status === 'queued',
    ),
    `${marker}: new content must be queued`,
  );
}

test('flow registration covers service saves, generic writes, and reconciliation', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('copy-save-paths'),
  });

  try {
    const graph = await harness.createCampaignGraph({
      name: 'Copy Save Path Coverage',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'lead',
          email: `copy-save-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
        }),
      ],
    });

    const { data: campaign, error: campaignError } = await harness.supabase
      .from('campaigns')
      .select('flow_data')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignError, null, campaignError?.message);

    const { error: probeError } = await harness.supabase
      .from('copy_contents')
      .select('id')
      .limit(1);
    if (probeError?.code === '42P01' || probeError?.message.includes('copy_contents')) {
      t.skip('DB-backed target has not applied copy_structure_analytics');
      return;
    }

    const initial = campaign!.flow_data as unknown as FlowData;
    const cases: Array<{
      name: string;
      write: (flow: FlowData) => Promise<void>;
    }> = [
      {
        name: 'updateCampaignFlowDataWithClient',
        write: async (flow) => {
          await updateCampaignFlowDataWithClient(harness.supabase as never, {
            campaignId: graph.campaignId,
            accountId: harness.env.accountId,
            flowData: flow as unknown as Json,
            changeSource: 'test_copy_service_path',
          });
        },
      },
      {
        name: 'generic campaigns update',
        write: async (flow) => {
          const { error } = await harness.supabase
            .from('campaigns')
            .update({ flow_data: flow as unknown as Json })
            .eq('id', graph.campaignId);
          assert.equal(error, null, error?.message);
        },
      },
      {
        name: 'raw table write',
        write: async (flow) => {
          const { error } = await harness.supabase
            .from('campaigns')
            .update({ flow_data: flow as unknown as Json })
            .eq('id', graph.campaignId);
          assert.equal(error, null, error?.message);
        },
      },
    ];

    let flow = initial;
    for (const saveCase of cases) {
      const marker = `${saveCase.name}-${randomUUID()}`;
      flow = withUniqueEmailCopy(flow, marker);
      await saveCase.write(flow);
      await assertLatestVersionRegistered(harness, graph.campaignId, marker);
    }

    const { data: latest } = await harness.supabase
      .from('campaign_flow_versions')
      .select('id')
      .eq('campaign_id', graph.campaignId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();
    assert.ok(latest?.id);
    const { error: clearError } = await harness.supabase
      .from('campaign_flow_versions')
      .update({ copy_registered_at: null })
      .eq('id', latest!.id);
    assert.equal(clearError, null, clearError?.message);
    let remaining = 1;
    for (let attempt = 0; attempt < 20 && remaining > 0; attempt += 1) {
      const { error: reconcileError } = await harness.supabase.rpc(
        'reconcile_copy_versions',
        { p_account_id: harness.env.accountId, p_limit: 100 } as never,
      );
      assert.equal(reconcileError, null, reconcileError?.message);
      const { count, error: remainingError } = await harness.supabase
        .from('campaign_flow_versions')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', graph.campaignId)
        .is('copy_registered_at', null);
      assert.equal(remainingError, null, remainingError?.message);
      remaining = count ?? 0;
    }
    assert.equal(remaining, 0, 'closing invariant: no unregistered versions');
  } finally {
    await harness.cleanup();
  }
});

test('TypeScript and SQL copy-kind enums stay aligned', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('copy-kind-contract'),
  });
  const archetypeIds: string[] = [];
  try {
    await harness.createCampaignGraph({
      name: 'Copy Kind Contract',
      status: 'draft',
      flowKind: 'emailOnly',
      leads: [],
    });
    for (const kind of COPY_PIECE_KINDS) {
      const { data, error } = await harness.supabase
        .from('copy_archetypes')
        .insert({
          account_id: harness.env.accountId,
          kind,
          slug: `contract-${kind}-${harness.namespace}`,
          name: `Contract ${kind}`,
        } as never)
        .select('id')
        .single();
      if (error?.code === '42P01' || error?.message.includes('copy_archetypes')) {
        t.skip('DB-backed target has not applied copy_structure_analytics');
        return;
      }
      assert.equal(error, null, `${kind}: ${error?.message}`);
      archetypeIds.push(String((data as { id: string }).id));
    }

    const { error: bogusError } = await harness.supabase
      .from('copy_archetypes')
      .insert({
        account_id: harness.env.accountId,
        kind: 'urgency',
        slug: `contract-bogus-${harness.namespace}`,
        name: 'Bogus kind',
      } as never);
    assert.ok(bogusError, 'SQL must reject kinds outside COPY_PIECE_KINDS');
    assert.equal(bogusError?.code, '23514');
  } finally {
    if (archetypeIds.length > 0) {
      await harness.supabase.from('copy_archetypes').delete().in('id', archetypeIds);
    }
    await harness.cleanup();
  }
});
