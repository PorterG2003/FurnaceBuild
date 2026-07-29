import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import type { SupabaseClient } from '@supabase/supabase-js';

export type BackfillMailbox = {
  account_id: string;
  email_address: string;
  display_name?: string | null;
};

export type BackfillThread = {
  id: string;
  account_id: string;
};

/**
 * Normalize Message-ID for consistent storage and matching.
 * Removes angle brackets, lowercases; returns null if empty.
 */
export function normalizeMessageId(messageId: string | null | undefined): string | null {
  if (!messageId) return null;
  return messageId.trim().replace(/^<|>$/g, '').toLowerCase() || null;
}

export type BackfillSentMessagesResult = {
  insertedCount: number;
  consideredJobIds: string[];
};

/**
 * Backfill sent campaign messages into email_messages for a thread.
 *
 * Includes all sent campaign message_jobs for campaign+lead with
 * sent_at <= cutoffTime (typically the inbound reply received_at), loads
 * merged content from the sent event when available, and inserts any missing
 * email_messages (direction = 'sent').
 */
export async function backfillSentMessages(
  supabase: SupabaseClient,
  thread: BackfillThread,
  campaignId: string,
  leadId: string,
  cutoffTime: string,
  mailbox: BackfillMailbox,
  options?: { reportErrors?: boolean }
): Promise<BackfillSentMessagesResult> {
  const reportErrors = options?.reportErrors !== false;

  const { data: sentJobs, error: jobsError } = await supabase
    .from('message_jobs')
    .select('id, provider_message_id, sent_at, created_at, message_data, mailbox_id, lead_id')
    .eq('campaign_id', campaignId)
    .eq('lead_id', leadId)
    .eq('status', 'sent')
    .or('message_type.is.null,message_type.eq.campaign')
    .lte('sent_at', cutoffTime)
    .order('sent_at', { ascending: true });

  if (jobsError || !sentJobs || sentJobs.length === 0) {
    return { insertedCount: 0, consideredJobIds: [] };
  }

  const accountId = thread.account_id || mailbox.account_id;
  const jobIds = sentJobs.map((j) => j.id);
  const { data: sentEvents } = await supabase
    .from('events')
    .select('message_job_id, event_data')
    .eq('event_type', 'sent')
    .in('message_job_id', jobIds);

  const eventByJobId = new Map<string, any>();
  if (sentEvents) {
    for (const evt of sentEvents) {
      eventByJobId.set(evt.message_job_id, evt.event_data);
    }
  }

  const { data: existingMessages } = await supabase
    .from('email_messages')
    .select('message_job_id')
    .eq('account_id', accountId)
    .eq('thread_id', thread.id)
    .eq('direction', 'sent')
    .in('message_job_id', jobIds);

  const existingJobIds = new Set((existingMessages || []).map((m) => m.message_job_id));

  const mailboxEmail = mailbox.email_address;
  const mailboxDisplayName = mailbox.display_name || null;

  const { data: leadRow } = await supabase
    .from('leads')
    .select('email, name')
    .eq('id', leadId)
    .maybeSingle();

  const leadEmail = leadRow?.email || '';
  const leadName = leadRow?.name || null;

  const firstNormalized = normalizeMessageId(sentJobs[0]?.provider_message_id);

  let insertedCount = 0;
  for (let i = 0; i < sentJobs.length; i++) {
    const job = sentJobs[i];
    if (existingJobIds.has(job.id)) continue;

    const evtData = eventByJobId.get(job.id);
    const md = job.message_data || {};
    const nc = md.node_config || {};

    const jobSubject = evtData?.sent_subject || md.subject || nc.subject || '(No Subject)';
    const jobBodyHtml = evtData?.sent_body_html || nc.body || nc.template || '';
    const jobBodyText = evtData?.sent_body_text || nc.body || nc.template || '';

    const normalizedProviderId = normalizeMessageId(job.provider_message_id);

    let inReplyTo: string | null = null;
    let msgReferences: string | null = null;
    if (i > 0 && firstNormalized) {
      inReplyTo = firstNormalized;
      msgReferences = firstNormalized;
    }

    const { error: insertError } = await supabase.from('email_messages').insert({
      thread_id: thread.id,
      account_id: thread.account_id,
      message_job_id: job.id,
      direction: 'sent',
      from_email: mailboxEmail,
      from_name: mailboxDisplayName,
      to_email: leadEmail,
      to_name: leadName,
      subject: jobSubject,
      body_text: jobBodyText,
      body_html: jobBodyHtml,
      message_id: normalizedProviderId,
      in_reply_to: inReplyTo,
      message_references: msgReferences,
      received_at: job.sent_at || job.created_at,
      headers: {},
      attachments: [],
    });

    if (insertError) {
      if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
        continue;
      }
      console.error(`Error backfilling sent message for job ${job.id}:`, insertError);
      if (reportErrors) {
        const errorMessage = formatUnknownError(insertError);
        reportErrorToSlack('Inbox-checker: backfill sent message failed', {
          severity: 'warning',
          message_job_id: job.id,
          thread_id: thread.id,
          error: errorMessage,
          alertPolicy: isRetryableSupabaseReadError(errorMessage)
            ? 'transient_retryable_warning'
            : 'persistent_config_warning',
          aggregationKey: `inbox-backfill-sent-message:${thread.id}`,
          summaryFields: {
            thread_id: thread.id,
          },
        });
      }
    } else {
      insertedCount++;
    }
  }

  if (insertedCount > 0) {
    const { count: totalCount } = await supabase
      .from('email_messages')
      .select('*', { count: 'exact', head: true })
      .eq('thread_id', thread.id);

    if (totalCount != null) {
      await supabase.from('email_threads').update({ message_count: totalCount }).eq('id', thread.id);
    }
  }

  return { insertedCount, consideredJobIds: jobIds };
}
