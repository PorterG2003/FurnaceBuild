import { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
import { calculateNextRunAt } from '../scheduling.js';
import type { CampaignSchedule, Enrollment } from '../types.js';

/**
 * Reply-mode email node (send_mode='reply'): sends the next email IN the
 * thread the lead replied to, instead of starting a new thread.
 *
 * Bypasses batch interval assignment entirely: the job is created here as
 * 'campaign_reply' (interval_id NULL), claimed by the send worker's
 * manual-priority lane, sent from the thread's mailbox with
 * In-Reply-To/References headers and an automatic "Re:" subject.
 *
 * Spec: docs/implementation/flow/CATEGORIZER_IMPLEMENTATION.md
 */

const MAILBOX_UNAVAILABLE_RETRY_MS = 6 * 60 * 60 * 1000;

/** First-occurrence-per-enrollment guard for mailbox-unavailable warnings. */
const mailboxUnavailableWarned = new Set<string>();

/** Test seam: reset the warned-enrollments tracking. */
export function resetReplyEmailWarningTracking(): void {
  mailboxUnavailableWarned.clear();
}

export interface ReplyEmailHandlerContext {
  schedule: CampaignSchedule | null;
  activeFlowVersionNumber: number;
}

function stripReplyPrefix(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?|aw):\s*)+/i, '').trim();
}

export function buildReplySubject(threadSubject: string | null): string {
  const base = stripReplyPrefix(threadSubject ?? '');
  return base ? `Re: ${base}` : 'Re:';
}

