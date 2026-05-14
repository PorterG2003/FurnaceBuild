import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';
  const reservedStaleMinutes = Number(process.env.SELF_RECOVERY_RESERVED_STALE_MINUTES ?? '5');
  const sendingStaleMinutes = Number(process.env.SELF_RECOVERY_SENDING_STALE_MINUTES ?? '30');

  let key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
    process.env.SUPABASE_SECRET_KEY = key;
  }

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.',
    );
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('get_job_self_recovery_health', {
    p_reserved_stale_minutes: reservedStaleMinutes,
    p_sending_stale_minutes: sendingStaleMinutes,
  });

  if (error) {
    throw new Error(`Failed to load self-recovery health: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    console.log('No self-recovery health row returned.');
    return;
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  if (secretParamPath) {
    console.log(`Resolved SUPABASE secret from Parameter Store path ${secretParamPath}.`);
  } else {
    console.log('Resolved SUPABASE secret from environment variable.');
  }
  console.log('Self-Recovery Health');
  console.log(`- retryable_stopped_count: ${row.retryable_stopped_count ?? 0}`);
  console.log(`- stale_reserved_count: ${row.stale_reserved_count ?? 0}`);
  console.log(`- stale_sending_count: ${row.stale_sending_count ?? 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
