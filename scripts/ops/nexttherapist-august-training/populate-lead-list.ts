/**
 * Populate August Training saved lead list from included_global_lead_ids.json.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/ops/nexttherapist-august-training/populate-lead-list.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/supabase/types/database.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from '../../self-recovery-env.js';

loadSelfRecoveryEnv();

type DbClient = SupabaseClient<Database>;

const ACCOUNT_ID = '8fe822e5-fccc-4799-ba5f-08232765fb73';
const LIST_ID = 'c7d09fba-c95b-469f-9a6a-935861460fa9';
const DIR = dirname(fileURLToPath(import.meta.url));
const CHUNK = 500;

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function createSupabaseClient(): Promise<DbClient> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(targetEnv);
  if (!url) throw new Error(`No Supabase URL for ${targetEnv}`);
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
  if (!resolvedKey) throw new Error('Missing Supabase service role key');
  return createClient<Database>(url, resolvedKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main(): Promise<void> {
  const ids = JSON.parse(
    readFileSync(resolve(DIR, 'included_global_lead_ids.json'), 'utf8'),
  ) as string[];

  const db = await createSupabaseClient();

  const { data: list, error: listError } = await db
    .from('lead_saved_lists')
    .select('id, name, account_id')
    .eq('id', LIST_ID)
    .eq('account_id', ACCOUNT_ID)
    .single();
  if (listError || !list) {
    throw new Error(`Saved list not found: ${listError?.message ?? LIST_ID}`);
  }

  let inserted = 0;
  const chunks = chunk(ids, CHUNK);
  for (let i = 0; i < chunks.length; i += 1) {
    const rows = chunks[i]!.map((global_lead_id) => ({
      list_id: LIST_ID,
      account_id: ACCOUNT_ID,
      global_lead_id,
      source: 'manual' as const,
    }));
    const { error } = await db.from('lead_saved_list_members').upsert(rows as never, {
      onConflict: 'list_id,global_lead_id',
      ignoreDuplicates: true,
    });
    if (error) {
      throw new Error(`Member chunk ${i + 1}/${chunks.length} failed: ${error.message}`);
    }
    inserted += rows.length;
    if ((i + 1) % 5 === 0 || i + 1 === chunks.length) {
      console.log(`Upserted chunk ${i + 1}/${chunks.length}`);
    }
  }

  const { count, error: countError } = await db
    .from('lead_saved_list_members')
    .select('global_lead_id', { count: 'exact', head: true })
    .eq('list_id', LIST_ID)
    .eq('account_id', ACCOUNT_ID);
  if (countError) throw new Error(countError.message);

  const result = {
    listId: LIST_ID,
    listName: list.name,
    planned: ids.length,
    upserted: inserted,
    memberCount: count ?? 0,
  };
  writeFileSync(resolve(DIR, 'lead_list_result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
