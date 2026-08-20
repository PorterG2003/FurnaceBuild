import type { SeedModule } from '../../types';
import { materializeCampaignGraph } from '../../../../lib/test/campaign/harness';
import {
  buildCampaignEnrollment,
  buildCampaignJob,
  buildCampaignLead,
} from '../../../../lib/test/campaign/fixtures';
import { copyPieceFingerprint } from '../../../../lib/copy/normalizeCopy';

const CAMPAIGN_ID = 'f0000000-0000-4000-8000-00000000ca71';
const VARIANT_ID = 'f0000000-0000-4000-8000-00000000ea11';
const LEAD_COUNT = 120;

export const copyStructureMetricsModule: SeedModule = {
  id: 'copyStructureMetrics_seed',
  description: 'Seed 120 attributed sends and grouped proof copy for metrics QA',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'copy-structure-metrics requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID.',
      );
    }
    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would seed campaign=${CAMPAIGN_ID} sends=${LEAD_COUNT} positive=12`,
      );
      return;
    }

    const graph = await materializeCampaignGraph({
      supabase: ctx.supabase as never,
      accountId,
      ownerUserId,
      resetExistingCampaignSlice: true,
      spec: {
        namespace: 'copy-structure-metrics',
        campaignId: CAMPAIGN_ID,
        name: 'Copy Structure Metrics QA',
        status: 'running',
        flowKind: 'emailOnly',
        leads: Array.from({ length: LEAD_COUNT }, (_, index) =>
          buildCampaignLead({
            key: `lead-${index}`,
            email: `copy-metrics-${index}@furnace.test`,
            firstName: `Lead${index}`,
            companyName: `Example ${index}`,
            enrollment: buildCampaignEnrollment({ state: 'active' }),
            jobs: [
              buildCampaignJob({
                key: 'sent',
                nodeFlowNodeId: 'email-1',
                status: 'sent',
                messageType: 'campaign',
                variantId: VARIANT_ID,
              }),
            ],
          }),
        ),
      },
    });

    const { data: campaign, error: campaignError } = await ctx.supabase
      .from('campaigns')
      .select('current_flow_version_number')
      .eq('id', graph.campaignId)
      .single();
    if (campaignError) throw campaignError;
    const flowVersion = Number(campaign?.current_flow_version_number ?? 0);
    if (flowVersion <= 0) throw new Error('Seed campaign has no flow version');

    const jobIds = [...graph.leadsByKey.values()]
      .map((lead) => lead.messageJobIdsByKey.get('sent'))
      .filter((id): id is string => !!id);
    const { error: versionError } = await ctx.supabase
      .from('message_jobs')
      .update({ flow_version_number: flowVersion })
      .in('id', jobIds);
    if (versionError) throw versionError;

    const { data: mapping, error: mappingError } = await ctx.supabase
      .from('copy_variant_content_map')
      .select('content_id')
      .eq('campaign_id', graph.campaignId)
      .eq('flow_node_id', 'email-1')
      .eq('flow_version_number', flowVersion)
      .eq('variant_id', VARIANT_ID)
      .single();
    if (mappingError) {
      throw new Error(
        `Apply copy_structure_analytics before this seed: ${mappingError.message}`,
      );
    }
    const contentId = String(mapping.content_id);

    const { data: archetype, error: archetypeError } = await ctx.supabase
      .from('copy_archetypes')
      .upsert(
        {
          account_id: accountId,
          kind: 'proof',
          slug: 'quantified-time-saving',
          name: 'Quantified time saving',
          description: 'Uses a specific measured result as proof.',
        },
        { onConflict: 'account_id,kind,slug' },
      )
      .select('id')
      .single();
    if (archetypeError) throw archetypeError;

    const proofTexts = [
      'Saved 18 hours per rep.',
      'Cut ramp time by 42%.',
    ];
    for (let position = 0; position < proofTexts.length; position += 1) {
      const rawText = proofTexts[position]!;
      const { data: piece, error: pieceError } = await ctx.supabase
        .from('copy_pieces')
        .upsert(
          {
            account_id: accountId,
            kind: 'proof',
            fingerprint: await copyPieceFingerprint(rawText),
            raw_text: rawText,
            display_text: rawText,
            archetype_id: archetype.id,
          },
          { onConflict: 'account_id,kind,fingerprint' },
        )
        .select('id')
        .single();
      if (pieceError) throw pieceError;
      const { error: occurrenceError } = await ctx.supabase
        .from('copy_piece_occurrences')
        .upsert(
          {
            account_id: accountId,
            content_id: contentId,
            piece_id: piece.id,
            position,
          },
          { onConflict: 'content_id,piece_id,position' },
        );
      if (occurrenceError) throw occurrenceError;
    }

    for (let index = 0; index < LEAD_COUNT; index += 1) {
      const lead = graph.leadsByKey.get(`lead-${index}`)!;
      const jobId = lead.messageJobIdsByKey.get('sent')!;
      const { error: sentError } = await ctx.supabase.rpc(
        'record_sent_event_and_increment',
        {
          p_campaign_id: graph.campaignId,
          p_lead_id: lead.leadId,
          p_enrollment_id: lead.enrollmentId!,
          p_message_job_id: jobId,
          p_event_data: { source: 'seed:copy-structure-metrics' },
        },
      );
      if (sentError) throw sentError;
      if (index < 12) {
        const { error: replyError } = await ctx.supabase.rpc(
          'record_replied_event_and_increment',
          {
            p_campaign_id: graph.campaignId,
            p_lead_id: lead.leadId,
            p_enrollment_id: lead.enrollmentId!,
            p_message_job_id: jobId,
            p_is_positive: true,
            p_event_data: { source: 'seed:copy-structure-metrics' },
          },
        );
        if (replyError) throw replyError;
      }
    }

    ctx.log(
      `seeded copy metrics campaign=${graph.campaignId} sends=${LEAD_COUNT} positive=12`,
    );
  },
};
