import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import {
  buildReferencesFromAncestorIds,
  buildTimelineFromRows,
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
  const eventSentSubjectByJobId = new Map<string, string | null>();
  if (sentEvents) {
    for (const evt of sentEvents) {
      eventByJobId.set(evt.message_job_id, evt.event_data);
      const sentSubject = evt.event_data?.sent_subject;
      eventSentSubjectByJobId.set(
        evt.message_job_id,
        typeof sentSubject === 'string' ? sentSubject : null,
      );
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
    .select('email, name, first_name, last_name, company_name, website, custom_lead_data')
    .eq('id', leadId)
    .maybeSingle();

  const leadEmail = leadRow?.email || '';
  const leadName = leadRow?.name || null;

  // Epoch-tagged view of these sends. A follow-up with an explicit subject opened
  // a new conversation, so ancestry must not reach back across that boundary.
  const timeline = buildTimelineFromRows({
    sentJobs,
    eventSentSubjectByJobId,
    lead: leadRow ?? null,
  });
  const timelineIndexByJobId = new Map<string, number>();
  timeline.forEach((entry, index) => {
    if (entry.messageJobId) timelineIndexByJobId.set(entry.messageJobId, index);
  });

  let insertedCount = 0;
  for (let i = 0; i < sentJobs.length; i++) {
    const job = sentJobs[i];
    const wireId = pickWireMessageId({
      providerMessageId: job.provider_message_id,
      submittedMessageId: job.submitted_message_id ?? job.message_data?.submitted_message_id,
    });

    if (existingJobIds.has(job.id)) continue;

    const evtData = eventByJobId.get(job.id);
    const md = job.message_data || {};
    const nc = md.node_config || {};

    const timelineIndex = timelineIndexByJobId.get(job.id);
    const entry = timelineIndex == null ? null : timeline[timelineIndex]!;

    // Rule 15: never let a raw template become a stored subject.
    const jobSubject = entry?.deliveredSubject ?? '';
    const jobBodyHtml = evtData?.sent_body_html || nc.body || nc.template || '';
    const jobBodyText = evtData?.sent_body_text || nc.body || nc.template || '';

    const ancestors =
      entry && timelineIndex != null
        ? timeline
            .slice(0, timelineIndex)
            .filter(
              (prior) => prior.conversationRootMessageId === entry.conversationRootMessageId,
            )
            .map((prior) => prior.wireMessageId)
        : [];
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
      to_emails: leadEmail?.trim() ? [leadEmail.trim()] : null,
      subject: jobSubject,
      body_text: jobBodyText,
      body_html: jobBodyHtml,
      message_id: wireId,
      in_reply_to: inReplyTo,
      message_references: msgReferences,
      reference_message_ids: referenceMessageIds.length > 0 ? referenceMessageIds : null,
      thread_topic: threadTopic,
      conversation_root_message_id: entry?.conversationRootMessageId ?? null,
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