export async function handleReplyEmailNode(
  enrollment: Enrollment,
  node: any,
  supabase: SupabaseClient,
  context: ReplyEmailHandlerContext,
): Promise<void> {
  const enrollmentTag = enrollment.id.substring(0, 8);

  // 1. Reply-mode emails require a branched categorizer upstream.
  const { data: freshEnrollment, error: enrollmentError } = await supabase
    .from('enrollments')
    .select('reply_thread_id, state')
    .eq('id', enrollment.id)
    .maybeSingle();

  if (enrollmentError) {
    throw enrollmentError;
  }

  const replyThreadId = (freshEnrollment as { reply_thread_id: string | null } | null)
    ?.reply_thread_id;

  if (!replyThreadId) {
    console.error(
      `[REPLY EMAIL ${enrollmentTag}] Reply-mode email node ${node.id.substring(0, 8)} reached with no reply_thread_id. Stopping enrollment.`,
    );
    reportErrorToSlack('Scheduler: reply-mode email node reached with no reply thread (flow misconfiguration)', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      node_id: node.id,
      alertPolicy: 'persistent_config_warning',
      aggregationKey: `campaign-reply-no-thread:${enrollment.campaign_id}`,
      summaryFields: {
        campaign_id: enrollment.campaign_id,
      },
    });

    const stoppedAt = new Date().toISOString();
    await supabase
      .from('enrollments')
      .update({
        state: 'stopped',
        stopped_reason: 'error',
        stopped_at: stoppedAt,
        stopped_error_message: 'Reply-mode email node reached without an upstream categorizer branch (no reply thread)',
        next_run_at: null,
        updated_at: stoppedAt,
      })
      .eq('id', enrollment.id)
      .eq('state', 'active');
    return;
  }

  // 2. Idempotency: only arm a new attempt when none exists or the latest
  //    one was deferred (mirrors the campaign email pipeline; flow evaluation
  //    gates live/sent/terminal attempts before we get here).
  const { data: existingJobs, error: existingJobsError } = await supabase
    .from('message_jobs')
    .select('id, status')
    .eq('enrollment_id', enrollment.id)
    .eq('node_id', node.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existingJobsError) {
    throw existingJobsError;
  }

  const latestJob = (existingJobs ?? [])[0] as { id: string; status: string } | undefined;
  if (latestJob && latestJob.status !== 'deferred') {
    console.log(
      `[REPLY EMAIL ${enrollmentTag}] Attempt already exists (${latestJob.status}). Updating position only.`,
    );
    await updateEnrollmentAtNode(supabase, enrollment, node, context, new Date().toISOString());
    return;
  }

  // 3. Load the replied thread; the reply email goes in this exact thread,
  //    from this exact mailbox.
  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('id, account_id, mailbox_id, subject, lead_id')
    .eq('id', replyThreadId)
    .maybeSingle();

  if (threadError) {
    throw threadError;
  }

  if (!thread || !thread.mailbox_id) {
    console.error(`[REPLY EMAIL ${enrollmentTag}] Reply thread ${replyThreadId} missing or has no mailbox.`);
    await deferMailboxUnavailable(supabase, enrollment, node, context, 'Reply thread missing or has no mailbox');
    return;
  }

  // 4. Thread mailbox must be usable - never fall back to another mailbox.
  const { data: mailbox, error: mailboxError } = await supabase
    .from('mailboxes')
    .select('id, status, smtp_status, deleted_at')
    .eq('id', thread.mailbox_id)
    .maybeSingle();

  if (mailboxError) {
    throw mailboxError;
  }

  const mailboxUsable =
    mailbox &&
    !mailbox.deleted_at &&
    mailbox.status === 'connected' &&
    mailbox.smtp_status === 'active';

  if (!mailboxUsable) {
    const reason = !mailbox
      ? 'Thread mailbox not found'
      : mailbox.deleted_at
        ? 'Thread mailbox deleted'
        : `Thread mailbox unavailable (status=${mailbox.status}, smtp=${mailbox.smtp_status})`;
    console.warn(`[REPLY EMAIL ${enrollmentTag}] ${reason}. Retrying in 6h.`);
    await deferMailboxUnavailable(supabase, enrollment, node, context, reason);
    return;
  }

  // 5. Threading headers: In-Reply-To = latest inbound Message-ID,
  //    References = full thread chain (create_inbox_reply_job parity).
  const { data: threadMessages, error: messagesError } = await supabase
    .from('email_messages')
    .select('message_id, direction, received_at')
    .eq('thread_id', thread.id)
    .order('received_at', { ascending: true });

  if (messagesError) {
    throw messagesError;
  }

  const messages = (threadMessages ?? []) as Array<{
    message_id: string | null;
    direction: string;
    received_at: string | null;
  }>;
  const latestInbound = [...messages].reverse().find((m) => m.direction === 'received' && m.message_id);

  if (!latestInbound?.message_id) {
    // Replied thread without a readable inbound message - transient write
    // race; retry shortly.
    console.warn(`[REPLY EMAIL ${enrollmentTag}] No inbound message found in reply thread yet. Retrying in 60s.`);
    await updateEnrollmentAtNode(
      supabase,
      enrollment,
      node,
      context,
      new Date(Date.now() + 60 * 1000).toISOString(),
    );
    return;
  }

  const referencesHeader = messages
    .map((m) => m.message_id?.trim())
    .filter((id): id is string => Boolean(id))
    .join(' ');

  // 6. Load lead for variable merge.
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', enrollment.lead_id)
    .maybeSingle();

  if (leadError) {
    throw leadError;
  }

  if (!lead || lead.deleted_at) {
    const stoppedAt = new Date().toISOString();
    console.log(`[REPLY EMAIL ${enrollmentTag}] Lead deleted. Stopping enrollment.`);
    await supabase
      .from('enrollments')
      .update({
        state: 'stopped',
        stopped_reason: 'error',
        stopped_at: stoppedAt,
        stopped_error_message: 'Lead deleted before reply email could be sent',
        next_run_at: null,
        updated_at: stoppedAt,
      })
      .eq('id', enrollment.id)
      .eq('state', 'active');
    return;
  }

  // 7. Variant-aware message_data (same merge RPC as campaign sends), with
  //    reply threading on top. Subject is the thread's, never the node's.
  const baseMessageData = {
    source: 'campaign_reply',
    node_config: node.node_data || {},
    lead_data: {
      email: lead.email,
      name: lead.name,
      first_name: lead.first_name,
      last_name: lead.last_name,
    },
    thread_id: thread.id,
    subject: buildReplySubject(thread.subject),
    to_email: lead.email,
    to_name: lead.name || '',
    in_reply_to: latestInbound.message_id,
    message_references: referencesHeader || latestInbound.message_id,
  };

  const { data: mergeRows, error: mergeError } = await supabase.rpc(
    'merge_email_variant_into_message_job',
    {
      p_campaign_id: enrollment.campaign_id,
      p_node_id: node.id,
      p_lead_data: baseMessageData.lead_data,
      p_base_message_data: baseMessageData,
    },
  );

  if (mergeError) {
    throw mergeError;
  }

  const merged = (Array.isArray(mergeRows) ? mergeRows[0] : mergeRows) as
    | { merged_message_data?: Record<string, unknown>; chosen_variant_id?: string | null }
    | null;
  // The merge RPC rebuilds message_data (node_config/variant/lead_data only),
  // so the reply threading fields must be re-applied on top.
  const messageData = {
    ...(merged?.merged_message_data ?? {}),
    source: baseMessageData.source,
    thread_id: baseMessageData.thread_id,
    subject: baseMessageData.subject,
    to_email: baseMessageData.to_email,
    to_name: baseMessageData.to_name,
    in_reply_to: baseMessageData.in_reply_to,
    message_references: baseMessageData.message_references,
    lead_data:
      (merged?.merged_message_data as { lead_data?: Record<string, unknown> } | undefined)
        ?.lead_data ?? baseMessageData.lead_data,
    node_config:
      (merged?.merged_message_data as { node_config?: Record<string, unknown> } | undefined)
        ?.node_config ?? baseMessageData.node_config,
  };
  const variantId = merged?.chosen_variant_id ?? null;

  // 8. Create the campaign_reply job: priority lane, no interval, no jitter,
  //    NOW clamped to the campaign schedule window.
  const scheduledAt = calculateNextRunAt(new Date(), context.schedule);

  const { error: insertError } = await supabase.from('message_jobs').insert({
    enrollment_id: enrollment.id,
    campaign_id: enrollment.campaign_id,
    account_id: thread.account_id,
    lead_id: enrollment.lead_id,
    mailbox_id: thread.mailbox_id,
    node_id: node.id,
    interval_id: null,
    message_type: 'campaign_reply',
    status: 'queued',
    status_reason: null,
    scheduled_at: scheduledAt,
    message_data: messageData,
    variant_id: variantId,
    flow_version_number: context.activeFlowVersionNumber,
  });

  if (insertError) {
    throw insertError;
  }

  mailboxUnavailableWarned.delete(enrollment.id);
  console.log(
    `[REPLY EMAIL ${enrollmentTag}] campaign_reply job created for thread ${thread.id.substring(0, 8)} (mailbox ${thread.mailbox_id.substring(0, 8)}, scheduled ${scheduledAt}).`,
  );

  await updateEnrollmentAtNode(supabase, enrollment, node, context, new Date().toISOString());
}

