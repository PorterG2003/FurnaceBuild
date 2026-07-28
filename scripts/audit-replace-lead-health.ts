/**
 * Read-only health check for the replace-lead attach behaviour.
 *
 * Tracks the success metrics for "Replace Lead: attach to an existing campaign
 * contact": whether replace-lead is still minting in-campaign duplicate leads,
 * whether anyone is being double-sent, whether attach is firing at all, and
 * whether the thread/enrollment repoint stayed consistent.
 *
 * Reads only. No writes, and no metered external calls, so it is safe to run
 * against prod as often as you like.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npm run audit:replace-lead-health
 *
 *   --account-id <uuid>   audit one account (default: every account)
 *   --since <YYYY-MM-DD>  only count replacements and new rows from this date on
 *   --json                emit the raw report instead of the formatted summary
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const LOG_PREFIX = '[replace-lead-health]';

type Report = {
  since: string | null;
  duplicatePairs: number;
  duplicatePairsFromReplacement: number;
  newDuplicatePairsFromReplacement: number;
  doubleSendPairs: number;
  doubleSendPairsFromReplacement: number;
  newDoubleSendPairsFromReplacement: number;
  multiActivePairs: number;
  replacements: number;
  attachedReplacements: number;
  attachedCampaignIds: string[];
  threadsWithForeignEnrollment: number;
  campaignThreadsMissingEnrollment: number;
  resurrectedReplacedLeads: number;
};

type DialMismatch = {
  campaignId: string;
  campaignName: string;
  listEnrollmentCount: number;
  bucketTotal: number;
};

type Args = {
  accountId: string | null;
  since: string | null;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { accountId: null, since: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--account-id') args.accountId = argv[++i] ?? null;
    else if (flag === '--since') args.since = argv[++i] ?? null;
    else if (flag === '--json') args.json = true;
  }

  if (args.since && Number.isNaN(Date.parse(args.since))) {
    throw new Error(`--since must be a parseable date, got "${args.since}"`);
  }
  return args;
}

async function resolveSupabaseClient(): Promise<{ supabase: SupabaseClient; targetEnv: string }> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(targetEnv);
  const awsRegion = process.env.AWS_REGION?.trim() || process.env.CDK_DEFAULT_REGION?.trim() || 'us-west-2';

  let key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || null;
  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
  }

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Provide URL plus SSM prefix or SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return {
    targetEnv,
    supabase: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

async function fetchAccountIds(supabase: SupabaseClient, explicit: string | null): Promise<string[]> {
  if (explicit) return [explicit];
  const { data, error } = await supabase.from('accounts').select('id').order('created_at');
  if (error) throw new Error(`Failed to list accounts: ${error.message}`);
  return (data ?? []).map((row) => row.id as string);
}

async function fetchReport(
  supabase: SupabaseClient,
  accountId: string,
  since: string | null
): Promise<Report> {
  const { data, error } = await supabase.rpc('replace_lead_health_report', {
    p_account_id: accountId,
    p_since: since ? new Date(since).toISOString() : null,
  });
  if (error) throw new Error(`replace_lead_health_report failed for ${accountId}: ${error.message}`);
  return data as unknown as Report;
}

/**
 * Caveat 2 of the plan keeps the retired lead's row live precisely so these two
 * dials cannot drift. They read soft-deleted leads differently, so an attach that
 * ever soft-deleted the old lead would show up here.
 */
