/**
 * Duplicate a Smartlead-imported campaign into a native Furnace draft campaign,
 * copying only leads that are still STARTED (yet to contact) in Smartlead.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/duplicate-smartlead-campaign-uncontacted.ts \
 *     --source-campaign-id 7ac6b6d8-44db-4a9a-ae5e-da2d114e6936
 *
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/duplicate-smartlead-campaign-uncontacted.ts \
 *     --smartlead-campaign-id 3509819 \
 *     --name "Thinking Maps - School Leadership (Summer) - Resume"
 *
 *   --dry-run   preview counts without creating a campaign
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/supabase/types/database.js';
import { duplicateCampaignWithClient } from '../lib/supabase/services/campaigns/duplicate-campaign-with-client.js';
import { fetchSmartleadLeads } from '../lib/smartlead/migration.js';
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
  sourceCampaignId: string | null;
  smartleadCampaignId: number | null;
  name: string | null;
  dryRun: boolean;
  smartleadApiKeyParam: string | null;
};

function parseArgs(argv: string[]): Args {
  let sourceCampaignId: string | null = null;
  let smartleadCampaignId: number | null = null;
  let name: string | null = null;
  let dryRun = false;
  let smartleadApiKeyParam: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source-campaign-id' && argv[i + 1]) {
      sourceCampaignId = argv[++i]!;
    } else if (arg === '--smartlead-campaign-id' && argv[i + 1]) {
      smartleadCampaignId = Number.parseInt(argv[++i]!, 10);
    } else if (arg === '--name' && argv[i + 1]) {
      name = argv[++i]!;
    } else if (arg === '--smartlead-api-key-param' && argv[i + 1]) {
      smartleadApiKeyParam = argv[++i]!;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { sourceCampaignId, smartleadCampaignId, name, dryRun, smartleadApiKeyParam };
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

async function resolveSmartleadApiKey(explicitParam: string | null): Promise<string> {
  if (process.env.SMARTLEAD_API_KEY?.trim()) {
    return process.env.SMARTLEAD_API_KEY.trim();
  }
  if (explicitParam?.trim()) {
    const region =
      process.env.AWS_REGION?.trim() ||
      process.env.CDK_DEFAULT_REGION?.trim() ||
      'us-west-2';
    return fetchSecretFromParameterStore(explicitParam.trim(), region);
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
    throw new Error('Could not resolve Smartlead API key from env or latest migration run.');
  }

  const region =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';
  return fetchSecretFromParameterStore(data.api_key_secret_ref, region);
}

async function loadSourceCampaign(
  db: DbClient,
  args: Args,
): Promise<{
  id: string;
  name: string;
  owner_id: string | null;
  account_id: string | null;
  smartlead_campaign_id: number | null;
}> {
  if (args.sourceCampaignId) {
    const { data, error } = await db
      .from('campaigns')
      .select('id, name, owner_id, account_id, smartlead_campaign_id, source, deleted_at')
      .eq('id', args.sourceCampaignId)
      .single();
    if (error || !data || data.deleted_at) {
      throw new Error(`Source campaign not found: ${args.sourceCampaignId}`);
    }
    if (data.source !== 'smartlead' || data.smartlead_campaign_id == null) {
      throw new Error('Source campaign is not a Smartlead import.');
    }
    return data;
  }

  if (args.smartleadCampaignId == null || !Number.isFinite(args.smartleadCampaignId)) {
    throw new Error('Provide --source-campaign-id or --smartlead-campaign-id.');
  }

  const { data, error } = await db
    .from('campaigns')
    .select('id, name, owner_id, account_id, smartlead_campaign_id, source, deleted_at')
    .eq('smartlead_campaign_id', args.smartleadCampaignId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`No Smartlead campaign found for id ${args.smartleadCampaignId}.`);
  }
  return data;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = await createSupabaseClient();
  const sourceCampaign = await loadSourceCampaign(db, args);

  if (!sourceCampaign.account_id || !sourceCampaign.owner_id) {
    throw new Error('Source campaign is missing account_id or owner_id.');
  }
  if (sourceCampaign.smartlead_campaign_id == null) {
    throw new Error('Source campaign is missing smartlead_campaign_id.');
  }

  const smartleadApiKey = await resolveSmartleadApiKey(args.smartleadApiKeyParam);
  const startedLeads = await fetchSmartleadLeads(
    smartleadApiKey,
    sourceCampaign.smartlead_campaign_id,
    { status: 'STARTED' },
  );
  const startedSmartleadLeadIds = startedLeads.map((lead) => lead.id).filter((id) => Number.isFinite(id) && id > 0);

  const { data: furnaceLeads, error: furnaceLeadsError } = await db
    .from('leads')
    .select('id, smartlead_lead_id, email')
    .eq('campaign_id', sourceCampaign.id)
    .in('smartlead_lead_id', startedSmartleadLeadIds)
    .is('deleted_at', null);

  if (furnaceLeadsError) {
    throw new Error(`Failed to match Furnace leads: ${furnaceLeadsError.message}`);
  }

  const sourceLeadIds = (furnaceLeads ?? []).map((row) => row.id);
  const duplicateName = args.name?.trim() || `${sourceCampaign.name} - Resume`;

  console.log(
    JSON.stringify(
      {
        sourceCampaignId: sourceCampaign.id,
        sourceCampaignName: sourceCampaign.name,
        smartleadCampaignId: sourceCampaign.smartlead_campaign_id,
        smartleadStartedCount: startedSmartleadLeadIds.length,
        matchedFurnaceLeadCount: sourceLeadIds.length,
        duplicateName,
        dryRun: args.dryRun,
      },
      null,
      2,
    ),
  );

  if (sourceLeadIds.length === 0) {
    throw new Error('No Furnace leads matched Smartlead STARTED leads.');
  }

  if (sourceLeadIds.length !== startedSmartleadLeadIds.length) {
    console.warn(
      `[duplicate-smartlead-campaign-uncontacted] matched ${sourceLeadIds.length}/${startedSmartleadLeadIds.length} Smartlead STARTED leads in Furnace`,
    );
  }

  if (args.dryRun) {
    return;
  }

  const duplicatedCampaign = await duplicateCampaignWithClient(db, sourceCampaign.id, {
    name: duplicateName,
    ownerId: sourceCampaign.owner_id,
    accountId: sourceCampaign.account_id,
    copySettings: true,
    copyLeads: true,
    allowSmartleadSource: true,
    sourceLeadIds,
  });

  const { count, error: leadCountError } = await db
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', duplicatedCampaign.id)
    .is('deleted_at', null);

  if (leadCountError) {
    throw new Error(`Duplicated campaign created but lead count failed: ${leadCountError.message}`);
  }

  console.log(
    JSON.stringify(
      {
        duplicatedCampaignId: duplicatedCampaign.id,
        duplicatedCampaignName: duplicatedCampaign.name,
        duplicatedCampaignStatus: duplicatedCampaign.status,
        leadCount: count ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[duplicate-smartlead-campaign-uncontacted]', error instanceof Error ? error.message : error);
  process.exit(1);
});
