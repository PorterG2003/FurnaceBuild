import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { copyPieceFingerprint } from '../../copy/normalizeCopy';
import { upsertCopyRenderingForJob } from '../../copy/upsertCopyRendering';
import { buildSpintaxSeed } from '../../email/processSpintax';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function isMissingMigration(error: { message?: string; code?: string } | null): boolean {
  const message = error?.message ?? '';
  return (
    error?.code === 'PGRST202' ||
    error?.code === '42P01' ||
    error?.code === '42703' ||
    message.includes('account_copy_stats')
  );
}

test('copy stats attribute exact flow copy, dedupe repeated pieces, and reconcile totals', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('copy-stats'),
  });
  const cleanup = {
    occurrenceContentIds: [] as string[],
    pieceIds: [] as string[],
    archetypeIds: [] as string[],
    contentIds: [] as string[],
    renderingIds: [] as string[],
  };

  try {
    const primaryVariantId = randomUUID();
    const graph = await harness.createCampaignGraph({
      name: 'Copy Stats Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'attributed',
          email: `copy-attributed-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'sent',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              messageType: 'campaign',
              variantId: primaryVariantId,
            }),
          ],
        }),
        buildCampaignLead({
          key: 'unattributed',
          email: `copy-unattributed-${harness.namespace}@furnace.test`,
          enrollment: buildCampaignEnrollment({ state: 'active' }),
          jobs: [
            buildCampaignJob({
              key: 'sent',
              nodeFlowNodeId: 'email-1',
              status: 'sent',
              messageType: 'campaign',
              variantId: null,
            }),
          ],
        }),
      ],
    });

    const { data: initialCampaign, error: initialCampaignError } = await harness.supabase
      .from('campaigns')
      .select('flow_data')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(initialCampaignError, null, initialCampaignError?.message);
    const flow = initialCampaign!.flow_data as unknown as {
      nodes: Array<{ type: string; data: { variants?: Array<Record<string, unknown>> } }>;
      edges: unknown[];
    };
    const nextFlow = {
      ...flow,
      nodes: flow.nodes.map((node) =>
        node.type === 'email'
          ? {
              ...node,
              data: {
                ...node.data,
                variants: (node.data.variants ?? []).map((variant, index) => ({
                  ...variant,
                  id: index === 0 ? primaryVariantId : randomUUID(),
                })),
              },
            }
          : node,
      ),
    };
    const { error: flowError } = await harness.supabase
      .from('campaigns')
      .update({ flow_data: nextFlow as never })
      .eq('id', graph.campaignId);
    assert.equal(flowError, null, flowError?.message);

    const { data: campaign, error: campaignError } = await harness.supabase
      .from('campaigns')
      .select('current_flow_version_number')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignError, null, campaignError?.message);
    const version = Number(campaign?.current_flow_version_number ?? 0);
    assert.ok(version > 0);

    const attributedLead = graph.leadsByKey.get('attributed')!;
    const unattributedLead = graph.leadsByKey.get('unattributed')!;
    const attributedJobId = attributedLead.messageJobIdsByKey.get('sent')!;
    const unattributedJobId = unattributedLead.messageJobIdsByKey.get('sent')!;
    const { error: versionError } = await harness.supabase
      .from('message_jobs')
      .update({ flow_version_number: version } as never)
      .in('id', [attributedJobId, unattributedJobId]);
    assert.equal(versionError, null, versionError?.message);
    const { error: variantError } = await harness.supabase
      .from('message_jobs')
      .update({ variant_id: primaryVariantId } as never)
      .eq('id', attributedJobId);
    assert.equal(variantError, null, variantError?.message);

    const { data: mapping, error: mappingError } = await harness.supabase
      .from('copy_variant_content_map')
      .select('content_id')
      .eq('campaign_id', graph.campaignId)
      .eq('flow_node_id', 'email-1')
      .eq('flow_version_number', version)
      .eq('variant_id', primaryVariantId)
      .single();
    if (isMissingMigration(mappingError)) {
      t.skip('DB-backed target has not applied copy_structure_analytics');
      return;
    }
    assert.equal(mappingError, null, mappingError?.message);
    const contentId = String((mapping as { content_id: string }).content_id);
    cleanup.contentIds.push(contentId);

    const { data: archetype, error: archetypeError } = await harness.supabase
      .from('copy_archetypes')
      .insert({
        account_id: harness.env.accountId,
        kind: 'proof',
        slug: `quantified-proof-${harness.namespace}`,
        name: 'Quantified proof',
      } as never)
      .select('id')
      .single();
    assert.equal(archetypeError, null, archetypeError?.message);
    const archetypeId = String((archetype as { id: string }).id);
    cleanup.archetypeIds.push(archetypeId);

    const proofTexts = ['Cut ramp time by 42%.', 'Saved 18 hours per rep.'];
    for (let position = 0; position < proofTexts.length; position += 1) {
      const text = proofTexts[position]!;
      const { data: piece, error: pieceError } = await harness.supabase
        .from('copy_pieces')
        .insert({
          account_id: harness.env.accountId,
          kind: 'proof',
          fingerprint: await copyPieceFingerprint(text),
          raw_text: text,
          display_text: text,
          archetype_id: archetypeId,
        } as never)
        .select('id')
        .single();
      assert.equal(pieceError, null, pieceError?.message);
      const pieceId = String((piece as { id: string }).id);
      cleanup.pieceIds.push(pieceId);
      cleanup.occurrenceContentIds.push(contentId);
      const { error: occurrenceError } = await harness.supabase
        .from('copy_piece_occurrences')
        .insert({
          account_id: harness.env.accountId,
          content_id: contentId,
          piece_id: pieceId,
          position,
        } as never);
      assert.equal(occurrenceError, null, occurrenceError?.message);
    }

    const { data: contentRow, error: contentError } = await harness.supabase
      .from('copy_contents')
      .select('subject')
      .eq('id', contentId)
      .single();
    assert.equal(contentError, null, contentError?.message);
    let renderingId: string | null = null;
    try {
      renderingId = await upsertCopyRenderingForJob({
        db: harness.supabase,
        accountId: harness.env.accountId,
        contentId,
        rawSubject: String((contentRow as { subject?: string } | null)?.subject ?? ''),
        seed: buildSpintaxSeed({
          campaignId: graph.campaignId,
          leadId: attributedLead.leadId,
          variantId: primaryVariantId,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('copy_renderings') || message.includes('schema cache')) {
        t.skip('DB-backed target has not applied copy_renderings');
        return;
      }
      throw error;
    }
    if (!renderingId) {
      t.skip('DB-backed target has not applied copy_renderings');
      return;
    }
    cleanup.renderingIds.push(renderingId);
    const { error: stampError } = await harness.supabase
      .from('message_jobs')
      .update({ copy_rendering_id: renderingId } as never)
      .eq('id', attributedJobId);
    if (stampError?.message?.includes('copy_rendering_id')) {
      t.skip('DB-backed target has not applied copy_renderings');
      return;
    }
    assert.equal(stampError, null, stampError?.message);

    for (const [lead, jobId] of [
      [attributedLead, attributedJobId],
      [unattributedLead, unattributedJobId],
    ] as const) {
      const { error } = await harness.supabase.rpc('record_sent_event_and_increment', {
        p_campaign_id: graph.campaignId,
        p_lead_id: lead.leadId,
        p_enrollment_id: lead.enrollmentId!,
        p_message_job_id: jobId,
        p_event_data: { source: 'copy-stats-outcomes' },
      });
      assert.equal(error, null, error?.message);
    }
    const { error: repliedError } = await harness.supabase.rpc(
      'record_replied_event_and_increment',
      {
        p_campaign_id: graph.campaignId,
        p_lead_id: attributedLead.leadId,
        p_enrollment_id: attributedLead.enrollmentId!,
        p_message_job_id: attributedJobId,
        p_is_positive: true,
        p_event_data: { source: 'copy-stats-outcomes' },
      },
    );
    assert.equal(repliedError, null, repliedError?.message);

    const { data, error } = await harness.supabase.rpc('account_copy_stats', {
      p_account_id: harness.env.accountId,
      p_start_date: null,
      p_end_date: null,
      p_campaign_ids: [graph.campaignId],
      p_kind: 'proof',
      p_group_by: 'archetype',
    } as never);
    assert.equal(error, null, error?.message);
    const payload = data as unknown as {
      rows: Array<{ sent: number; replied: number; positive_reply: number; wordings: unknown[] }>;
      attributed_sends: number;
      unattributed_sends: number;
    };
    assert.equal(payload.rows.length, 1);
    assert.equal(Number(payload.rows[0]?.sent), 1, 'two proof pieces must count one job');
    assert.equal(Number(payload.rows[0]?.replied), 1);
    assert.equal(Number(payload.rows[0]?.positive_reply), 1);
    assert.equal(payload.rows[0]?.wordings.length, 2);
    assert.equal(Number(payload.attributed_sends), 1);
    assert.equal(Number(payload.unattributed_sends), 1);

    const future = '2099-01-01';
    const { data: futureData, error: futureError } = await harness.supabase.rpc(
      'account_copy_stats',
      {
        p_account_id: harness.env.accountId,
        p_start_date: future,
        p_end_date: future,
        p_campaign_ids: [graph.campaignId],
        p_kind: 'proof',
        p_group_by: 'archetype',
      } as never,
    );
    assert.equal(futureError, null, futureError?.message);
    assert.deepEqual((futureData as unknown as { rows: unknown[] }).rows, []);
  } finally {
    if (cleanup.occurrenceContentIds.length > 0) {
      await harness.supabase
        .from('copy_piece_occurrences')
        .delete()
        .in('content_id', cleanup.occurrenceContentIds);
    }
    if (cleanup.renderingIds.length > 0) {
      await harness.supabase
        .from('copy_rendering_pieces')
        .delete()
        .in('rendering_id', cleanup.renderingIds);
      await harness.supabase.from('copy_renderings').delete().in('id', cleanup.renderingIds);
    }
    if (cleanup.pieceIds.length > 0) {
      await harness.supabase.from('copy_pieces').delete().in('id', cleanup.pieceIds);
    }
    if (cleanup.archetypeIds.length > 0) {
      await harness.supabase.from('copy_archetypes').delete().in('id', cleanup.archetypeIds);
    }
    await harness.cleanup();
    if (cleanup.contentIds.length > 0) {
      await harness.supabase.from('copy_contents').delete().in('id', cleanup.contentIds);
    }
  }
});
