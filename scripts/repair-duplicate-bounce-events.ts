/**
 * Preview or repair duplicate bounced events for one campaign.
 *
 * Usage:
 *   CAMPAIGN_ID=<uuid> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-duplicate-bounce-events.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-duplicate-bounce-events.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true REPAIR_RELATED=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-duplicate-bounce-events.ts
 */

type BounceEventRow = {
  id: string;
  campaign_id: string;
  account_id: string | null;
  lead_id: string | null;
  enrollment_id: string | null;
  message_job_id: string | null;
  mailbox_id: string | null;
  created_at: string;
  bounce_dedupe_key: string | null;
  event_data: {
    bounce_message_id?: string | null;
    bounce_uid?: string | number | null;
    severity?: string | null;
  } | null;
};

type MessageJobMeta = {
  id: string;
  message_type: string | null;
  sent_at: string | null;
  created_at: string;
};

type LeadRow = {
  id: string;
  email: string | null;
};

type DuplicateGroup = {
  dedupeKey: string;
  mailboxId: string;
  events: BounceEventRow[];
  keeper: BounceEventRow;
  duplicates: BounceEventRow[];
};

function normalizeBounceMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^<|>$/g, '').toLowerCase() || null;
}

function bounceDedupeKey(event: BounceEventRow): string | null {
  if (!event.mailbox_id) return null;
  const messageId = normalizeBounceMessageId(event.event_data?.bounce_message_id ?? null);
  if (messageId) return `mid:${messageId}`;
  const uidRaw = event.event_data?.bounce_uid;
  if (uidRaw === null || uidRaw === undefined) return null;
  const uid = String(uidRaw).trim();
  return uid ? `uid:${uid}` : null;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function rankMessageType(messageType: string | null | undefined): number {
  if (messageType === null || messageType === undefined || messageType === 'campaign') return 0;
  if (messageType === 'campaign_reply') return 1;
  if (messageType === 'inbox_reply' || messageType === 'inbox_forward') return 2;
  return 1;
}

function chooseKeeper(events: BounceEventRow[], jobsById: Map<string, MessageJobMeta>): BounceEventRow {
  return [...events].sort((a, b) => {
    const aJob = a.message_job_id ? jobsById.get(a.message_job_id) : null;
    const bJob = b.message_job_id ? jobsById.get(b.message_job_id) : null;

    const rankDiff = rankMessageType(aJob?.message_type) - rankMessageType(bJob?.message_type);
    if (rankDiff !== 0) return rankDiff;

    const timeDiff =
      parseTimestamp(bJob?.sent_at || bJob?.created_at || null) -
      parseTimestamp(aJob?.sent_at || aJob?.created_at || null);
    if (timeDiff !== 0) return timeDiff;

    const createdDiff = parseTimestamp(a.created_at) - parseTimestamp(b.created_at);
    if (createdDiff !== 0) return createdDiff;

    return a.id.localeCompare(b.id);
  })[0]!;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const campaignId = process.env.CAMPAIGN_ID?.trim();
  const apply = process.env.APPLY === 'true';
  const repairRelated = process.env.REPAIR_RELATED === 'true';

  if (!url || !key || !campaignId) {
    console.error('Set CAMPAIGN_ID plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).');
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const events: BounceEventRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('events')
      .select('id, campaign_id, account_id, lead_id, enrollment_id, message_job_id, mailbox_id, created_at, bounce_dedupe_key, event_data')
      .eq('campaign_id', campaignId)
      .eq('event_type', 'bounced')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Failed to load bounced events:', error.message);
      process.exit(1);
    }

    const rows = (data ?? []) as BounceEventRow[];
    events.push(...rows);
    if (rows.length < pageSize) break;
  }

  if (events.length === 0) {
    console.log('No bounced events found for campaign.');
    return;
  }

  const groupsByKey = new Map<string, BounceEventRow[]>();
  for (const event of events) {
    const dedupeKey = bounceDedupeKey(event);
    if (!dedupeKey || !event.mailbox_id) continue;
    const keyForGroup = `${event.mailbox_id}::${dedupeKey}`;
    const group = groupsByKey.get(keyForGroup) ?? [];
    group.push(event);
    groupsByKey.set(keyForGroup, group);
  }

  const duplicateGroupsRaw = [...groupsByKey.entries()].filter(([, group]) => group.length > 1);
  const messageJobIds = [
    ...new Set(
      duplicateGroupsRaw.flatMap(([, group]) => group.map((event) => event.message_job_id).filter(Boolean) as string[])
    ),
  ];
  const jobsById = new Map<string, MessageJobMeta>();

  if (messageJobIds.length > 0) {
    const { data: jobs, error: jobsError } = await supabase
      .from('message_jobs')
      .select('id, message_type, sent_at, created_at')
      .in('id', messageJobIds);

    if (jobsError) {
      console.error('Failed to load message jobs:', jobsError.message);
      process.exit(1);
    }

    for (const job of (jobs ?? []) as MessageJobMeta[]) {
      jobsById.set(job.id, job);
    }
  }

  const duplicateGroups: DuplicateGroup[] = duplicateGroupsRaw.map(([keyForGroup, group]) => {
    const [mailboxId, dedupeKey] = keyForGroup.split('::');
    const keeper = chooseKeeper(group, jobsById);
    return {
      mailboxId,
      dedupeKey,
      events: group,
      keeper,
      duplicates: group.filter((event) => event.id !== keeper.id),
    };
  });

  const duplicateIds = duplicateGroups.flatMap((group) => group.duplicates.map((event) => event.id));
  const keptIds = new Set(duplicateGroups.map((group) => group.keeper.id));
  const remainingEvents = events.filter((event) => !duplicateIds.includes(event.id));

  const remainingEnrollmentIds = new Set(
    remainingEvents.map((event) => event.enrollment_id).filter(Boolean) as string[]
  );
  const remainingLeadIdsByAccount = new Set(
    remainingEvents
      .map((event) => (event.account_id && event.lead_id ? `${event.account_id}::${event.lead_id}` : null))
      .filter(Boolean) as string[]
  );

  const enrollmentsToRepair = [
    ...new Set(
      duplicateGroups.flatMap((group) =>
        group.duplicates
          .map((event) => event.enrollment_id)
          .filter((id): id is string => !!id && !remainingEnrollmentIds.has(id))
      )
    ),
  ];

  const blockRepairLeadIds = [
    ...new Set(
      duplicateGroups.flatMap((group) =>
        group.duplicates
          .filter(
            (event) =>
              !!event.account_id &&
              !!event.lead_id &&
              !remainingLeadIdsByAccount.has(`${event.account_id}::${event.lead_id}`)
          )
          .map((event) => event.lead_id!)
      )
    ),
  ];

  const leadEmailById = new Map<string, string | null>();
  if (blockRepairLeadIds.length > 0) {
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, email')
      .in('id', blockRepairLeadIds);

    if (leadsError) {
      console.error('Failed to load leads:', leadsError.message);
      process.exit(1);
    }

    for (const lead of (leads ?? []) as LeadRow[]) {
      leadEmailById.set(lead.id, lead.email);
    }
  }

  console.log(`Campaign: ${campaignId}`);
  console.log(`Bounced events loaded: ${events.length}`);
  console.log(`Duplicate physical-bounce groups: ${duplicateGroups.length}`);
  console.log(`Duplicate bounced rows to delete: ${duplicateIds.length}`);
  console.log(`Enrollments that may need reactivation: ${enrollmentsToRepair.length}`);
  console.log(`Lead block entries that may need removal: ${blockRepairLeadIds.length}`);

  const preview = duplicateGroups.slice(0, 10).map((group) => ({
    mailbox_id: group.mailboxId,
    dedupe_key: group.dedupeKey,
    keeper: {
      id: group.keeper.id,
      enrollment_id: group.keeper.enrollment_id,
      lead_id: group.keeper.lead_id,
      message_job_id: group.keeper.message_job_id,
      created_at: group.keeper.created_at,
      kept_reason_message_type: jobsById.get(group.keeper.message_job_id ?? '')?.message_type ?? null,
    },
    duplicate_ids: group.duplicates.map((event) => event.id),
  }));
  console.log('Preview:');
  console.log(JSON.stringify(preview, null, 2));

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to delete duplicate rows.');
    if (enrollmentsToRepair.length > 0 || blockRepairLeadIds.length > 0) {
      console.log('Re-run with REPAIR_RELATED=true alongside APPLY=true to reactivate enrollments and remove bounced block-list rows that no longer have any remaining bounce events.');
    }
    return;
  }

  if (duplicateIds.length === 0) {
    console.log('Nothing to repair.');
    return;
  }

  for (let i = 0; i < duplicateIds.length; i += 100) {
    const chunk = duplicateIds.slice(i, i + 100);
    const { error } = await supabase.from('events').delete().in('id', chunk);
    if (error) {
      console.error('Failed to delete duplicate events:', error.message);
      process.exit(1);
    }
  }

  for (const group of duplicateGroups) {
    const { error } = await supabase
      .from('events')
      .update({ bounce_dedupe_key: group.dedupeKey })
      .eq('id', group.keeper.id);

    if (error) {
      console.error(`Failed to backfill bounce_dedupe_key for ${group.keeper.id}:`, error.message);
      process.exit(1);
    }
  }

  console.log(`Deleted ${duplicateIds.length} duplicate bounced rows.`);
  console.log(`Backfilled bounce_dedupe_key on ${duplicateGroups.length} kept rows.`);

  if (repairRelated) {
    if (enrollmentsToRepair.length > 0) {
      const now = new Date().toISOString();
      const { error: enrollmentsError } = await supabase
        .from('enrollments')
        .update({
          state: 'active',
          stopped_reason: null,
          stopped_at: null,
          updated_at: now,
        })
        .in('id', enrollmentsToRepair)
        .eq('state', 'stopped')
        .eq('stopped_reason', 'bounced');

      if (enrollmentsError) {
        console.error('Failed to repair enrollments:', enrollmentsError.message);
        process.exit(1);
      }

      console.log(`Reactivated ${enrollmentsToRepair.length} enrollment(s).`);
    }

    for (const leadId of blockRepairLeadIds) {
      const exampleEvent = duplicateGroups
        .flatMap((group) => group.duplicates)
        .find((event) => event.lead_id === leadId && event.account_id);
      const leadEmail = leadEmailById.get(leadId);

      if (!exampleEvent?.account_id || !leadEmail) continue;

      const { error } = await supabase
        .from('block_list')
        .delete()
        .eq('account_id', exampleEvent.account_id)
        .eq('type', 'email')
        .eq('reason', 'bounced')
        .ilike('value', leadEmail);

      if (error) {
        console.error(`Failed to remove bounced block_list row for ${leadEmail}:`, error.message);
        process.exit(1);
      }
    }

    if (blockRepairLeadIds.length > 0) {
      console.log(`Removed bounced block_list entries for up to ${blockRepairLeadIds.length} lead(s).`);
    }
  }

  const { data: updated, error: reconcileError } = await supabase.rpc('reconcile_campaign_stats', {
    p_campaign_id: campaignId,
  });
  if (reconcileError) {
    console.error('Failed to reconcile campaign_stats:', reconcileError.message);
    process.exit(1);
  }

  console.log(`Reconciled ${updated ?? 0} campaign_stats row(s).`);
}

main();
