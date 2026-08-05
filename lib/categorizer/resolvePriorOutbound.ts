import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeMessageId } from '../email/threadHeaders';
import { resolveClassifyBody } from './resolveClassifyBody';
import type { CategorizerMessageSnippet } from './types';

export type CampaignFamilyMessageType = 'campaign' | 'campaign_priority' | 'campaign_reply';

const INBOX_MESSAGE_TYPES = new Set(['inbox_reply', 'inbox_forward']);

export function isCampaignFamilyMessageType(
  messageType: string | null | undefined,
): boolean {
  if (messageType == null || messageType === '') return true;
  if (INBOX_MESSAGE_TYPES.has(messageType)) return false;
  return (
    messageType === 'campaign' ||
    messageType === 'campaign_priority' ||
    messageType === 'campaign_reply'
  );
}

type SentMessageRow = {
  id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  message_id: string | null;
  message_job_id: string | null;
  received_at: string | null;
  message_jobs: { message_type: string | null } | { message_type: string | null }[] | null;
};

function jobMessageType(row: SentMessageRow): string | null {
  const jobs = row.message_jobs;
  if (!jobs) return null;
  if (Array.isArray(jobs)) return jobs[0]?.message_type ?? null;
  return jobs.message_type ?? null;
}

function toSnippet(row: SentMessageRow): CategorizerMessageSnippet {
  return {
    subject: row.subject,
    bodyText: resolveClassifyBody({
      body_text: row.body_text,
      body_html: row.body_html,
    }),
  };
}

function collectHeaderCandidates(params: {
  inReplyTo: string | null;
  referenceMessageIds: string[] | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const normalized = normalizeMessageId(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };
  push(params.inReplyTo);
  for (const id of params.referenceMessageIds ?? []) {
    push(id);
  }
  return out;
}

/**
 * Resolve the campaign CTA outbound for categorizer context.
 * Never prefers inbox_reply / inbox_forward. Omit rather than guess a human send.
 *
 * Order: In-Reply-To / References (campaign-family) → latest campaign-family
 * sent before the reply → thread root job sent row → omit.
 */
export async function resolvePriorOutbound(
  supabase: SupabaseClient,
  params: {
    threadId: string;
    inbound: {
      receivedAt: string | null;
      inReplyTo: string | null;
      referenceMessageIds: string[] | null;
    };
    threadMessageJobId: string | null;
  },
): Promise<CategorizerMessageSnippet | null> {
  const headerIds = collectHeaderCandidates({
    inReplyTo: params.inbound.inReplyTo,
    referenceMessageIds: params.inbound.referenceMessageIds,
  });

  if (headerIds.length > 0) {
    const { data: headerRows, error: headerError } = await supabase
      .from('email_messages')
      .select(
        'id, subject, body_text, body_html, message_id, message_job_id, received_at, message_jobs(message_type)',
      )
      .eq('thread_id', params.threadId)
      .eq('direction', 'sent')
      .in('message_id', headerIds);
    if (headerError) throw headerError;

    const byMessageId = new Map<string, SentMessageRow>();
    for (const row of (headerRows ?? []) as SentMessageRow[]) {
      const mid = normalizeMessageId(row.message_id);
      if (mid) byMessageId.set(mid, row);
    }
    for (const candidateId of headerIds) {
      const hit = byMessageId.get(candidateId);
      if (!hit) continue;
      if (!isCampaignFamilyMessageType(jobMessageType(hit))) continue;
      return toSnippet(hit);
    }
  }

  let latestQuery = supabase
    .from('email_messages')
    .select(
      'id, subject, body_text, body_html, message_id, message_job_id, received_at, message_jobs(message_type)',
    )
    .eq('thread_id', params.threadId)
    .eq('direction', 'sent')
    .order('received_at', { ascending: false })
    .limit(20);

  if (params.inbound.receivedAt) {
    latestQuery = latestQuery.lte('received_at', params.inbound.receivedAt);
  }

  const { data: latestRows, error: latestError } = await latestQuery;
  if (latestError) throw latestError;

  for (const row of (latestRows ?? []) as SentMessageRow[]) {
    if (!isCampaignFamilyMessageType(jobMessageType(row))) continue;
    return toSnippet(row);
  }

  if (params.threadMessageJobId) {
    const { data: rootJob, error: rootJobError } = await supabase
      .from('message_jobs')
      .select('id, message_type')
      .eq('id', params.threadMessageJobId)
      .maybeSingle();
    if (rootJobError) throw rootJobError;

    if (rootJob && isCampaignFamilyMessageType(rootJob.message_type as string | null)) {
      const { data: rootMessage, error: rootMessageError } = await supabase
        .from('email_messages')
        .select(
          'id, subject, body_text, body_html, message_id, message_job_id, received_at, message_jobs(message_type)',
        )
        .eq('thread_id', params.threadId)
        .eq('direction', 'sent')
        .eq('message_job_id', params.threadMessageJobId)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rootMessageError) throw rootMessageError;
      if (rootMessage) return toSnippet(rootMessage as SentMessageRow);
    }
  }

  return null;
}
