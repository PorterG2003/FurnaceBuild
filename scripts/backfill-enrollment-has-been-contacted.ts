#!/usr/bin/env npx tsx
/**
 * Backfill enrollments.has_been_contacted from sent campaign message_jobs.
 *
 * Matches get_campaign_contacted_counts: status = 'sent' AND
 * (message_type = 'campaign' OR message_type IS NULL).
 *
 * Usage:
 *   npx tsx scripts/backfill-enrollment-has-been-contacted.ts
 *   npx tsx scripts/backfill-enrollment-has-been-contacted.ts --limit=1000
 *   npx tsx scripts/backfill-enrollment-has-been-contacted.ts --campaign-id=<uuid>
 *
 * Requires: EXPO_PUBLIC_SUPABASE_URL / SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
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

function parseLimitArg(): number {
  const arg = process.argv.find((value) => value.startsWith('--limit='));
  const parsed = arg ? Number(arg.split('=')[1]) : 500;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 500;
}

function parseCampaignIdArg(): string | null {
  const arg = process.argv.find((value) => value.startsWith('--campaign-id='));
  return arg ? arg.split('=')[1]?.trim() || null : null;
}

async function main() {
  const batchLimit = parseLimitArg();
  const campaignId = parseCampaignIdArg();
  let total = 0;
  let batch = 0;

  console.log(
    `Backfilling enrollments.has_been_contacted (batch size ${batchLimit}${
      campaignId ? `, campaign ${campaignId}` : ''
    })...`,
  );

  for (;;) {
    const { data, error } = await supabase.rpc('backfill_enrollment_has_been_contacted_batch', {
      p_limit: batchLimit,
      p_campaign_id: campaignId,
    });

    if (error) {
      console.error('Backfill batch failed:', error.message);
      process.exit(1);
    }

    const count = typeof data === 'number' ? data : 0;
    if (count === 0) break;

    total += count;
    batch += 1;
    console.log(`Batch ${batch}: updated ${count} enrollments (total ${total})`);
  }

  console.log(`Done. Updated ${total} enrollment(s).`);
}

void main();
