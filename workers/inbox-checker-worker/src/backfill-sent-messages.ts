import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import {
  buildReferencesFromAncestorIds,
  formatReferencesHeader,
  normalizeMessageId,
  normalizeThreadTopic,
  pickWireMessageId,
} from '@furnace/email-lib';
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

export { normalizeMessageId };

export type BackfillSentMessagesResult = {
  insertedCount: number;
  consideredJobIds: string[];
};

/**
 * Backfill sent campaign messages into email_messages for a thread.
 *
 * Includes paced campaign + priority sends for campaign+lead with
 * sent_at <= cutoffTime. Reconstructs cumulative References from ordered
 * ancestor Message-IDs without changing historical wire data.
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
    .select('id, provider_message_id, submitted_message_id, sent_at, created_at, message_data, mailbox_id, lead_id')
    .eq('campaign_id', campaignId)
    .eq('lead_id', leadId)
    .eq('status', 'sent')
    .or(
      'message_type.is.null,message_type.eq.campaign,message_type.eq.campaign_priority,message_type.eq.campaign_reply',
    )
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

  const wireIds: string[] = [];
  let insertedCount = 0;
  for (let i = 0; i < sentJobs.length; i++) {
    const job = sentJobs[i];
    const wireId = pickWireMessageId({
      providerMessageId: job.provider_message_id,
      submittedMessageId: job.submitted_message_id ?? job.message_data?.submitted_message_id,
    });
    if (wireId) wireIds.push(wireId);

    if (existingJobIds.has(job.id)) continue;

    const evtData = eventByJobId.get(job.id);
    const md = job.message_data || {};
    const nc = md.node_config || {};

    const jobSubject = evtData?.sent_subject || md.subject || nc.subject || '(No Subject)';
    const jobBodyHtml = evtData?.sent_body_html || nc.body || nc.template || '';
    const jobBodyText = evtData?.sent_body_text || nc.body || nc.template || '';

    const normalizedProviderId = wireId;
    const ancestors = wireIds.slice(0, -1);
    const threading = ancestors.length > 0 ? buildReferencesFromAncestorIds(ancestors) : null;
    const inReplyTo = threading?.inReplyTo ? normalizeMessageId(threading.inReplyTo) : null;
    const msgReferences =
      threading?.references ??
      (md.message_references as string | null) ??
      formatReferencesHeader(ancestors);
    const referenceMessageIds = threading?.referenceMessageIds ?? ancestors;
    const threadTopic =
      (typeof md.thread_topic === 'string' && md.thread_topic) ||
      normalizeThreadTopic(jobSubject);

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
      reference_message_ids: referenceMessageIds.length > 0 ? referenceMessageIds : null,
      thread_topic: threadTopic,
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
