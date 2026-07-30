/**
 * Copy Smartlead sequence/settings onto a native resume campaign, assign mailboxes, and launch.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/setup-smartlead-resume-campaign.ts \
 *     --campaign-id 21cb7033-ae3d-41c4-8078-5cc261ea977f \
 *     --smartlead-campaign-id 3509819 \
 *     --launch
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildLaunchState } from '../lib/client-api/campaign-document.js';
import { prepareFlowSave } from '../lib/campaigns/flow/prepareFlowSave.js';
import type { CampaignFlowData } from '../lib/campaigns/flow/types.js';
import { canonicalizeEmailContentForSave } from '../lib/email/emailHtmlMode.js';
import { normalizeStoredEmailSubject } from '../lib/email/followUpSubject.js';
import { labelForVariantIndex } from '../lib/email/emailNodeVariants.js';
import { SMARTLEAD_BASE, smartleadRequest } from '../lib/smartlead/api.js';
import type { Database } from '../lib/supabase/types/database.js';
import { updateCampaignFlowDataWithClient } from '../lib/supabase/services/campaigns/update-campaign-flow-with-client.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type DbClient = SupabaseClient<Database>;

type Args = {
  campaignId: string | null;
  smartleadCampaignId: number | null;
  launch: boolean;
  dryRun: boolean;
};

type SmartleadSequenceRow = {
  seq_number?: number | string;
  seq_delay_details?: { delayInDays?: number };
  subject?: string;
  email_body?: string;
  sequence_variants?: Array<{
    is_deleted?: boolean;
    variant_label?: string;
    subject?: string;
    email_body?: string;
  }> | null;
};

type SmartleadCampaignMeta = {
  scheduler_cron_value?: {
    tz?: string;
    days?: number[];
    startHour?: string;
    endHour?: string;
  };
  min_time_btwn_emails?: number;
};

function parseArgs(argv: string[]): Args {
  let campaignId: string | null = null;
  let smartleadCampaignId: number | null = null;
  let launch = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--campaign-id' && argv[i + 1]) campaignId = argv[++i]!;
    else if (arg === '--smartlead-campaign-id' && argv[i + 1]) {
      smartleadCampaignId = Number.parseInt(argv[++i]!, 10);
    } else if (arg === '--launch') launch = true;
    else if (arg === '--dry-run') dryRun = true;
  }

  return { campaignId, smartleadCampaignId, launch, dryRun };
}

async function createSupabaseClient(): Promise<DbClient> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(targetEnv);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let resolvedKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    resolvedKey = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
  }

  if (!url || !resolvedKey) {
    throw new Error('Missing Supabase URL or service role key.');
  }

  return createClient(url, resolvedKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveSmartleadApiKey(): Promise<string> {
  if (process.env.SMARTLEAD_API_KEY?.trim()) {
    return process.env.SMARTLEAD_API_KEY.trim();
  }

  const db = await createSupabaseClient();
  const { data, error } = await db
    .from('smartlead_migration_runs')
    .select('api_key_secret_ref')
    .not('api_key_secret_ref', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.api_key_secret_ref) {
    throw new Error('Could not resolve Smartlead API key.');
  }

  const region =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';
  return fetchSecretFromParameterStore(data.api_key_secret_ref, region);
}

function parseHour(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const [hourPart] = value.split(':');
  const parsed = Number.parseInt(hourPart ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildScheduleFromSmartlead(meta: SmartleadCampaignMeta) {
  const cron = meta.scheduler_cron_value ?? {};
  return {
    timezone: cron.tz?.trim() || 'America/Denver',
    start_hour: parseHour(cron.startHour, 9),
    start_minute: 0,
    end_hour: parseHour(cron.endHour, 18),
    end_minute: 0,
    days_of_week: Array.isArray(cron.days) && cron.days.length > 0 ? cron.days : [1, 2, 3, 4, 5],
  };
}

function canonicalizeVariantContent(subject: string, htmlBody: string) {
  const canonical = canonicalizeEmailContentForSave({
    editorMode: 'html',
    bodyHtml: htmlBody,
  });
  return {
    subject: normalizeStoredEmailSubject(subject),
    template: canonical.template,
    body_html: canonical.bodyHtml,
    body_text: canonical.bodyText,
    editor_mode: 'html' as const,
  };
}

function buildFlowFromSmartleadSequences(
  sequences: SmartleadSequenceRow[],
  bucketId: string,
): CampaignFlowData {
  const sorted = [...sequences].sort((a, b) => {
    const aNum = typeof a.seq_number === 'number' ? a.seq_number : Number(a.seq_number ?? 0);
    const bNum = typeof b.seq_number === 'number' ? b.seq_number : Number(b.seq_number ?? 0);
    return aNum - bNum;
  });

  const nodes: CampaignFlowData['nodes'] = [
    {
      id: 'leadSource-1',
      type: 'leadSource',
      position: { x: 0, y: 0 },
      data: {
        label: 'Lead Bucket',
        bucketId,
        isRequired: true,
        mappedStandardFieldKeys: ['email', 'first_name', 'last_name', 'company_name'],
      },
      deletable: false,
    },
  ];
  const edges: CampaignFlowData['edges'] = [];

  let x = 220;
  let previousNodeId = 'leadSource-1';

  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]!;
    const seqNumber =
      typeof row.seq_number === 'number'
        ? row.seq_number
        : Number.parseInt(String(row.seq_number ?? index + 1), 10);
    const delayDays = row.seq_delay_details?.delayInDays ?? 0;

    if (delayDays > 0) {
      const waitId = `waitTime-${seqNumber}`;
      nodes.push({
        id: waitId,
        type: 'waitTime',
        position: { x, y: 0 },
        data: {
          label: `Wait ${delayDays} day${delayDays === 1 ? '' : 's'}`,
          duration: String(delayDays),
          unit: 'days',
          wait_duration_seconds: delayDays * 86400,
        },
      });
      edges.push({
        id: `edge-${previousNodeId}-${waitId}`,
        source: previousNodeId,
        target: waitId,
      });
      previousNodeId = waitId;
      x += 240;
    }

    const emailId = `email-${seqNumber}`;
    const variants = Array.isArray(row.sequence_variants)
      ? row.sequence_variants.filter((variant) => variant?.is_deleted !== true)
      : [];

    const emailVariants =
      variants.length > 0
        ? variants.map((variant, variantIndex) => {
            const content = canonicalizeVariantContent(
              variant.subject ?? row.subject ?? '',
              variant.email_body ?? row.email_body ?? '',
            );
            return {
              id: randomUUID(),
              label: variant.variant_label?.trim() || labelForVariantIndex(variantIndex),
              subject: content.subject,
              template: content.template,
              body_html: content.body_html,
              body_text: content.body_text,
              editor_mode: content.editor_mode,
              isActive: true,
              order: variantIndex,
            };
          })
        : [
            (() => {
              const content = canonicalizeVariantContent(row.subject ?? '', row.email_body ?? '');
              return {
                id: randomUUID(),
                label: 'A',
                subject: content.subject,
                template: content.template,
                body_html: content.body_html,
                body_text: content.body_text,
                editor_mode: content.editor_mode,
                isActive: true,
                order: 0,
              };
            })(),
          ];

    nodes.push({
      id: emailId,
      type: 'email',
      position: { x, y: 0 },
      data: {
        label: `Email ${seqNumber}`,
        priority: false,
        variants: emailVariants,
      },
    });
    edges.push({
      id: `edge-${previousNodeId}-${emailId}`,
      source: previousNodeId,
      target: emailId,
    });
    previousNodeId = emailId;
    x += 240;
  }

  return { nodes, edges };
}

async function fetchSmartleadSequences(apiKey: string, smartleadCampaignId: number) {
  const url =
    `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/sequences` +
    `?api_key=${encodeURIComponent(apiKey)}`;
  const res = await smartleadRequest({ url });
  if (!res.ok) {
    throw new Error(`Smartlead sequences API failed (${res.status}).`);
  }
  const raw = await res.json();
  return (Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : []) as SmartleadSequenceRow[];
}

async function fetchSmartleadCampaignMeta(apiKey: string, smartleadCampaignId: number) {
  const url =
    `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}` +
    `?api_key=${encodeURIComponent(apiKey)}`;
  const res = await smartleadRequest({ url });
  if (!res.ok) {
    throw new Error(`Smartlead campaign API failed (${res.status}).`);
  }
  return (await res.json()) as SmartleadCampaignMeta;
}

async function ensureCampaignEnrollments(
  db: DbClient,
  campaignId: string,
  accountId: string,
  leadIds: string[],
): Promise<void> {
  if (!leadIds.length) return;
  const rows = leadIds.map((leadId) => ({
    campaign_id: campaignId,
    account_id: accountId,
    lead_id: leadId,
    current_node_id: null,
    state: 'active' as const,
    next_run_at: new Date().toISOString(),
    flow_position: {},
    deleted_at: null,
  }));

  const { error } = await db.from('enrollments').upsert(rows as never, {
    onConflict: 'campaign_id,lead_id',
    ignoreDuplicates: true,
  });
  if (error) {
    throw new Error(`Failed to ensure enrollments: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.campaignId || args.smartleadCampaignId == null || !Number.isFinite(args.smartleadCampaignId)) {
    throw new Error('Provide --campaign-id and --smartlead-campaign-id.');
  }

  const db = await createSupabaseClient();
  const apiKey = await resolveSmartleadApiKey();

  const { data: campaign, error: campaignError } = await db
    .from('campaigns')
    .select('id, name, status, account_id, bucket_id, flow_data, schedule, sending_interval_seconds')
    .eq('id', args.campaignId)
    .is('deleted_at', null)
    .single();

  if (campaignError || !campaign?.account_id || !campaign.bucket_id) {
    throw new Error(`Campaign not found or missing account/bucket: ${campaignError?.message ?? 'unknown'}`);
  }
  if (campaign.status !== 'draft') {
    throw new Error(`Campaign must be draft (current status: ${campaign.status}).`);
  }

  const [sequences, meta] = await Promise.all([
    fetchSmartleadSequences(apiKey, args.smartleadCampaignId),
    fetchSmartleadCampaignMeta(apiKey, args.smartleadCampaignId),
  ]);

  if (sequences.length === 0) {
    throw new Error('Smartlead returned no sequences.');
  }

  const flow = buildFlowFromSmartleadSequences(sequences, campaign.bucket_id);
  const schedule = buildScheduleFromSmartlead(meta);
  const sendingIntervalSeconds = Math.max(60, (meta.min_time_btwn_emails ?? 5) * 60);

  const { data: mailboxes, error: mailboxError } = await db
    .from('mailboxes')
    .select('id, email_address, status')
    .eq('account_id', campaign.account_id)
    .is('deleted_at', null)
    .eq('status', 'connected')
    .order('email_address', { ascending: true });

  if (mailboxError) {
    throw new Error(`Failed to load mailboxes: ${mailboxError.message}`);
  }
  const mailboxIds = (mailboxes ?? []).map((row) => row.id);

  const { count: leadCount, error: leadCountError } = await db
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .is('deleted_at', null);
  if (leadCountError) {
    throw new Error(`Failed to count leads: ${leadCountError.message}`);
  }

  const prepared = await prepareFlowSave({
    incomingFlow: flow,
    existingFlow: campaign.flow_data ?? { nodes: [], edges: [] },
    campaignStatus: 'draft',
    phase: 'launch',
  });

  const previewLaunchState = buildLaunchState(
    { ...campaign, flow_data: prepared.flow as never },
    { mailboxCount: mailboxIds.length, leadCount: leadCount ?? 0 },
  );

  console.log(
    JSON.stringify(
      {
        campaignId: campaign.id,
        campaignName: campaign.name,
        smartleadCampaignId: args.smartleadCampaignId,
        sequenceCount: sequences.length,
        flowNodes: prepared.flow.nodes.length,
        flowEdges: prepared.flow.edges.length,
        mailboxIds,
        mailboxEmails: (mailboxes ?? []).map((row) => row.email_address),
        leadCount: leadCount ?? 0,
        schedule,
        sendingIntervalSeconds,
        launchReady: previewLaunchState.ready,
        blockingIssues: previewLaunchState.blocking_issues,
        warnings: previewLaunchState.warnings,
        dryRun: args.dryRun,
        launch: args.launch,
      },
      null,
      2,
    ),
  );

  if (args.dryRun) {
    return;
  }

  if (mailboxIds.length === 0) {
    throw new Error('No connected mailboxes available on this account.');
  }

  await updateCampaignFlowDataWithClient(db, {
    campaignId: campaign.id,
    accountId: campaign.account_id,
    flowData: prepared.flow as never,
    changeSource: 'smartlead_resume_setup',
  });

  const { error: settingsError } = await db
    .from('campaigns')
    .update({
      schedule,
      sending_interval_seconds: sendingIntervalSeconds,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', campaign.id)
    .eq('account_id', campaign.account_id)
    .is('deleted_at', null);
  if (settingsError) {
    throw new Error(`Failed to update campaign settings: ${settingsError.message}`);
  }

  const { error: deleteMailboxError } = await db
    .from('campaign_mailboxes')
    .delete()
    .eq('campaign_id', campaign.id);
  if (deleteMailboxError) {
    throw new Error(`Failed to reset campaign mailboxes: ${deleteMailboxError.message}`);
  }

  const { error: insertMailboxError } = await db.from('campaign_mailboxes').insert(
    mailboxIds.map((mailboxId) => ({
      campaign_id: campaign.id,
      mailbox_id: mailboxId,
      account_id: campaign.account_id,
    })) as never,
  );
  if (insertMailboxError) {
    throw new Error(`Failed to assign campaign mailboxes: ${insertMailboxError.message}`);
  }

  if (!args.launch) {
    console.log(JSON.stringify({ status: 'configured_not_launched' }, null, 2));
    return;
  }

  if (!previewLaunchState.ready) {
    throw new Error(`Campaign not launch-ready: ${JSON.stringify(previewLaunchState.blocking_issues)}`);
  }

  const { data: leadRows, error: leadRowsError } = await db
    .from('leads')
    .select('id')
    .eq('campaign_id', campaign.id)
    .is('deleted_at', null);
  if (leadRowsError) {
    throw new Error(`Failed to load leads for launch: ${leadRowsError.message}`);
  }

  const leadIds = (leadRows ?? []).map((row) => row.id);
  await ensureCampaignEnrollments(db, campaign.id, campaign.account_id, leadIds);

  const { error: launchError } = await db
    .from('campaigns')
    .update({
      status: 'running',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', campaign.id)
    .eq('account_id', campaign.account_id)
    .is('deleted_at', null);
  if (launchError) {
    throw new Error(`Failed to launch campaign: ${launchError.message}`);
  }

  console.log(
    JSON.stringify(
      {
        status: 'running',
        campaignId: campaign.id,
        enrolled: leadIds.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[setup-smartlead-resume-campaign]', error instanceof Error ? error.message : error);
  process.exit(1);
});
