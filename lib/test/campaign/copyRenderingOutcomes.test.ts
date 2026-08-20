import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { copyPieceFingerprint } from '../../copy/normalizeCopy';
import { upsertCopyRendering } from '../../copy/upsertCopyRendering';
import { CampaignDbHarness } from './harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
  createCampaignTestNamespace,
} from './fixtures';

function isMissingMigration(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = error?.message ?? '';
  return (
    error?.code === 'PGRST202' ||
    error?.code === '42P01' ||
    error?.code === '42703' ||
    message.includes('copy_renderings') ||
    message.includes('account_copy_stats')
  );
}

test('copy stats conserve subject branches and share body pieces', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('copy-render'),
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
      name: 'Copy Rendering Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'a',
          email: `copy-render-a-${harness.namespace}@furnace.test`,
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
          key: 'b',
          email: `copy-render-b-${harness.namespace}@furnace.test`,
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
          key: 'unstamped',
          email: `copy-render-u-${harness.namespace}@furnace.test`,
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
      ],
    });

    const { data: campaign, error: campaignError } = await harness.supabase
      .from('campaigns')
      .select('current_flow_version_number')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignError, null, campaignError?.message);
    const version = Number(campaign?.current_flow_version_number ?? 0);
    const jobA = graph.leadsByKey.get('a')!.messageJobIdsByKey.get('sent')!;
    const jobB = graph.leadsByKey.get('b')!.messageJobIdsByKey.get('sent')!;
    const jobU = graph.leadsByKey.get('unstamped')!.messageJobIdsByKey.get('sent')!;
    await harness.supabase
      .from('message_jobs')
      .update({ flow_version_number: version, variant_id: primaryVariantId } as never)
      .in('id', [jobA, jobB, jobU]);

    const { data: mapping, error: mappingError } = await harness.supabase
      .from('copy_variant_content_map')
      .select('content_id')
      .eq('campaign_id', graph.campaignId)
      .eq('flow_node_id', 'email-1')
      .eq('flow_version_number', version)
      .limit(1)
      .maybeSingle();
    if (isMissingMigration(mappingError)) {
      t.skip('copy structure analytics not applied');
      return;
    }
    assert.equal(mappingError, null, mappingError?.message);
    assert.ok(mapping, 'copy_variant_content_map row is required');
    const contentId = String((mapping as { content_id: string }).content_id);
    cleanup.contentIds.push(contentId);

    async function insertPiece(kind: 'subject' | 'hook', text: string, slug: string) {
      const { data: archetype, error: archetypeError } = await harness.supabase
        .from('copy_archetypes')
        .insert({
          account_id: harness.env.accountId,
          kind,
          slug: `${slug}-${harness.namespace}`,
          name: text,
        } as never)
        .select('id')
        .single();
      assert.equal(archetypeError, null, archetypeError?.message);
      const archetypeId = String((archetype as { id: string }).id);
      cleanup.archetypeIds.push(archetypeId);
      const { data: piece, error: pieceError } = await harness.supabase
        .from('copy_pieces')
        .insert({
          account_id: harness.env.accountId,
          kind,
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
      const { error: occurrenceError } = await harness.supabase.from('copy_piece_occurrences').insert({
        account_id: harness.env.accountId,
        content_id: contentId,
        piece_id: pieceId,
        position: cleanup.pieceIds.length,
      } as never);
      assert.equal(occurrenceError, null, occurrenceError?.message);
      return pieceId;
    }

    const subjectA = await insertPiece('subject', 'Hubspot Partners', 'hubspot-partners');
    const subjectB = await insertPiece('subject', 'thought this might help', 'thought-help');
    const hookId = await insertPiece('hook', 'Most CRM partners I talk to rely on referrals.', 'referral-hook');

    let renderingA: string;
    let renderingB: string;
    try {
      renderingA = (await upsertCopyRendering({
        db: harness.supabase,
        accountId: harness.env.accountId,
        contentId,
        renderKey: '0',
        pieceIds: [subjectA, hookId],
      }))!;
      renderingB = (await upsertCopyRendering({
        db: harness.supabase,
        accountId: harness.env.accountId,
        contentId,
        renderKey: '1',
        pieceIds: [subjectB, hookId],
      }))!;
    } catch (error) {
      if (isMissingMigration(error as { message?: string })) {
        t.skip('copy_renderings not applied');
        return;
      }
      throw error;
    }
    assert.ok(renderingA && renderingB);
    cleanup.renderingIds.push(renderingA, renderingB);
    const reused = await upsertCopyRendering({
      db: harness.supabase,
      accountId: harness.env.accountId,
      contentId,
      renderKey: '0',
      pieceIds: [subjectA, hookId],
    });
    assert.equal(reused, renderingA, 'same seed/content must reuse rendering_id');

    const { error: stampA } = await harness.supabase
      .from('message_jobs')
      .update({ copy_rendering_id: renderingA } as never)
      .eq('id', jobA);
    const { error: stampB } = await harness.supabase
      .from('message_jobs')
      .update({ copy_rendering_id: renderingB } as never)
      .eq('id', jobB);
    if (isMissingMigration(stampA) || isMissingMigration(stampB)) {
      t.skip('copy_rendering_id column not applied');
      return;
    }
    assert.equal(stampA, null, stampA?.message);
    assert.equal(stampB, null, stampB?.message);

    for (const leadKey of ['a', 'b', 'unstamped'] as const) {
      const lead = graph.leadsByKey.get(leadKey)!;
      const { error } = await harness.supabase.rpc('record_sent_event_and_increment', {
        p_campaign_id: graph.campaignId,
        p_lead_id: lead.leadId,
        p_enrollment_id: lead.enrollmentId!,
        p_message_job_id: lead.messageJobIdsByKey.get('sent')!,
        p_event_data: { source: 'copy-rendering-outcomes' },
      });
      assert.equal(error, null, error?.message);
    }

    const { data, error } = await harness.supabase.rpc('account_copy_stats', {
      p_account_id: harness.env.accountId,
      p_start_date: null,
      p_end_date: null,
      p_campaign_ids: [graph.campaignId],
      p_kind: null,
      p_group_by: 'piece',
    } as never);
    assert.equal(error, null, error?.message);
    const payload = data as unknown as {
      rows: Array<{ kind: string; name: string; sent: number }>;
      attributed_sends: number;
      unattributed_sends: number;
    };
    const subjects = payload.rows.filter((row) => row.kind === 'subject');
    const hooks = payload.rows.filter((row) => row.kind === 'hook');
    assert.equal(subjects.length, 2);
    const subjectSent = subjects.map((row) => Number(row.sent)).sort((a, b) => a - b);
    assert.deepEqual(subjectSent, [1, 1], 'subject sent values must sum to 2, not 2 and 2');
    assert.equal(Number(hooks[0]?.sent), 2);
    assert.equal(Number(payload.attributed_sends), 2);
    assert.equal(Number(payload.unattributed_sends), 1);
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

test('unbranched render_key is still attributed', async (t) => {
  const harness = new CampaignDbHarness({
    namespace: createCampaignTestNamespace('copy-unbranched'),
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
      name: 'Copy Unbranched Outcomes',
      status: 'running',
      flowKind: 'emailOnly',
      leads: [
        buildCampaignLead({
          key: 'sent',
          email: `copy-unbranched-${harness.namespace}@furnace.test`,
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
      ],
    });

    const { data: campaign, error: campaignError } = await harness.supabase
      .from('campaigns')
      .select('current_flow_version_number')
      .eq('id', graph.campaignId)
      .single();
    assert.equal(campaignError, null, campaignError?.message);
    const version = Number(campaign?.current_flow_version_number ?? 0);
    const jobId = graph.leadsByKey.get('sent')!.messageJobIdsByKey.get('sent')!;
    await harness.supabase
      .from('message_jobs')
      .update({ flow_version_number: version, variant_id: primaryVariantId } as never)
      .eq('id', jobId);

    const { data: mapping, error: mappingError } = await harness.supabase
      .from('copy_variant_content_map')
      .select('content_id')
      .eq('campaign_id', graph.campaignId)
      .eq('flow_node_id', 'email-1')
      .eq('flow_version_number', version)
      .limit(1)
      .maybeSingle();
    if (isMissingMigration(mappingError)) {
      t.skip('copy structure analytics not applied');
      return;
    }
    assert.equal(mappingError, null, mappingError?.message);
    assert.ok(mapping, 'copy_variant_content_map row is required');
    const contentId = String((mapping as { content_id: string }).content_id);
    cleanup.contentIds.push(contentId);

    const subjectText = 'Quick question for {{first_name}}';
    const hookText = 'I noticed you are hiring.';
    for (const [kind, text, slug] of [
      ['subject', subjectText, 'unbranched-subject'],
      ['hook', hookText, 'unbranched-hook'],
    ] as const) {
      const { data: archetype, error: archetypeError } = await harness.supabase
        .from('copy_archetypes')
        .insert({
          account_id: harness.env.accountId,
          kind,
          slug: `${slug}-${harness.namespace}`,
          name: text,
        } as never)
        .select('id')
        .single();
      assert.equal(archetypeError, null, archetypeError?.message);
      const archetypeId = String((archetype as { id: string }).id);
      cleanup.archetypeIds.push(archetypeId);
      const { data: piece, error: pieceError } = await harness.supabase
        .from('copy_pieces')
        .insert({
          account_id: harness.env.accountId,
          kind,
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
      const { error: occurrenceError } = await harness.supabase.from('copy_piece_occurrences').insert({
        account_id: harness.env.accountId,
        content_id: contentId,
        piece_id: pieceId,
        position: cleanup.pieceIds.length,
      } as never);
      assert.equal(occurrenceError, null, occurrenceError?.message);
    }

    let renderingId: string;
    try {
      renderingId = (await upsertCopyRendering({
        db: harness.supabase,
        accountId: harness.env.accountId,
        contentId,
        renderKey: '',
        pieceIds: cleanup.pieceIds,
      }))!;
    } catch (error) {
      if (isMissingMigration(error as { message?: string })) {
        t.skip('copy_renderings not applied');
        return;
      }
      throw error;
    }
    assert.ok(renderingId);
    cleanup.renderingIds.push(renderingId);
    const { error: stampError } = await harness.supabase
      .from('message_jobs')
      .update({ copy_rendering_id: renderingId } as never)
      .eq('id', jobId);
    if (isMissingMigration(stampError)) {
      t.skip('copy_rendering_id column not applied');
      return;
    }
    assert.equal(stampError, null, stampError?.message);

    const lead = graph.leadsByKey.get('sent')!;
    const { error: sentError } = await harness.supabase.rpc('record_sent_event_and_increment', {
      p_campaign_id: graph.campaignId,
      p_lead_id: lead.leadId,
      p_enrollment_id: lead.enrollmentId!,
      p_message_job_id: jobId,
      p_event_data: { source: 'copy-unbranched-outcomes' },
    });
    assert.equal(sentError, null, sentError?.message);

    const { data, error } = await harness.supabase.rpc('account_copy_stats', {
      p_account_id: harness.env.accountId,
      p_start_date: null,
      p_end_date: null,
      p_campaign_ids: [graph.campaignId],
      p_kind: null,
      p_group_by: 'piece',
    } as never);
    assert.equal(error, null, error?.message);
    const payload = data as unknown as {
      rows: Array<{ kind: string; name: string; sent: number }>;
      attributed_sends: number;
      unattributed_sends: number;
    };
    assert.equal(Number(payload.attributed_sends), 1);
    assert.equal(Number(payload.unattributed_sends), 0);
    assert.equal(Number(payload.rows.find((row) => row.kind === 'subject')?.sent), 1);
    assert.equal(Number(payload.rows.find((row) => row.kind === 'hook')?.sent), 1);
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