async function findDialMismatches(
  supabase: SupabaseClient,
  accountId: string,
  campaignIds: string[]
): Promise<DialMismatch[]> {
  if (campaignIds.length === 0) return [];

  const { data: listRows, error: listError } = await supabase.rpc('campaigns_list_summary', {
    p_account_id: accountId,
    p_search: null,
    p_statuses: null,
    p_tag_ids: null,
    p_limit: null,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });
  if (listError) throw new Error(`campaigns_list_summary failed: ${listError.message}`);

  const listByCampaignId = new Map(
    ((listRows ?? []) as any[]).map((row) => [row.id as string, row])
  );

  const mismatches: DialMismatch[] = [];
  for (const campaignId of campaignIds) {
    const listRow = listByCampaignId.get(campaignId);
    if (!listRow) continue;

    const { data: bucketRows, error: bucketError } = await supabase.rpc(
      'get_campaign_lead_progress_buckets',
      { p_campaign_id: campaignId }
    );
    if (bucketError) {
      throw new Error(`get_campaign_lead_progress_buckets failed for ${campaignId}: ${bucketError.message}`);
    }

    const bucketTotal = Number(((bucketRows ?? []) as any[])[0]?.total_leads ?? 0);
    const listEnrollmentCount = Number(listRow.enrollment_count ?? 0);
    if (bucketTotal !== listEnrollmentCount) {
      mismatches.push({
        campaignId,
        campaignName: String(listRow.name ?? campaignId),
        listEnrollmentCount,
        bucketTotal,
      });
    }
  }
  return mismatches;
}

function formatReport(accountId: string, report: Report, dialMismatches: DialMismatch[]): string[] {
  const attachRate =
    report.replacements > 0
      ? `${((report.attachedReplacements / report.replacements) * 100).toFixed(1)}%`
      : 'n/a';

  const lines = [
    `account ${accountId}`,
    `  replacements                     ${report.replacements} (${report.attachedReplacements} attached, ${attachRate})`,
    `  new duplicates from replace-lead ${report.newDuplicatePairsFromReplacement}  [target 0]`,
    `  new double-sends from replace    ${report.newDoubleSendPairsFromReplacement}  [target 0]`,
    `  multi-active duplicate pairs     ${report.multiActivePairs}  [should trend down]`,
    `  threads on a foreign enrollment  ${report.threadsWithForeignEnrollment}  [target 0]`,
    `  campaign threads w/o enrollment  ${report.campaignThreadsMissingEnrollment}  [target 0]`,
    `  resurrected replaced leads       ${report.resurrectedReplacedLeads}  [target 0]`,
    `  dial mismatches on attached      ${dialMismatches.length}  [target 0]`,
    `  legacy totals: ${report.duplicatePairs} duplicate pairs, ${report.doubleSendPairs} double-send pairs`,
  ];

  for (const mismatch of dialMismatches) {
    lines.push(
      `    ! ${mismatch.campaignName}: list ${mismatch.listEnrollmentCount} vs buckets ${mismatch.bucketTotal}`
    );
  }

  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { supabase, targetEnv } = await resolveSupabaseClient();
  const accountIds = await fetchAccountIds(supabase, args.accountId);

  if (!args.json) {
    console.log(`${LOG_PREFIX} target=${targetEnv} accounts=${accountIds.length} since=${args.since ?? 'all time'}`);
  }

  const output: Array<{ accountId: string; report: Report; dialMismatches: DialMismatch[] }> = [];
  let failures = 0;

  for (const accountId of accountIds) {
    const report = await fetchReport(supabase, accountId, args.since);
    const dialMismatches = await findDialMismatches(supabase, accountId, report.attachedCampaignIds ?? []);
    output.push({ accountId, report, dialMismatches });

    const accountFailures =
      report.newDuplicatePairsFromReplacement +
      report.newDoubleSendPairsFromReplacement +
      report.threadsWithForeignEnrollment +
      report.campaignThreadsMissingEnrollment +
      report.resurrectedReplacedLeads +
      dialMismatches.length;
    failures += accountFailures;

    if (!args.json && (report.replacements > 0 || report.duplicatePairs > 0)) {
      console.log(formatReport(accountId, report, dialMismatches).join('\n'));
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ targetEnv, since: args.since, accounts: output }, null, 2));
    return;
  }

  console.log(
    failures === 0
      ? `${LOG_PREFIX} all target-zero metrics are clean`
      : `${LOG_PREFIX} ${failures} target-zero metric(s) are non-zero — investigate above`
  );
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} failed:`, error);
  process.exitCode = 1;
});