async function updateEnrollmentAtNode(
  supabase: SupabaseClient,
  enrollment: Enrollment,
  node: any,
  context: ReplyEmailHandlerContext,
  nextRunAt: string,
): Promise<void> {
  const { error } = await supabase
    .from('enrollments')
    .update({
      current_node_id: node.id,
      current_flow_version_number: context.activeFlowVersionNumber,
      next_run_at: nextRunAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id)
    .eq('state', 'active');

  if (error) {
    throw error;
  }
}

/** Mailbox unavailable: park at the node with a 6h self-heal retry. */
async function deferMailboxUnavailable(
  supabase: SupabaseClient,
  enrollment: Enrollment,
  node: any,
  context: ReplyEmailHandlerContext,
  reason: string,
): Promise<void> {
  if (!mailboxUnavailableWarned.has(enrollment.id)) {
    mailboxUnavailableWarned.add(enrollment.id);
    reportErrorToSlack('Scheduler: reply email thread mailbox unavailable (retrying every 6h)', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      node_id: node.id,
      error: reason,
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: `campaign-reply-mailbox:${enrollment.campaign_id}`,
      summaryFields: {
        campaign_id: enrollment.campaign_id,
      },
    });
  }

  await updateEnrollmentAtNode(
    supabase,
    enrollment,
    node,
    context,
    new Date(Date.now() + MAILBOX_UNAVAILABLE_RETRY_MS).toISOString(),
  );
}
