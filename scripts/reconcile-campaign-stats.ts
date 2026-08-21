/**
 * Reconcile campaign_stats from source tables (message_jobs, email_threads, events).
 * Use when totals may have drifted from events (e.g. after a failed RPC or for one-time correction).
 *
 * Usage:
 *   npx tsx scripts/reconcile-campaign-stats.ts              # reconcile all campaigns
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/reconcile-campaign-stats.ts   # reconcile one campaign
 *
 * Requires: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
 */

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)'
    );
    process.exit(1);
  }

  const campaignId = process.env.CAMPAIGN_ID || null;

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  console.log('Reconciling campaign_stats...');
  if (campaignId) {
    console.log('Campaign ID:', campaignId);
  } else {
    console.log('All campaigns');
  }

  const { data: updated, error } = await supabase.rpc('reconcile_campaign_stats', {
    p_campaign_id: campaignId,
  });

  if (error) {
    console.error('Reconcile failed:', error.message);
    process.exit(1);
  }

  console.log('Updated', updated, 'campaign_stats row(s).');

  const healthArgs = campaignId
    ? { p_campaign_id: campaignId }
    : {};
  const { data: health, error: healthError } = await supabase.rpc(
    'campaign_stats_daily_health_report',
    healthArgs as never,
  );
  if (healthError) {
    console.error('Daily health report failed:', healthError.message);
    process.exit(1);
  }
  console.log('campaign_stats_daily health:', JSON.stringify(health, null, 2));
}

main();
