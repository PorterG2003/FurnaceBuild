import type { Json } from '../../../lib/supabase/types/database';
import {
  BUCKET_INSIGHTS_CAMPAIGN_NAME,
  BUCKET_INSIGHTS_EMAIL_VARIANT_ID,
  BUCKET_INSIGHTS_LEAD_COUNT,
  DEFAULT_BUCKET_INSIGHTS_CAMPAIGN_ID,
} from '../../constants/bucketInsightsSmoke';
import type { SeedModule } from '../../types';

const IMPORT_BATCH_SIZE = 200;

type LeadImportPayload = {
  email: string;
  first_name: string;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  custom_lead_data?: Record<string, string>;
};

function buildBucketInsightsFlowData(): Json {
  return {
    nodes: [
      {
        id: 'leadSource-1',
        type: 'leadSource',
        position: { x: 0, y: 0 },
        data: { label: 'Lead Bucket', isRequired: true },
      },
      {
        id: 'email-1',
        type: 'email',
        position: { x: 240, y: 0 },
        data: {
          label: 'Intro Email',
          variants: [
            {
              id: BUCKET_INSIGHTS_EMAIL_VARIANT_ID,
              label: 'Default',
              subject: 'Quick intro',
              template: '<p>Hello {{first_name}},</p>',
              isActive: true,
              order: 0,
            },
          ],
        },
      },
    ],
    edges: [{ id: 'e1', source: 'leadSource-1', target: 'email-1' }],
  } as unknown as Json;
}

function buildSchedule(): Json {
  return {
    timezone: 'UTC',
    start_hour: 0,
    start_minute: 0,
    end_hour: 23,
    end_minute: 59,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
  } as unknown as Json;
}

/**
 * Deterministic fill pattern for column coverage smoke tests.
 * See fixtures/bucket-insights-smoke/README.md for the expected counts.
 */
export function buildBucketInsightsLeadPayload(index: number): LeadImportPayload {
  const fillLastName = index % 5 !== 0;
  const fillCompany = index % 5 < 3;
  const fillWebsite = index % 5 < 2;
  const fillLinkedin = index % 5 === 0;
  const fillTerritory = index % 2 === 0;
  const fillTier = index % 10 === 0;

  const custom: Record<string, string> = {};
  if (fillTerritory) {
    custom.territory = `T-${index % 4}`;
  }
  if (fillTier) {
    custom.tier = 'gold';
  }

  return {
    email: `bucket-smoke-${String(index).padStart(5, '0')}@bucket-smoke.furnace.test`,
    first_name: 'Lead',
    last_name: fillLastName ? `Number${index}` : null,
    company_name: fillCompany ? `Company ${index % 100}` : null,
    website: fillWebsite ? `https://example.com/${index}` : null,
    linkedin_url: fillLinkedin ? `https://linkedin.com/in/lead-${index}` : null,
    custom_lead_data: Object.keys(custom).length > 0 ? custom : undefined,
  };
}

export const bucketInsightsSmokeModule: SeedModule = {
  id: 'bucketInsightsSmoke_seed',
  description: 'Seed one draft campaign with 2500 bucket leads and predictable column fill rates',
  async run(ctx) {
    const accountId = process.env.SEED_ACCOUNT_ID?.trim();
    const ownerUserId = process.env.SEED_OWNER_USER_ID?.trim();
    if (!accountId || !ownerUserId) {
      throw new Error(
        'bucket-insights-smoke requires SEED_ACCOUNT_ID and SEED_OWNER_USER_ID (existing account/users rows).',
      );
    }

    const campaignId =
      process.env.SEED_CAMPAIGN_ID?.trim() || DEFAULT_BUCKET_INSIGHTS_CAMPAIGN_ID;

    if (ctx.dryRun) {
      ctx.log(
        `[dry-run] would seed campaign=${campaignId} leads=${BUCKET_INSIGHTS_LEAD_COUNT} name=${BUCKET_INSIGHTS_CAMPAIGN_NAME}`,
      );
      return;
    }

    const { supabase } = ctx;
    const now = new Date().toISOString();
    const flowData = buildBucketInsightsFlowData();

    const { data: existing, error: selErr } = await supabase
      .from('campaigns')
      .select('id, bucket_id')
      .eq('id', campaignId)
      .maybeSingle();

    if (selErr) {
      throw new Error(`bucket-insights-smoke: campaign lookup failed: ${selErr.message}`);
    }

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from('campaigns')
        .update({
          name: BUCKET_INSIGHTS_CAMPAIGN_NAME,
          owner_id: ownerUserId,
          account_id: accountId,
          status: 'draft',
          flow_data: flowData,
          schedule: buildSchedule(),
          sending_interval_seconds: 300,
          deleted_at: null,
          updated_at: now,
        })
        .eq('id', campaignId);

      if (upErr) {
        throw new Error(`bucket-insights-smoke: campaign update failed: ${upErr.message}`);
      }
    } else {
      const { error: insErr } = await supabase.from('campaigns').insert({
        id: campaignId,
        name: BUCKET_INSIGHTS_CAMPAIGN_NAME,
        owner_id: ownerUserId,
        account_id: accountId,
        status: 'draft',
        flow_data: flowData,
        schedule: buildSchedule(),
        sending_interval_seconds: 300,
        created_at: now,
        updated_at: now,
      });

      if (insErr) {
        throw new Error(`bucket-insights-smoke: campaign insert failed: ${insErr.message}`);
      }
    }

    const { data: campaignRow, error: bucketErr } = await supabase
      .from('campaigns')
      .select('bucket_id')
      .eq('id', campaignId)
      .single();

    if (bucketErr || !campaignRow?.bucket_id) {
      throw new Error(`bucket-insights-smoke: missing bucket_id: ${bucketErr?.message}`);
    }

    const bucketId = campaignRow.bucket_id as string;

    const { error: delLeadErr } = await supabase.from('leads').delete().eq('campaign_id', campaignId);
    if (delLeadErr) {
      throw new Error(`bucket-insights-smoke: leads delete failed: ${delLeadErr.message}`);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let start = 0; start < BUCKET_INSIGHTS_LEAD_COUNT; start += IMPORT_BATCH_SIZE) {
      const batch: LeadImportPayload[] = [];
      const end = Math.min(start + IMPORT_BATCH_SIZE, BUCKET_INSIGHTS_LEAD_COUNT);
      for (let index = start; index < end; index += 1) {
        batch.push(buildBucketInsightsLeadPayload(index));
      }

      const { data, error } = await supabase.rpc('import_api_leads_to_campaign', {
        p_account_id: accountId,
        p_campaign_id: campaignId,
        p_leads: batch,
        p_options: { emit_row_webhooks: false },
      });

      if (error) {
        throw new Error(
          `bucket-insights-smoke: import batch ${start}-${end - 1} failed: ${error.message}`,
        );
      }

      const result = (data ?? {}) as {
        created?: number;
        updated?: number;
        skipped?: number;
        failed?: number;
      };
      created += Number(result.created ?? 0);
      updated += Number(result.updated ?? 0);
      skipped += Number(result.skipped ?? 0);
      failed += Number(result.failed ?? 0);
    }

    ctx.log(
      `bucket-insights-smoke campaign=${campaignId} bucket=${bucketId} import created=${created} updated=${updated} skipped=${skipped} failed=${failed}`,
    );
    ctx.log(
      `Open Flow editor → "${BUCKET_INSIGHTS_CAMPAIGN_NAME}" → Lead Bucket node to smoke pagination and coverage headers.`,
    );
  },
};
