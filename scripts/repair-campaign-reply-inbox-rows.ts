/**
 * Preview or repair sent `campaign_reply` jobs that never produced the
 * corresponding `email_messages` row used by Master Inbox.
 *
 * Usage:
 *   npx tsx scripts/repair-campaign-reply-inbox-rows.ts
 *   CAMPAIGN_ID=<uuid> npx tsx scripts/repair-campaign-reply-inbox-rows.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true npx tsx scripts/repair-campaign-reply-inbox-rows.ts
 *   SELF_RECOVERY_TARGET_ENV=prod CAMPAIGN_ID=<uuid> npx tsx scripts/repair-campaign-reply-inbox-rows.ts
 *
 * Resolution order:
 *   1. Load repo `.env.local` / `.env` plus `infra/workers/.env.local` / `.env`
 *   2. Resolve Supabase URL from explicit env, then prod worker env, then dev env
 *   3. Prefer `SUPABASE_SECRET_KEY_PARAM_PATH` (or derive it from worker SSM prefixes)
 *   4. Fall back to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
 */

import { buildCampaignEmailContent } from '../lib/email/buildCampaignEmailContent.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type ReplyJobRow = {
  id: string;
  campaign_id: string;
  enrollment_id: string;
  lead_id: string;
  mailbox_id: string;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  message_data: Record<string, any> | null;
};

type EmailMessageRow = {
  id: string;
  thread_id: string;
  message_job_id: string | null;
  message_id: string | null;
  body_text?: string | null;
  body_html?: string | null;
  received_at?: string | null;
  from_email?: string | null;
  to_email?: string | null;
  cc?: string[] | null;
};

type ThreadRow = {
  id: string;
  account_id: string;
  participants: string[] | null;
};

type LeadRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
};

type MailboxRow = {
  id: string;
  email_address: string;
  display_name: string | null;
  signature: string | null;
};

type SentEventRow = {
  message_job_id: string | null;
  event_data: {
    sent_subject?: string | null;
    sent_body_html?: string | null;
    sent_body_text?: string | null;
  } | null;
};

type RepairMode = 'insert' | 'fill_content' | 'relink';

