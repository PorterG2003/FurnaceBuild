#!/usr/bin/env npx tsx
/**
 * Compare account_lead_people rollup counts to live distinct global_lead_id counts.
 *
 * Usage:
 *   npx tsx scripts/reconcile-account-lead-people.ts --account-id=<uuid>
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parseAccountIdArg(): string | null {
  const arg = process.argv.find((value) => value.startsWith('--account-id='));
  return arg ? arg.split('=')[1]?.trim() ?? null : null;
}

async function main() {
  const accountId = parseAccountIdArg();
  if (!accountId) {
    console.error('Pass --account-id=<uuid>');
    process.exit(1);
  }

  const { count: liveCount, error: liveError } = await supabase
    .from('leads')
    .select('global_lead_id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .not('global_lead_id', 'is', null);
  if (liveError) {
    console.error('Failed to count live leads:', liveError.message);
    process.exit(1);
  }

  const { count: rollupCount, error: rollupError } = await supabase
    .from('account_lead_people')
    .select('global_lead_id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (rollupError) {
    console.error('Failed to count rollup rows:', rollupError.message);
    process.exit(1);
  }

  console.log(JSON.stringify({ accountId, liveLeadRows: liveCount ?? 0, rollupPeople: rollupCount ?? 0 }, null, 2));
}

void main();
