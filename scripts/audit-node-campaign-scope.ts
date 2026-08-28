/**
 * Read-only campaign-scope audit for node references.
 *
 * Counts child rows whose campaign_id does not match the referenced node's
 * campaign_id, plus node_id values with no nodes row. Safe to run against
 * prod: no writes, no metered vendor calls.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=dev  npm run audit:node-campaign-scope
 *   SELF_RECOVERY_TARGET_ENV=prod npm run audit:node-campaign-scope
 *
 *   --json    emit the raw rows instead of the formatted table
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

const LOG_PREFIX = '[node-campaign-scope]';

const FK_TARGETS = new Set([
  'message_jobs',
  'enrollments.current_node_id',
  'campaign_node_variant_state',
]);

type AuditRow = {
  source: string;
  mismatched: number | string;
  orphaned: number | string;
};

function parseArgs(argv: string[]): { json: boolean } {
  return { json: argv.includes('--json') };
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
      'Missing Supabase configuration. Provide URL plus SSM prefix or SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return {
    targetEnv,
    supabase: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

function toCount(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

async function main(): Promise<void> {
  const { json } = parseArgs(process.argv.slice(2));
  const { supabase, targetEnv } = await resolveSupabaseClient();

  const { data, error } = await supabase.rpc('audit_node_campaign_scope');
  if (error) {
    throw new Error(`audit_node_campaign_scope failed: ${error.message}`);
  }

  const rows = (data ?? []) as AuditRow[];
  if (json) {
    console.log(JSON.stringify({ targetEnv, rows }, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} env=${targetEnv}`);
  console.log(`${LOG_PREFIX} source                           mismatched  orphaned`);
  let fkDirty = false;
  for (const row of rows) {
    const mismatched = toCount(row.mismatched);
    const orphaned = toCount(row.orphaned);
    const source = String(row.source).padEnd(32);
    console.log(`${LOG_PREFIX} ${source} ${String(mismatched).padStart(10)}  ${String(orphaned).padStart(8)}`);
    if (FK_TARGETS.has(row.source) && (mismatched > 0 || orphaned > 0)) {
      fkDirty = true;
    }
  }

  if (fkDirty) {
    console.error(
      `${LOG_PREFIX} GATE FAIL: FK targets must be 0 mismatched and 0 orphaned before composite keys.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`${LOG_PREFIX} GATE PASS: FK targets are clean.`);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