function toDisplayName(lead: LeadRow | undefined): string | null {
  if (!lead) {
    return null;
  }
  if (lead.name?.trim()) {
    return lead.name.trim();
  }
  const combined = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim();
  return combined || null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function messageBodyIsEmpty(row: EmailMessageRow | null | undefined): boolean {
  if (!row) {
    return false;
  }
  return !row.body_text?.trim() && !row.body_html?.trim();
}

function previewBody(bodyText: string, bodyHtml: string | null): string {
  const source = bodyText.trim() || bodyHtml?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  if (!source) {
    return '(empty)';
  }
  return source.length > 120 ? `${source.slice(0, 117)}...` : source;
}

function resolveReplyBody(
  messageData: Record<string, any>,
  lead: LeadRow,
  eventData: SentEventRow['event_data'],
  mailboxSignature: string | null,
): { bodyText: string; bodyHtml: string | null; source: string } {
  const sentHtml = eventData?.sent_body_html?.trim();
  const sentText = eventData?.sent_body_text?.trim();
  if (sentHtml || sentText) {
    return {
      bodyHtml: sentHtml ?? null,
      bodyText: sentText || sentHtml || '',
      source: 'events.sent_body_*',
    };
  }

  const topText = typeof messageData.body_text === 'string' ? messageData.body_text.trim() : '';
  const topHtml = typeof messageData.body_html === 'string' ? messageData.body_html.trim() : '';
  if (topText || topHtml) {
    return {
      bodyHtml: topHtml || null,
      bodyText: topText || topHtml,
      source: 'message_data.body_*',
    };
  }

  const nodeConfig = (messageData.node_config ?? {}) as Record<string, unknown>;
  const leadData = (messageData.lead_data ?? {}) as Record<string, unknown>;
  try {
    const content = buildCampaignEmailContent(
      {
        subject: typeof nodeConfig.subject === 'string' ? nodeConfig.subject : undefined,
        body_html: typeof nodeConfig.body_html === 'string' ? nodeConfig.body_html : undefined,
        body_text: typeof nodeConfig.body_text === 'string' ? nodeConfig.body_text : undefined,
        template: typeof nodeConfig.template === 'string' ? nodeConfig.template : undefined,
        body: typeof nodeConfig.body === 'string' ? nodeConfig.body : undefined,
        editor_mode: nodeConfig.editor_mode as 'html' | 'text' | undefined,
        signature: mailboxSignature ?? undefined,
      },
      {
        email: lead.email,
        name: lead.name,
        first_name: lead.first_name,
        last_name: lead.last_name,
        ...leadData,
      },
      { deterministic: true },
    );
    return {
      bodyHtml: content.isHtmlBody ? content.bodyMerged : null,
      bodyText: content.bodyText,
      source: 'rendered node_config',
    };
  } catch {
    const fallback =
      (typeof nodeConfig.body === 'string' && nodeConfig.body) ||
      (typeof nodeConfig.template === 'string' && nodeConfig.template) ||
      (typeof nodeConfig.body_html === 'string' && nodeConfig.body_html) ||
      (typeof nodeConfig.body_text === 'string' && nodeConfig.body_text) ||
      '';
    return {
      bodyHtml: fallback.includes('<') ? fallback : null,
      bodyText: fallback,
      source: 'node_config fallback',
    };
  }
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const campaignId = process.env.CAMPAIGN_ID?.trim() || null;
  const apply = process.env.APPLY === 'true';
  const limit = Number(process.env.LIMIT || '500');
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);

  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
      process.env.SUPABASE_SECRET_KEY = key;
    } catch (error) {
      if (!key) {
        throw error;
      }
      console.warn(
        `[repair-campaign-reply-inbox-rows] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
      );
    }
  }

  if (!url || !key) {
    console.error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.',
    );
    process.exit(1);
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  if (secretParamPath) {
    console.log(`Resolved SUPABASE secret from Parameter Store path ${secretParamPath}.`);
  } else {
    console.log('Resolved SUPABASE secret from environment variable.');
  }
  if (campaignId) {
    console.log(`Campaign scope: ${campaignId}`);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  let jobsQuery = supabase
    .from('message_jobs')
    .select('id, campaign_id, enrollment_id, lead_id, mailbox_id, provider_message_id, sent_at, created_at, message_data')
    .eq('message_type', 'campaign_reply')
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (campaignId) {
    jobsQuery = jobsQuery.eq('campaign_id', campaignId);
  }

  const { data: jobs, error: jobsError } = await jobsQuery;
  if (jobsError) {
    console.error('Failed to load sent campaign_reply jobs:', jobsError.message);
    process.exit(1);
  }

  const replyJobs = (jobs ?? []) as ReplyJobRow[];
  if (replyJobs.length === 0) {
    console.log('No sent campaign_reply jobs found.');
    return;
  }

  const jobIds = replyJobs.map((job) => job.id);
  const providerMessageIds = replyJobs
    .map((job) => job.provider_message_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const [{ data: byJobRows, error: byJobError }, { data: byProviderRows, error: byProviderError }, { data: sentEvents, error: sentEventsError }] =
    await Promise.all([
    supabase
      .from('email_messages')
      .select('id, thread_id, message_job_id, message_id, body_text, body_html, received_at')
      .in('message_job_id', jobIds),
    providerMessageIds.length > 0
      ? supabase
          .from('email_messages')
          .select('id, thread_id, message_job_id, message_id, body_text, body_html, received_at')
          .in('message_id', providerMessageIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('events')
      .select('message_job_id, event_data')
      .eq('event_type', 'sent')
      .in('message_job_id', jobIds),
  ]);

  if (byJobError) {
    console.error('Failed to load email_messages by message_job_id:', byJobError.message);
    process.exit(1);
  }
  if (byProviderError) {
    console.error('Failed to load email_messages by provider message id:', byProviderError.message);
    process.exit(1);
  }
  if (sentEventsError) {
    console.error('Failed to load sent events:', sentEventsError.message);
    process.exit(1);
  }

  const byJobId = new Map<string, EmailMessageRow>((byJobRows ?? []).map((row) => [row.message_job_id!, row as EmailMessageRow]));
  const byProviderId = new Map<string, EmailMessageRow>(
    (byProviderRows ?? [])
      .filter((row: any) => typeof row.message_id === 'string' && row.message_id.length > 0)
      .map((row: any) => [row.message_id as string, row as EmailMessageRow]),
  );

  const eventByJobId = new Map<string, SentEventRow['event_data']>(
    (sentEvents ?? [])
      .filter((row): row is SentEventRow => typeof row.message_job_id === 'string' && row.message_job_id.length > 0)
      .map((row) => [row.message_job_id!, row.event_data]),
  );

  const candidates = replyJobs
    .map((job) => {
      const messageData = (job.message_data ?? {}) as Record<string, any>;
      const threadId = typeof messageData.thread_id === 'string' ? messageData.thread_id : null;
      const existingByJob = byJobId.get(job.id) ?? null;
      const existingByProvider = job.provider_message_id ? byProviderId.get(job.provider_message_id) ?? null : null;

      let mode: RepairMode | null = null;
      if (!threadId) {
        mode = null;
      } else if (!existingByJob && existingByProvider) {
        mode = 'relink';
      } else if (!existingByJob) {
        mode = 'insert';
      } else if (messageBodyIsEmpty(existingByJob)) {
        mode = 'fill_content';
      }

      return {
        job,
        messageData,
        threadId,
        existingByJob,
        existingByProvider,
        mode,
        eventData: eventByJobId.get(job.id) ?? null,
      };
    })
    .filter((candidate): candidate is typeof candidate & { threadId: string; mode: RepairMode } =>
      Boolean(candidate.threadId && candidate.mode),
    );

  if (candidates.length === 0) {
    console.log(`Checked ${replyJobs.length} sent campaign_reply jobs. No missing or empty inbox rows found.`);
    return;
  }

  const threadIds = [...new Set(candidates.map((candidate) => candidate.threadId!))];
  const leadIds = [...new Set(candidates.map((candidate) => candidate.job.lead_id))];
  const mailboxIds = [...new Set(candidates.map((candidate) => candidate.job.mailbox_id))];

  const [{ data: threads, error: threadsError }, { data: leads, error: leadsError }, { data: mailboxes, error: mailboxesError }] =
    await Promise.all([
      supabase.from('email_threads').select('id, account_id, participants').in('id', threadIds),
      supabase.from('leads').select('id, email, first_name, last_name, name').in('id', leadIds),
      supabase.from('mailboxes').select('id, email_address, display_name, signature').in('id', mailboxIds),
    ]);

  if (threadsError) {
    console.error('Failed to load email_threads:', threadsError.message);
    process.exit(1);
  }
  if (leadsError) {
    console.error('Failed to load leads:', leadsError.message);
    process.exit(1);
  }
  if (mailboxesError) {
    console.error('Failed to load mailboxes:', mailboxesError.message);
    process.exit(1);
  }

  const threadById = new Map<string, ThreadRow>((threads ?? []).map((row) => [row.id, row as ThreadRow]));
  const leadById = new Map<string, LeadRow>((leads ?? []).map((row) => [row.id, row as LeadRow]));
  const mailboxById = new Map<string, MailboxRow>((mailboxes ?? []).map((row) => [row.id, row as MailboxRow]));

  const repairable = candidates.filter((candidate) => {
    return Boolean(
      candidate.threadId &&
        threadById.get(candidate.threadId) &&
        leadById.get(candidate.job.lead_id) &&
        mailboxById.get(candidate.job.mailbox_id),
    );
  });

  const skipped = candidates.filter((candidate) => !repairable.includes(candidate));

  console.log(`Scanned sent campaign_reply jobs: ${replyJobs.length}`);
  console.log(`Missing, relink, or empty-content inbox rows: ${candidates.length}`);
  console.log(`Repairable candidates: ${repairable.length}`);
  console.log(`Skipped candidates: ${skipped.length}`);

  const preview = repairable.slice(0, 10).map((candidate) => {
    const lead = leadById.get(candidate.job.lead_id)!;
    const mailbox = mailboxById.get(candidate.job.mailbox_id)!;
    const resolvedBody = resolveReplyBody(
      candidate.messageData,
      lead,
      candidate.eventData,
      mailbox.signature,
    );
    return {
      message_job_id: candidate.job.id,
      campaign_id: candidate.job.campaign_id,
      enrollment_id: candidate.job.enrollment_id,
      thread_id: candidate.threadId,
      mode: candidate.mode,
      provider_message_id: candidate.job.provider_message_id,
      relink_existing_message_id: candidate.existingByProvider?.id ?? null,
      sent_at: candidate.job.sent_at,
      subject: candidate.messageData.subject ?? null,
      body_source: resolvedBody.source,
      body_preview: previewBody(resolvedBody.bodyText, resolvedBody.bodyHtml),
    };
  });
  console.log('Preview:');
  console.log(JSON.stringify(preview, null, 2));

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to repair missing Master Inbox rows.');
    return;
  }

  const touchedThreadIds = new Set<string>();
  let inserted = 0;
  let relinked = 0;
  let filledContent = 0;

  for (const candidate of repairable) {
    const thread = threadById.get(candidate.threadId!)!;
    const lead = leadById.get(candidate.job.lead_id)!;
    const mailbox = mailboxById.get(candidate.job.mailbox_id)!;
    const recordedAt = candidate.job.sent_at ?? candidate.job.created_at;
    const resolvedBody = resolveReplyBody(
      candidate.messageData,
      lead,
      candidate.eventData,
      mailbox.signature,
    );

    if (candidate.mode === 'fill_content' && candidate.existingByJob) {
      const { error } = await supabase
        .from('email_messages')
        .update({
          body_text: resolvedBody.bodyText,
          body_html: resolvedBody.bodyHtml,
        })
        .eq('id', candidate.existingByJob.id);

      if (error) {
        console.error(`Failed to fill email_message body for ${candidate.existingByJob.id}: ${error.message}`);
        process.exit(1);
      }

      filledContent += 1;
      touchedThreadIds.add(candidate.threadId!);
      continue;
    }

    if (candidate.mode === 'relink' && candidate.existingByProvider) {
      const updatePayload: Record<string, unknown> = {
        message_job_id: candidate.job.id,
      };
      if (messageBodyIsEmpty(candidate.existingByProvider)) {
        updatePayload.body_text = resolvedBody.bodyText;
        updatePayload.body_html = resolvedBody.bodyHtml;
      }

      const { error } = await supabase
        .from('email_messages')
        .update(updatePayload)
        .eq('id', candidate.existingByProvider.id);

      if (error) {
        console.error(`Failed to relink email_message ${candidate.existingByProvider.id}: ${error.message}`);
        process.exit(1);
      }

      relinked += 1;
      if (updatePayload.body_text || updatePayload.body_html) {
        filledContent += 1;
      }
      touchedThreadIds.add(candidate.threadId!);
      continue;
    }

    const insertPayload = {
      thread_id: candidate.threadId,
      account_id: thread.account_id,
      message_job_id: candidate.job.id,
      direction: 'sent',
      from_email: mailbox.email_address,
      from_name: mailbox.display_name,
      to_email: candidate.messageData.to_email ?? lead.email,
      to_name: candidate.messageData.to_name ?? toDisplayName(lead),
      cc: asStringArray(candidate.messageData.cc),
      subject: candidate.messageData.subject ?? '(No subject)',
      body_text: resolvedBody.bodyText,
      body_html: resolvedBody.bodyHtml,
      message_id: candidate.job.provider_message_id,
      in_reply_to: candidate.messageData.in_reply_to ?? null,
      message_references: candidate.messageData.message_references ?? null,
      received_at: recordedAt,
      attachments: null,
    };

    const { error } = await supabase.from('email_messages').insert(insertPayload);
    if (error) {
      console.error(`Failed to insert repaired email_message for ${candidate.job.id}: ${error.message}`);
      process.exit(1);
    }

    inserted += 1;
    touchedThreadIds.add(candidate.threadId!);
  }

  const touchedThreads = [...touchedThreadIds];
  if (touchedThreads.length > 0) {
    const [{ data: allThreadMessages, error: allThreadMessagesError }, { data: currentThreads, error: currentThreadsError }] =
      await Promise.all([
        supabase
          .from('email_messages')
          .select('id, thread_id, received_at, from_email, to_email, cc')
          .in('thread_id', touchedThreads),
        supabase
          .from('email_threads')
          .select('id, participants')
          .in('id', touchedThreads),
      ]);

    if (allThreadMessagesError) {
      console.error('Failed to reload repaired thread messages:', allThreadMessagesError.message);
      process.exit(1);
    }
    if (currentThreadsError) {
      console.error('Failed to reload repaired threads:', currentThreadsError.message);
      process.exit(1);
    }

    const threadRowsById = new Map<string, { participants: string[] | null }>(
      (currentThreads ?? []).map((row: any) => [row.id, row]),
    );
    const messagesByThread = new Map<string, EmailMessageRow[]>();
    for (const row of (allThreadMessages ?? []) as EmailMessageRow[]) {
      const list = messagesByThread.get(row.thread_id) ?? [];
      list.push(row);
      messagesByThread.set(row.thread_id, list);
    }

    for (const threadId of touchedThreads) {
      const messages = messagesByThread.get(threadId) ?? [];
      const participants = new Set<string>(threadRowsById.get(threadId)?.participants ?? []);
      let lastMessageAt: string | null = null;

      for (const message of messages) {
        if (message.from_email) {
          participants.add(message.from_email);
        }
        if (message.to_email) {
          participants.add(message.to_email);
        }
        for (const cc of message.cc ?? []) {
          if (cc) {
            participants.add(cc);
          }
        }
        if (message.received_at && (!lastMessageAt || Date.parse(message.received_at) > Date.parse(lastMessageAt))) {
          lastMessageAt = message.received_at;
        }
      }

      const { error } = await supabase
        .from('email_threads')
        .update({
          message_count: messages.length,
          last_message_at: lastMessageAt,
          participants: [...participants],
          updated_at: new Date().toISOString(),
        })
        .eq('id', threadId);

      if (error) {
        console.error(`Failed to repair email_thread ${threadId}: ${error.message}`);
        process.exit(1);
      }
    }
  }

  console.log(`Inserted missing rows: ${inserted}`);
  console.log(`Relinked existing rows: ${relinked}`);
  console.log(`Filled empty message bodies: ${filledContent}`);
  console.log(`Updated threads: ${touchedThreads.length}`);
}

main();
