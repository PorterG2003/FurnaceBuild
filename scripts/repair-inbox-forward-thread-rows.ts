/**
 * Preview or repair sent `inbox_forward` jobs that never produced the
 * corresponding `email_messages` row used by Master Inbox.
 *
 * Usage:
 *   npx tsx scripts/repair-inbox-forward-thread-rows.ts
 *   APPLY=true npx tsx scripts/repair-inbox-forward-thread-rows.ts
 *   LIMIT=1000 APPLY=true npx tsx scripts/repair-inbox-forward-thread-rows.ts
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/repair-inbox-forward-thread-rows.ts
 */

import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type ForwardJobRow = {
  id: string;
  account_id: string;
  mailbox_id: string;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
  message_data: Record<string, unknown> | null;
};

type EmailMessageRow = {
  id: string;
  thread_id: string;
  message_job_id: string | null;
  message_id: string | null;
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

type MailboxRow = {
  id: string;
  email_address: string;
  display_name: string | null;
};

type RepairMode = 'insert' | 'relink';

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function buildAttachmentMetadata(
  value: unknown
): Array<{ filename: string; contentType: string; size: number }> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const attachments = value
    .map((item) => {
      const att = item as {
        filename?: string;
        contentType?: string;
        content_type?: string;
        content?: string;
      };
      const content = typeof att.content === 'string' ? att.content : '';
      if (!content) {
        return null;
      }
      return {
        filename: att.filename ?? 'attachment',
        contentType: att.contentType ?? att.content_type ?? 'application/octet-stream',
        size: Buffer.from(content, 'base64').length,
      };
    })
    .filter((item): item is { filename: string; contentType: string; size: number } => item != null);
  return attachments.length > 0 ? attachments : null;
}

