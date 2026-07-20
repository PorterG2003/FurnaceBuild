import { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
import { calculateNextRunAt } from '../scheduling.js';
import type { CampaignSchedule, Enrollment } from '../types.js';

/**
 * Priority email node (node_data.priority === true, or legacy send_mode='reply'):
 * any email downstream of a categorizer. Creates a campaign_priority job on the
 * immediate lane (interval_id NULL), claimed ahead of paced campaign sends.
 *
 * Subject/threading are NOT special here — the send worker uses the normal
 * first-outbound rules (empty subject continues the thread; a subject is a
 * new client-side thread). No forced "Re:", no inbound In-Reply-To.
 *
 * Spec: docs/implementation/flow/CATEGORIZER_IMPLEMENTATION.md
 */

const MAILBOX_UNAVAILABLE_RETRY_MS = 6 * 60 * 60 * 1000;
const PRIORITY_MESSAGE_TYPES = ['campaign_priority', 'campaign_reply'] as const;

/** First-occurrence-per-enrollment guard for mailbox-unavailable warnings. */
const mailboxUnavailableWarned = new Set<string>();

/** Test seam: reset the warned-enrollments tracking. */
export function resetPriorityEmailWarningTracking(): void {
  mailboxUnavailableWarned.clear();
}

/** @deprecated Use resetPriorityEmailWarningTracking */
export const resetReplyEmailWarningTracking = resetPriorityEmailWarningTracking;

export interface PriorityEmailHandlerContext {
  schedule: CampaignSchedule | null;
  activeFlowVersionNumber: number;
}

type PriorityThread = {
  id: string;
  account_id: string;
  mailbox_id: string | null;
};

/** @deprecated Use PriorityEmailHandlerContext */
export type ReplyEmailHandlerContext = PriorityEmailHandlerContext;

export async function handlePriorityEmailNode(
  enrollment: Enrollment,
  node: any,
  supabase: SupabaseClient,
  context: PriorityEmailHandlerContext,
): Promise<void> {
  const enrollmentTag = enrollment.id.substring(0, 8);

  // 1. Idempotency: only arm a new attempt when none exists or the latest
  //    one was deferred. Accept both new and legacy message types.
  const { data: existingJobs, error: existingJobsError } = await supabase
    .from('message_jobs')
    .select('id, status, message_type')
    .eq('enrollment_id', enrollment.id)
    .eq('node_id', node.id)
    .in('message_type', [...PRIORITY_MESSAGE_TYPES])
    .order('created_at', { ascending: false })
    .limit(1);

  if (existingJobsError) {
    throw existingJobsError;
  }

  const latestJob = (existingJobs ?? [])[0] as { id: string; status: string } | undefined;
  if (latestJob && latestJob.status !== 'deferred') {
    console.log(
      `[PRIORITY EMAIL ${enrollmentTag}] Attempt already exists (${latestJob.status}). Updating position only.`,
    );
    await updateEnrollmentAtNode(supabase, enrollment, node, context, new Date().toISOString());
    return;
  }

  // 2. Load lead for mailbox fallback + variable merge.
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
    console.log(`[PRIORITY EMAIL ${enrollmentTag}] Lead deleted. Stopping enrollment.`);
    await supabase
      .from('enrollments')
      .update({
        state: 'stopped',
        stopped_reason: 'error',
        stopped_at: stoppedAt,
        stopped_error_message: 'Lead deleted before priority email could be sent',
        next_run_at: null,
        updated_at: stoppedAt,
      })
      .eq('id', enrollment.id)
      .eq('state', 'active');
    return;
  }

  // 3. Best-effort thread lookup (reply_thread_id, else campaign+lead) only to
  //    pick mailbox and stamp thread_id for Master Inbox recording.
  const { data: freshEnrollment, error: enrollmentError } = await supabase
    .from('enrollments')
    .select('reply_thread_id')
    .eq('id', enrollment.id)
    .maybeSingle();

  if (enrollmentError) {
    throw enrollmentError;
  }

  const replyThreadId = (freshEnrollment as { reply_thread_id: string | null } | null)
    ?.reply_thread_id;

  let thread: PriorityThread | null = null;

  if (replyThreadId) {
    const { data, error } = await supabase
      .from('email_threads')
      .select('id, account_id, mailbox_id')
      .eq('id', replyThreadId)
      .maybeSingle();
    if (error) throw error;
    thread = data as PriorityThread | null;
  }

  if (!thread) {
    const { data, error } = await supabase
      .from('email_threads')
      .select('id, account_id, mailbox_id')
      .eq('campaign_id', enrollment.campaign_id)
      .eq('lead_id', enrollment.lead_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    thread = data as PriorityThread | null;
  }

  const mailboxId =
    (thread?.mailbox_id && String(thread.mailbox_id)) ||
    (lead.mailbox_id && String(lead.mailbox_id)) ||
    null;

  if (!mailboxId) {
    console.warn(`[PRIORITY EMAIL ${enrollmentTag}] No mailbox available (thread or lead). Retrying in 6h.`);
    await deferMailboxUnavailable(supabase, enrollment, node, context, 'No mailbox for priority email');
    return;
  }

  const { data: mailbox, error: mailboxError } = await supabase
    .from('mailboxes')
    .select('id, account_id, status, smtp_status, deleted_at')
    .eq('id', mailboxId)
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
      ? 'Mailbox not found'
      : mailbox.deleted_at
        ? 'Mailbox deleted'
        : `Mailbox unavailable (status=${mailbox.status}, smtp=${mailbox.smtp_status})`;
    console.warn(`[PRIORITY EMAIL ${enrollmentTag}] ${reason}. Retrying in 6h.`);
    await deferMailboxUnavailable(supabase, enrollment, node, context, reason);
    return;
  }

  const accountId = thread?.account_id || mailbox.account_id;
  if (!accountId) {
    console.warn(`[PRIORITY EMAIL ${enrollmentTag}] No account_id for mailbox. Retrying in 6h.`);
    await deferMailboxUnavailable(supabase, enrollment, node, context, 'Mailbox missing account_id');
    return;
  }

  // 4. Variant-aware message_data (same merge RPC as paced campaign sends).
  //    Subject/threading are left to the send worker's normal path.
  const baseMessageData: Record<string, unknown> = {
    source: 'campaign_priority',
    node_config: node.node_data || {},
    lead_data: {
      email: lead.email,
      name: lead.name,
      first_name: lead.first_name,
      last_name: lead.last_name,
    },
    to_email: lead.email,
    to_name: lead.name || '',
    ...(thread?.id ? { thread_id: thread.id } : {}),
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

  const messageData = {
    ...(merged?.merged_message_data ?? {}),
    source: 'campaign_priority',
    to_email: baseMessageData.to_email,
    to_name: baseMessageData.to_name,
    ...(thread?.id ? { thread_id: thread.id } : {}),
    lead_data:
      (merged?.merged_message_data as { lead_data?: Record<string, unknown> } | undefined)
        ?.lead_data ?? baseMessageData.lead_data,
    node_config:
      (merged?.merged_message_data as { node_config?: Record<string, unknown> } | undefined)
        ?.node_config ?? baseMessageData.node_config,
  };
  const variantId = merged?.chosen_variant_id ?? null;

  // 5. Create the campaign_priority job: priority lane, no interval, no jitter,
  //    NOW clamped to the campaign schedule window.
  const scheduledAt = calculateNextRunAt(new Date(), context.schedule);

  const { error: insertError } = await supabase.from('message_jobs').insert({
    enrollment_id: enrollment.id,
    campaign_id: enrollment.campaign_id,
    account_id: accountId,
    lead_id: enrollment.lead_id,
    mailbox_id: mailboxId,
    node_id: node.id,
    interval_id: null,
    message_type: 'campaign_priority',
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
    `[PRIORITY EMAIL ${enrollmentTag}] campaign_priority job created` +
      (thread?.id ? ` for thread ${thread.id.substring(0, 8)}` : '') +
      ` (mailbox ${mailboxId.substring(0, 8)}, scheduled ${scheduledAt}).`,
  );

  await updateEnrollmentAtNode(supabase, enrollment, node, context, new Date().toISOString());
}

/** @deprecated Use handlePriorityEmailNode */
export const handleReplyEmailNode = handlePriorityEmailNode;

async function updateEnrollmentAtNode(
  supabase: SupabaseClient,
  enrollment: Enrollment,
  node: any,
  context: PriorityEmailHandlerContext,
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
  context: PriorityEmailHandlerContext,
  reason: string,
): Promise<void> {
  if (!mailboxUnavailableWarned.has(enrollment.id)) {
    mailboxUnavailableWarned.add(enrollment.id);
    reportErrorToSlack('Scheduler: priority email mailbox unavailable (retrying every 6h)', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      node_id: node.id,
      error: reason,
      alertPolicy: 'transient_retryable_warning',
      aggregationKey: `campaign-priority-mailbox:${enrollment.campaign_id}`,
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
