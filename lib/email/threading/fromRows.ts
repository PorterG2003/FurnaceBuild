import { isThreadContinuingSubject } from '../followUpSubject.js';
import type { LeadLike } from '../mergeTemplate.js';
import { pickWireMessageId } from '../threadHeaders.js';
import { resolveDeliveredSubject } from './subject.js';
import { buildThreadTimeline } from './timeline.js';
import type { ThreadTimelineEntry, ThreadTimelineInput } from './types.js';

/**
 * Mapping from stored rows to timeline entries.
 *
 * Kept pure and free of any database client so the send worker, the inbox
 * checker, and repair scripts all derive the same timeline from the same rows.
 */

/** A sent campaign-family row from message_jobs. */
export type SentJobRow = {
  id: string;
  provider_message_id?: string | null;
  submitted_message_id?: string | null;
  sent_at?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
  message_data?: Record<string, any> | null;
};

/** A row from email_messages, either direction. */
export type ThreadMessageRow = {
  id: string;
  direction: 'sent' | 'received';
  message_id?: string | null;
  subject?: string | null;
  received_at?: string | null;
  reference_message_ids?: string[] | null;
  message_references?: string | null;
  conversation_root_message_id?: string | null;
  message_job_id?: string | null;
};

export type BuildTimelineFromRowsInput = {
  sentJobs?: SentJobRow[];
  threadMessages?: ThreadMessageRow[];
  /** Sent-event subjects by message job id, for legacy jobs missing sent_subject. */
  eventSentSubjectByJobId?: Map<string, string | null>;
  /** Used only to deterministically render a template when nothing else survives. */
  lead?: LeadLike | null;
};

/**
 * Build the epoch-tagged timeline for one conversation from both stored views.
 *
 * A campaign send exists as a message_job the moment it goes out and gains an
 * email_messages row later when reply backfill runs, so the two sources overlap;
 * buildThreadTimeline merges them by Message-ID.
 */
export function buildTimelineFromRows(
  input: BuildTimelineFromRowsInput,
): ThreadTimelineEntry[] {
  const inputs: ThreadTimelineInput[] = [
    ...(input.sentJobs ?? []).map((job) =>
      sentJobToTimelineInput(job, {
        eventSentSubject: input.eventSentSubjectByJobId?.get(job.id) ?? null,
        lead: input.lead,
      }),
    ),
    ...(input.threadMessages ?? []).map(threadMessageToTimelineInput),
  ];

  return buildThreadTimeline(inputs);
}

export function sentJobToTimelineInput(
  job: SentJobRow,
  options?: { eventSentSubject?: string | null; lead?: LeadLike | null },
): ThreadTimelineInput {
  const messageData = job.message_data ?? {};
  const nodeConfig = (messageData.node_config ?? {}) as Record<string, unknown>;
  const subjectTemplate = String(nodeConfig.subject ?? nodeConfig.template ?? '');

  return {
    wireMessageId: pickWireMessageId({
      providerMessageId: job.provider_message_id ?? null,
      submittedMessageId: job.submitted_message_id ?? messageData.submitted_message_id ?? null,
    }),
    direction: 'sent',
    at: job.sent_at ?? job.scheduled_at ?? job.created_at ?? null,
    deliveredSubject: resolveDeliveredSubject({
      eventSentSubject: options?.eventSentSubject ?? null,
      messageDataSentSubject: messageData.sent_subject ?? null,
      messageDataSubject: messageData.subject ?? null,
      nodeConfigSubject: subjectTemplate,
      lead: options?.lead ?? null,
    }),
    subjectTemplate,
    // A send carrying its own real subject opened a new client-side conversation.
    startsEpoch: !isThreadContinuingSubject(subjectTemplate),
    conversationRootMessageId: messageData.conversation_root_message_id ?? null,
    messageJobId: job.id,
    referenceMessageIds:
      messageData.reference_message_ids ?? messageData.message_references ?? null,
  };
}

export function threadMessageToTimelineInput(row: ThreadMessageRow): ThreadTimelineInput {
  return {
    wireMessageId: row.message_id ?? null,
    direction: row.direction,
    at: row.received_at ?? null,
    // Stored row subjects are already delivered values, not templates.
    deliveredSubject: row.subject ?? '',
    // Only the job row knows the node template, so a row never opens an epoch on
    // its own; it inherits the epoch of whatever preceded it.
    startsEpoch: false,
    conversationRootMessageId: row.conversation_root_message_id ?? null,
    emailMessageId: row.id,
    messageJobId: row.message_job_id ?? null,
    referenceMessageIds: row.reference_message_ids ?? row.message_references ?? null,
  };
}
