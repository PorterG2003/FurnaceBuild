/**
 * Preview or repair enrollments incorrectly stopped by the old mailbox-wide
 * auto-unsubscribe logic.
 *
 * Usage:
 *   CAMPAIGN_ID=<uuid> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-auto-unsubscribe-stops.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-auto-unsubscribe-stops.ts
 *
 * Heuristic:
 * - stopped_reason = 'unsubscribed'
 * - grouped by (campaign_id, mailbox_id, stopped_at)
 * - only cohorts with at least MIN_BURST_SIZE rows are considered suspicious
 *
 * This is intentionally conservative so normal one-off unsubscribes are left alone.
 */

type EnrollmentRow = {
  id: string;
  lead_id: string;
  current_node_id: string | null;
  stopped_reason: string | null;
  stopped_at: string | null;
  updated_at: string;
};

type LeadRow = {
  id: string;
  email: string;
  mailbox_id: string | null;
};

async function main() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const campaignId = process.env.CAMPAIGN_ID?.trim();
  const apply = process.env.APPLY === 'true';
  const minBurstSize = Number(process.env.MIN_BURST_SIZE || '3');

  if (!url || !key || !campaignId) {
    console.error(
      'Set CAMPAIGN_ID plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).'
    );
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('enrollments')
    .select('id, lead_id, current_node_id, stopped_reason, stopped_at, updated_at')
    .eq('campaign_id', campaignId)
    .eq('state', 'stopped')
    .eq('stopped_reason', 'unsubscribed')
    .order('stopped_at', { ascending: false });

  if (enrollmentsError) {
    console.error('Failed to load enrollments:', enrollmentsError.message);
    process.exit(1);
  }

  const rows = (enrollments ?? []) as EnrollmentRow[];
  if (rows.length === 0) {
    console.log('No stopped unsubscribed enrollments found.');
    return;
  }

  const leadIds = [...new Set(rows.map((row) => row.lead_id))];
  const { data: leads, error: leadsError } = await supabase
    .from('leads')
    .select('id, email, mailbox_id')
    .in('id', leadIds);

  if (leadsError) {
    console.error('Failed to load leads:', leadsError.message);
    process.exit(1);
  }

  const leadById = new Map<string, LeadRow>((leads ?? []).map((lead) => [lead.id, lead as LeadRow]));
  const cohorts = new Map<string, EnrollmentRow[]>();

  for (const row of rows) {
    const lead = leadById.get(row.lead_id);
    const mailboxId = lead?.mailbox_id ?? '<null-mailbox>';
    const stoppedAt = row.stopped_at ?? '<null-stopped-at>';
    const key = `${mailboxId}::${stoppedAt}`;
    const cohort = cohorts.get(key) ?? [];
    cohort.push(row);
    cohorts.set(key, cohort);
  }

  const suspicious = [...cohorts.entries()]
    .map(([key, cohort]) => {
      const [mailboxId, stoppedAt] = key.split('::');
      return { mailboxId, stoppedAt, count: cohort.length, cohort };
    })
    .filter((cohort) => cohort.count >= minBurstSize)
    .sort((a, b) => b.count - a.count);

  console.log(`Campaign: ${campaignId}`);
  console.log(`Stopped unsubscribed rows: ${rows.length}`);
  console.log(`Suspicious burst cohorts (size >= ${minBurstSize}): ${suspicious.length}`);
  for (const cohort of suspicious) {
    console.log(`- mailbox=${cohort.mailboxId} stopped_at=${cohort.stoppedAt} count=${cohort.count}`);
  }

  const candidateIds = suspicious.flatMap((cohort) => cohort.cohort.map((row) => row.id));
  console.log(`Candidate enrollments: ${candidateIds.length}`);

  if (candidateIds.length > 0) {
    const preview = suspicious.flatMap((cohort) =>
      cohort.cohort.slice(0, 3).map((row) => {
        const lead = leadById.get(row.lead_id);
        return {
          id: row.id,
          lead_id: row.lead_id,
          lead_email: lead?.email ?? null,
          mailbox_id: lead?.mailbox_id ?? null,
          stopped_at: row.stopped_at,
          current_node_id: row.current_node_id,
        };
      })
    );
    console.log('Preview:');
    console.log(JSON.stringify(preview, null, 2));
  }

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to reactivate candidates.');
    return;
  }

  if (candidateIds.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('enrollments')
    .update({
      state: 'active',
      stopped_reason: null,
      stopped_at: null,
      stopped_error_message: null,
      next_run_at: now,
      updated_at: now,
    })
    .in('id', candidateIds)
    .select('id');

  if (updateError) {
    console.error('Failed to repair enrollments:', updateError.message);
    process.exit(1);
  }

  console.log(`Reactivated ${updated?.length ?? 0} enrollments.`);
}

main();
