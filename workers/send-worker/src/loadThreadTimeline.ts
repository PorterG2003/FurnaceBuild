import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildTimelineFromRows,
  type LeadLike,
  type SentJobRow,
  type ThreadMessageRow,
  type ThreadTimelineEntry,
} from '../../../lib/email/dist/index.js';

/**
 * Raised when a source the timeline depends on cannot be read.
 *
 * Threading must fail loudly rather than degrade: an empty read looks exactly
 * like a brand-new conversation, so a swallowed error sends a live follow-up
 * unthreaded and with the wrong subject. A thrown error defers the job instead,
 * which is recoverable. Notably this is how a schema drift would present — a
 * worker deployed ahead of its migration gets `42703 column does not exist`.
 */
export class ThreadTimelineLoadError extends Error {
  constructor(
    readonly source: string,
    cause: { code?: string; message?: string } | null,
  ) {
    super(
      `Failed to load ${source} for thread timeline: ${cause?.code ?? 'unknown'} ${cause?.message ?? ''}`.trim(),
    );
    this.name = 'ThreadTimelineLoadError';
  }
}

/**
 * Load the full conversation timeline for a campaign lead.
 *
 * Two stored views describe the same conversation and neither is complete on its
 * own: message_jobs has every send the moment it goes out, and email_messages has
 * the inbound replies plus backfilled copies of sends. Threading needs both,
 * because the parent of a follow-up is frequently an inbound reply.
 */
export async function loadThreadTimeline(params: {
  supabase: SupabaseClient<any>;
  /** Campaign lead, for sends that predate any thread row. */
  campaignId?: string | null;
  leadId?: string | null;
  /** Known thread, when the job already carries one (priority and inbox replies do). */
  threadId?: string | null;
  lead?: LeadLike | null;
}): Promise<ThreadTimelineEntry[]> {
  const sentJobs =
    params.campaignId && params.leadId
      ? await loadSentCampaignJobs(params.supabase, params.campaignId, params.leadId)
      : [];

  const threadId =
    params.threadId ??
    (params.campaignId && params.leadId
      ? await resolveThreadId(params.supabase, params.campaignId, params.leadId)
      : null);

  const [threadMessages, eventSentSubjectByJobId] = await Promise.all([
    threadId ? loadThreadMessages(params.supabase, threadId) : Promise.resolve([]),
    loadSentEventSubjects(
      params.supabase,
      sentJobs.map((job) => job.id),
    ),
  ]);

  return buildTimelineFromRows({
    sentJobs,
    threadMessages,
    eventSentSubjectByJobId,
    lead: params.lead ?? null,
  });
}

async function loadSentCampaignJobs(
  supabase: SupabaseClient<any>,
  campaignId: string,
  leadId: string,
): Promise<SentJobRow[]> {
  const { data, error } = await supabase
    .from('message_jobs')
    .select('id, provider_message_id, submitted_message_id, message_data, sent_at, scheduled_at, created_at')
    .eq('campaign_id', campaignId)
    .eq('lead_id', leadId)
    .eq('status', 'sent')
    .or(
      'message_type.is.null,message_type.eq.campaign,message_type.eq.campaign_priority,message_type.eq.campaign_reply',
    )
    .order('sent_at', { ascending: true, nullsFirst: false })
    .order('scheduled_at', { ascending: true });

  if (error) throw new ThreadTimelineLoadError('message_jobs', error);
  return (data ?? []) as SentJobRow[];
}

async function loadThreadMessages(
  supabase: SupabaseClient<any>,
  threadId: string,
): Promise<ThreadMessageRow[]> {
  const { data, error } = await supabase
    .from('email_messages')
    .select(
      'id, direction, message_id, subject, received_at, reference_message_ids, message_references, conversation_root_message_id, message_job_id',
    )
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (error) throw new ThreadTimelineLoadError('email_messages', error);
  return (data ?? []) as ThreadMessageRow[];
}

/**
 * Sent-event subjects for legacy jobs finalized before sent_subject was persisted
 * on the job row. One batched query replaces the old per-job lookup.
 */
async function loadSentEventSubjects(
  supabase: SupabaseClient<any>,
  jobIds: string[],
): Promise<Map<string, string | null>> {
  const byJobId = new Map<string, string | null>();
  if (jobIds.length === 0) return byJobId;

  const { data, error } = await supabase
    .from('events')
    .select('message_job_id, event_data, created_at')
    .in('message_job_id', jobIds)
    .eq('event_type', 'sent')
    .order('created_at', { ascending: true });

  if (error || !data) return byJobId;

  for (const row of data as Array<{ message_job_id: string; event_data?: Record<string, unknown> }>) {
    if (!row.message_job_id || byJobId.has(row.message_job_id)) continue;
    const sentSubject = row.event_data?.sent_subject;
    byJobId.set(row.message_job_id, typeof sentSubject === 'string' ? sentSubject : null);
  }

  return byJobId;
}

/** The sticky thread for this campaign lead, if one exists yet. */
async function resolveThreadId(
  supabase: SupabaseClient<any>,
  campaignId: string,
  leadId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // A read failure must not look like "no thread yet", which would send a
  // follow-up as a fresh conversation.
  if (error) throw new ThreadTimelineLoadError('email_threads', error);
  if (!data) return null;
  return (data as { id: string }).id;
}
