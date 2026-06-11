/**
 * Preview or repair sent `campaign_reply` jobs that never produced the
 * corresponding `email_messages` row used by Master Inbox.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-campaign-reply-inbox-rows.ts
 *   CAMPAIGN_ID=<uuid> SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-campaign-reply-inbox-rows.ts
 *   CAMPAIGN_ID=<uuid> APPLY=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/repair-campaign-reply-inbox-rows.ts
 */

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
};

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

async function main() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const campaignId = process.env.CAMPAIGN_ID?.trim() || null;
  const apply = process.env.APPLY === 'true';
  const limit = Number(process.env.LIMIT || '500');

  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).');
    process.exit(1);
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

  const [{ data: byJobRows, error: byJobError }, { data: byProviderRows, error: byProviderError }] = await Promise.all([
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

  const candidates = replyJobs
    .map((job) => {
      const messageData = (job.message_data ?? {}) as Record<string, any>;
      const threadId = typeof messageData.thread_id === 'string' ? messageData.thread_id : null;
      const existingByJob = byJobId.get(job.id) ?? null;
      const existingByProvider = job.provider_message_id ? byProviderId.get(job.provider_message_id) ?? null : null;
      return {
        job,
        messageData,
        threadId,
        existingByJob,
        existingByProvider,
      };
    })
    .filter((candidate) => candidate.threadId && !candidate.existingByJob);

  if (candidates.length === 0) {
    console.log(`Checked ${replyJobs.length} sent campaign_reply jobs. No missing inbox rows found.`);
    return;
  }

  const threadIds = [...new Set(candidates.map((candidate) => candidate.threadId!))];
  const leadIds = [...new Set(candidates.map((candidate) => candidate.job.lead_id))];
  const mailboxIds = [...new Set(candidates.map((candidate) => candidate.job.mailbox_id))];

  const [{ data: threads, error: threadsError }, { data: leads, error: leadsError }, { data: mailboxes, error: mailboxesError }] =
    await Promise.all([
      supabase.from('email_threads').select('id, account_id, participants').in('id', threadIds),
      supabase.from('leads').select('id, email, first_name, last_name, name').in('id', leadIds),
      supabase.from('mailboxes').select('id, email_address, display_name').in('id', mailboxIds),
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
  console.log(`Missing or unlinked inbox rows: ${candidates.length}`);
  console.log(`Repairable candidates: ${repairable.length}`);
  console.log(`Skipped candidates: ${skipped.length}`);

  const preview = repairable.slice(0, 10).map((candidate) => ({
    message_job_id: candidate.job.id,
    campaign_id: candidate.job.campaign_id,
    enrollment_id: candidate.job.enrollment_id,
    thread_id: candidate.threadId,
    provider_message_id: candidate.job.provider_message_id,
    relink_existing_message_id: candidate.existingByProvider?.id ?? null,
    sent_at: candidate.job.sent_at,
    subject: candidate.messageData.subject ?? null,
  }));
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
    const thread = threadById.get(candidate.threadId!)!;
    const lead = leadById.get(candidate.job.lead_id)!;
    const mailbox = mailboxById.get(candidate.job.mailbox_id)!;
    const recordedAt = candidate.job.sent_at ?? candidate.job.created_at;

    if (candidate.existingByProvider) {
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
      body_text: candidate.messageData.body_text ?? candidate.messageData.body_html ?? '',
      body_html: candidate.messageData.body_html ?? null,
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
  console.log(`Updated threads: ${touchedThreads.length}`);
}

main();
