#!/usr/bin/env npx tsx
/**
 * Backfill account_lead_people rollup rows from live leads.
 *
 * Usage:
 *   npx tsx scripts/backfill-account-lead-people.ts
 *   npx tsx scripts/backfill-account-lead-people.ts --account-id=<uuid>
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
  let total = 0;
  let batch = 0;

  for (;;) {
    const { data, error } = await supabase.rpc('backfill_account_lead_people_batch', {
      p_account_id: accountId,
      p_limit: 500,
    });

    if (error) {
      console.error('Backfill batch failed:', error.message);
      process.exit(1);
    }

    const count = typeof data === 'number' ? data : 0;
    if (count === 0) break;

    total += count;
    batch += 1;
    console.log(`Batch ${batch}: refreshed ${count} people (total ${total})`);
  }

  console.log(`Done. Refreshed ${total} rollup rows.`);
}

void main();