function previewBody(bodyText: string, bodyHtml: string | null): string {
  const source = bodyText.trim() || bodyHtml?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  if (!source) {
    return '(empty)';
  }
  return source.length > 120 ? `${source.slice(0, 117)}...` : source;
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const apply = process.env.APPLY === 'true';
  const limit = Number(process.env.LIMIT || '1000');
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
        `[repair-inbox-forward-thread-rows] Failed to fetch ${secretParamPath}; falling back to existing secret env.`,
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

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const { data: jobs, error: jobsError } = await supabase
    .from('message_jobs')
    .select('id, account_id, mailbox_id, provider_message_id, sent_at, created_at, message_data')
    .eq('message_type', 'inbox_forward')
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (jobsError) {
    console.error('Failed to load sent inbox_forward jobs:', jobsError.message);
    process.exit(1);
  }

  const forwardJobs = (jobs ?? []) as ForwardJobRow[];
  if (forwardJobs.length === 0) {
    console.log('No sent inbox_forward jobs found.');
    return;
  }

  const jobIds = forwardJobs.map((job) => job.id);
  const providerMessageIds = forwardJobs
    .map((job) => job.provider_message_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const [{ data: byJobRows, error: byJobError }, { data: byProviderRows, error: byProviderError }] =
    await Promise.all([
      supabase
        .from('email_messages')
        .select('id, thread_id, message_job_id, message_id, received_at')
        .in('message_job_id', jobIds),
      providerMessageIds.length > 0
        ? supabase
            .from('email_messages')
            .select('id, thread_id, message_job_id, message_id, received_at')
            .in('message_id', providerMessageIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (byJobError) {
    console.error('Failed to load email_messages by message_job_id:', byJobError.message);
    process.exit(1);
  }
  if (byProviderError) {
    console.error('Failed to load email_messages by provider message id:', byProviderError.message);
    process.exit(1);
  }

  const byJobId = new Map<string, EmailMessageRow>((byJobRows ?? []).map((row) => [row.message_job_id!, row as EmailMessageRow]));
  const byProviderId = new Map<string, EmailMessageRow>(
    (byProviderRows ?? [])
      .filter((row: any) => typeof row.message_id === 'string' && row.message_id.length > 0)
      .map((row: any) => [row.message_id as string, row as EmailMessageRow]),
  );

  const candidates = forwardJobs
    .map((job) => {
      const messageData = (job.message_data ?? {}) as Record<string, unknown>;
      const threadId = typeof messageData.thread_id === 'string' ? messageData.thread_id : null;
      const existingByJob = byJobId.get(job.id) ?? null;
      const existingByProvider =
        job.provider_message_id ? byProviderId.get(job.provider_message_id) ?? null : null;

      let mode: RepairMode | null = null;
      if (!threadId) {
        mode = null;
      } else if (!existingByJob && existingByProvider) {
        mode = 'relink';
      } else if (!existingByJob) {
        mode = 'insert';
      }

      return {
        job,
        messageData,
        threadId,
        existingByJob,
        existingByProvider,
        mode,
      };
    })
    .filter((candidate): candidate is typeof candidate & { threadId: string; mode: RepairMode } =>
      Boolean(candidate.threadId && candidate.mode),
    );

  if (candidates.length === 0) {
    console.log(`Checked ${forwardJobs.length} sent inbox_forward jobs. No missing inbox rows found.`);
    return;
  }

  const threadIds = [...new Set(candidates.map((candidate) => candidate.threadId))];
  const mailboxIds = [...new Set(candidates.map((candidate) => candidate.job.mailbox_id))];

  const [{ data: threads, error: threadsError }, { data: mailboxes, error: mailboxesError }] =
    await Promise.all([
      supabase.from('email_threads').select('id, account_id, participants').in('id', threadIds),
      supabase.from('mailboxes').select('id, email_address, display_name').in('id', mailboxIds),
    ]);

  if (threadsError) {
    console.error('Failed to load email_threads:', threadsError.message);
    process.exit(1);
  }
  if (mailboxesError) {
    console.error('Failed to load mailboxes:', mailboxesError.message);
    process.exit(1);
  }

  const threadById = new Map<string, ThreadRow>((threads ?? []).map((row) => [row.id, row as ThreadRow]));
  const mailboxById = new Map<string, MailboxRow>((mailboxes ?? []).map((row) => [row.id, row as MailboxRow]));

  const repairable = candidates.filter((candidate) => {
    return Boolean(threadById.get(candidate.threadId) && mailboxById.get(candidate.job.mailbox_id));
  });
  const skipped = candidates.filter((candidate) => !repairable.includes(candidate));

  console.log(`Scanned sent inbox_forward jobs: ${forwardJobs.length}`);
  console.log(`Repair candidates: ${candidates.length}`);
  console.log(`Repairable candidates: ${repairable.length}`);
  console.log(`Skipped candidates: ${skipped.length}`);

  const modeCounts = repairable.reduce<Record<RepairMode, number>>(
    (acc, candidate) => {
      acc[candidate.mode] += 1;
      return acc;
    },
    { insert: 0, relink: 0 },
  );
  console.log('Repair mode counts:', modeCounts);

  const preview = repairable.slice(0, 10).map((candidate) => {
    const bodyText =
      typeof candidate.messageData.body_text === 'string' ? candidate.messageData.body_text : '';
    const bodyHtml =
      typeof candidate.messageData.body_html === 'string' ? candidate.messageData.body_html : null;
    return {
      message_job_id: candidate.job.id,
      thread_id: candidate.threadId,
      mode: candidate.mode,
      provider_message_id: candidate.job.provider_message_id,
      relink_existing_message_id: candidate.existingByProvider?.id ?? null,
      sent_at: candidate.job.sent_at,
      to_email: candidate.messageData.to_email ?? null,
      subject: candidate.messageData.subject ?? null,
      body_preview: previewBody(bodyText, bodyHtml),
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

  for (const candidate of repairable) {
    const thread = threadById.get(candidate.threadId)!;
    const mailbox = mailboxById.get(candidate.job.mailbox_id)!;
    const recordedAt = candidate.job.sent_at ?? candidate.job.created_at;
    const bodyText =
      typeof candidate.messageData.body_text === 'string' ? candidate.messageData.body_text : '';
    const bodyHtml =
      typeof candidate.messageData.body_html === 'string'
        ? candidate.messageData.body_html
        : bodyText || null;

    if (candidate.mode === 'relink' && candidate.existingByProvider) {
      const { error } = await supabase
        .from('email_messages')
        .update({
          message_job_id: candidate.job.id,
        })
        .eq('id', candidate.existingByProvider.id);

      if (error) {
        console.error(`Failed to relink email_message ${candidate.existingByProvider.id}: ${error.message}`);
        process.exit(1);
      }

      relinked += 1;
      touchedThreadIds.add(candidate.threadId);
      continue;
    }

    const insertPayload = {
      thread_id: candidate.threadId,
      account_id: thread.account_id,
      message_job_id: candidate.job.id,
      direction: 'sent',
      from_email: mailbox.email_address,
      from_name: mailbox.display_name,
      to_email: typeof candidate.messageData.to_email === 'string' ? candidate.messageData.to_email : '',
      to_name: typeof candidate.messageData.to_name === 'string' ? candidate.messageData.to_name : null,
      cc: asStringArray(candidate.messageData.cc),
      subject: typeof candidate.messageData.subject === 'string' ? candidate.messageData.subject : '(No subject)',
      body_text: bodyText,
      body_html: bodyHtml,
      message_id: candidate.job.provider_message_id,
      in_reply_to: null,
      message_references: null,
      received_at: recordedAt,
      attachments: buildAttachmentMetadata(candidate.messageData.attachments),
    };

    const { error } = await supabase.from('email_messages').insert(insertPayload);
    if (error) {
      console.error(`Failed to insert repaired email_message for ${candidate.job.id}: ${error.message}`);
      process.exit(1);
    }

    inserted += 1;
    touchedThreadIds.add(candidate.threadId);
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
  console.log(`Updated threads: ${touchedThreads.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
