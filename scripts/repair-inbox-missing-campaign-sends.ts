/**
 * Preview or repair campaign inbox threads missing sent follow-up rows.
 *
 * Finds replied campaign threads where more campaign sends existed by reply
 * time than sent email_messages on the thread, then backfills missing rows
 * using the same helper as inbox-checker (reply-time cutoff).
 *
 * Usage:
 *   npx tsx scripts/repair-inbox-missing-campaign-sends.ts
 *   ACCOUNT_ID=<uuid> npx tsx scripts/repair-inbox-missing-campaign-sends.ts
 *   THREAD_ID=<uuid> npx tsx scripts/repair-inbox-missing-campaign-sends.ts
 *   APPLY=true npx tsx scripts/repair-inbox-missing-campaign-sends.ts
 *   SELF_RECOVERY_TARGET_ENV=prod APPLY=true npx tsx scripts/repair-inbox-missing-campaign-sends.ts
 *
 * Defaults to dry-run. Set APPLY=true (or pass --apply) to write.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { backfillSentMessages } from '../workers/inbox-checker-worker/src/backfill-sent-messages.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type ThreadCandidate = {
  id: string;
  account_id: string;
  campaign_id: string;
  lead_id: string;
  mailbox_id: string | null;
  subject: string | null;
  last_inbound_at: string | null;
  sent_in_thread: number;
  sent_jobs_by_reply_time: number;
};

function wantsApply(): boolean {
  return process.env.APPLY === 'true' || process.argv.includes('--apply');
}

async function createSupabase(): Promise<SupabaseClient> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    '';

  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
    } catch (error) {
      if (!key) throw error;
      console.warn(
        `[repair-inbox-missing-campaign-sends] Failed to fetch ${secretParamPath}; falling back to existing secret env.`
      );
    }
  }

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.'
    );
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  if (secretParamPath) {
    console.log(`Resolved SUPABASE secret from Parameter Store path ${secretParamPath}.`);
  }

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findIncompleteThreads(
  supabase: SupabaseClient,
  options: { accountId?: string; threadId?: string; limit: number }
): Promise<ThreadCandidate[]> {
  let query = supabase
    .from('email_threads')
    .select('id, account_id, campaign_id, lead_id, mailbox_id, subject, last_inbound_at')
    .eq('has_reply', true)
    .not('campaign_id', 'is', null)
    .not('lead_id', 'is', null)
    .order('last_inbound_at', { ascending: false })
    .limit(options.limit);

  if (options.accountId) query = query.eq('account_id', options.accountId);
  if (options.threadId) query = query.eq('id', options.threadId);

  const { data: threads, error } = await query;
  if (error) throw error;
  if (!threads?.length) return [];

  const candidates: ThreadCandidate[] = [];
  for (const thread of threads) {
    if (!thread.campaign_id || !thread.lead_id) continue;
    const cutoff = thread.last_inbound_at || new Date().toISOString();

    const { count: sentInThread, error: sentCountError } = await supabase
      .from('email_messages')
      .select('*', { count: 'exact', head: true })
      .eq('thread_id', thread.id)
      .eq('direction', 'sent');
    if (sentCountError) throw sentCountError;

    const { count: sentJobs, error: jobsCountError } = await supabase
      .from('message_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', thread.campaign_id)
      .eq('lead_id', thread.lead_id)
      .eq('status', 'sent')
      .or('message_type.is.null,message_type.eq.campaign')
      .lte('sent_at', cutoff);
    if (jobsCountError) throw jobsCountError;

    const sentInThreadN = sentInThread ?? 0;
    const sentJobsN = sentJobs ?? 0;
    if (sentJobsN > sentInThreadN) {
      candidates.push({
        id: thread.id,
        account_id: thread.account_id,
        campaign_id: thread.campaign_id,
        lead_id: thread.lead_id,
        mailbox_id: thread.mailbox_id,
        subject: thread.subject,
        last_inbound_at: thread.last_inbound_at,
        sent_in_thread: sentInThreadN,
        sent_jobs_by_reply_time: sentJobsN,
      });
    }
  }

  return candidates;
}

async function loadMailbox(
  supabase: SupabaseClient,
  mailboxId: string | null,
  accountId: string
): Promise<{ account_id: string; email_address: string; display_name: string | null }> {
  if (mailboxId) {
    const { data, error } = await supabase
      .from('mailboxes')
      .select('account_id, email_address, display_name')
      .eq('id', mailboxId)
      .maybeSingle();
    if (error) throw error;
    if (data?.email_address) {
      return {
        account_id: data.account_id || accountId,
        email_address: data.email_address,
        display_name: data.display_name ?? null,
      };
    }
  }

  const { data, error } = await supabase
    .from('mailboxes')
    .select('account_id, email_address, display_name')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.email_address) {
    throw new Error(`No mailbox found for account ${accountId}`);
  }
  return {
    account_id: data.account_id || accountId,
    email_address: data.email_address,
    display_name: data.display_name ?? null,
  };
}

async function main(): Promise<void> {
  const apply = wantsApply();
  const accountId = process.env.ACCOUNT_ID?.trim() || undefined;
  const threadId = process.env.THREAD_ID?.trim() || undefined;
  const limit = Math.max(1, Number(process.env.LIMIT || '500') || 500);

  const supabase = await createSupabase();
  const candidates = await findIncompleteThreads(supabase, { accountId, threadId, limit });

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        scanned_limit: limit,
        account_id: accountId ?? null,
        thread_id: threadId ?? null,
        incomplete_count: candidates.length,
      },
      null,
      2
    )
  );

  if (candidates.length === 0) {
    console.log('No incomplete campaign threads found.');
    return;
  }

  let repaired = 0;
  let insertedTotal = 0;

  for (const candidate of candidates) {
    const missing = candidate.sent_jobs_by_reply_time - candidate.sent_in_thread;
    const cutoff = candidate.last_inbound_at || new Date().toISOString();
    console.log(
      [
        candidate.id,
        `account=${candidate.account_id}`,
        `subject=${JSON.stringify(candidate.subject)}`,
        `sent_in_thread=${candidate.sent_in_thread}`,
        `sent_jobs=${candidate.sent_jobs_by_reply_time}`,
        `missing≈${missing}`,
        `cutoff=${cutoff}`,
      ].join(' | ')
    );

    if (!apply) continue;

    const mailbox = await loadMailbox(supabase, candidate.mailbox_id, candidate.account_id);
    const result = await backfillSentMessages(
      supabase,
      { id: candidate.id, account_id: candidate.account_id },
      candidate.campaign_id,
      candidate.lead_id,
      cutoff,
      mailbox,
      { reportErrors: false }
    );
    repaired += 1;
    insertedTotal += result.insertedCount;
    console.log(`  inserted=${result.insertedCount} considered=${result.consideredJobIds.length}`);
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with APPLY=true (or --apply) to insert missing sent rows.');
  } else {
    console.log(`\nDone. threads_repaired=${repaired} rows_inserted=${insertedTotal}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
