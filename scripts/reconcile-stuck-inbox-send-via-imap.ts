/**
 * One-off: reconcile a stuck inbox_reply/inbox_forward job by checking IMAP Sent.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/reconcile-stuck-inbox-send-via-imap.ts \
 *     --job-id <uuid> [--dry-run]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const DEFAULT_JOB_ID = '1c9f8b8f-ef8a-45a6-aebf-2baefb973bb2';

type Args = {
  jobId: string;
  dryRun: boolean;
};

type MessageJobRow = {
  id: string;
  status: string;
  mailbox_id: string;
  account_id: string;
  message_type: string;
  message_data: Record<string, unknown>;
  created_at: string;
  sending_started_at: string | null;
};

type MailboxRow = {
  id: string;
  email_address: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
};

type SentMatch = {
  uid: number;
  messageId: string | null;
  subject: string;
  to: string[];
  date: Date;
  matchedBy: 'x-message-id' | 'heuristic';
};

function parseArgs(argv: string[]): Args {
  let jobId = DEFAULT_JOB_ID;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--job-id' && argv[i + 1]) {
      jobId = argv[++i]!;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  return { jobId, dryRun };
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function collectAddressList(value: unknown): string[] {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  const emails: string[] = [];
  for (const entry of entries) {
    const addr =
      typeof entry === 'object' && entry != null && 'address' in entry
        ? normalizeEmail(String((entry as { address?: string }).address ?? ''))
        : null;
    if (addr) emails.push(addr);
  }
  return emails;
}

function getHeaderValue(headers: Map<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === target) {
      return value.trim() || null;
    }
  }
  return null;
}

async function resolveSupabaseClient() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
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
    key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
  }

  if (!url || !key) {
    throw new Error(
      'Missing Supabase configuration. Provide URL plus SSM prefix or SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return {
    targetEnv,
    urlSource,
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function resolveSentFolder(client: ImapFlow): Promise<string | null> {
  const candidates = [
    '[Gmail]/Sent Mail',
    'Sent',
    'Sent Mail',
    'Sent Items',
    'INBOX.Sent',
    'INBOX/Sent',
  ];
  for (const candidate of candidates) {
    try {
      await client.mailboxOpen(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  try {
    const listed = await client.list();
    for (const folder of listed) {
      const path = String(folder.path ?? '');
      const lower = path.toLowerCase();
      if (lower.includes('sent')) {
        try {
          await client.mailboxOpen(path);
          return path;
        } catch {
          // continue
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function findSentMessage(
  mailbox: MailboxRow,
  job: MessageJobRow,
): Promise<{ sentFolder: string; match: SentMatch } | null> {
  const md = job.message_data;
  const toEmail = normalizeEmail(String(md.to_email ?? ''));
  const subject = String(md.subject ?? '').trim();
  const since = new Date(job.created_at);
  since.setMinutes(since.getMinutes() - 10);

  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_use_ssl,
    auth: {
      user: mailbox.imap_username,
      pass: mailbox.imap_password,
    },
    logger: false,
  });

  await client.connect();
  try {
    const sentFolder = await resolveSentFolder(client);
    if (!sentFolder) {
      throw new Error(`Could not open Sent folder for ${mailbox.email_address}`);
    }

    const uids = await client.search({ since }, { uid: true });
    const uidList = Array.isArray(uids) ? uids : [];
    console.log(`[IMAP] Opened "${sentFolder}" — scanning ${uidList.length} message(s) since ${since.toISOString()}`);

    for (const uid of uidList) {
      const fetched = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
      if (!fetched?.source) continue;
      const mail = await simpleParser(fetched.source as Buffer);
      const xMessageId = getHeaderValue(mail.headers, 'x-message-id');
      if (xMessageId === job.id) {
        return {
          sentFolder,
          match: {
            uid,
            messageId: mail.messageId ?? null,
            subject: mail.subject ?? '(No subject)',
            to: collectAddressList(mail.to),
            date: mail.date ?? new Date(),
            matchedBy: 'x-message-id',
          },
        };
      }

      const parsedTo = collectAddressList(mail.to);
      const parsedSubject = (mail.subject ?? '').trim();
      const parsedDate = mail.date ?? new Date();
      const sendingStarted = job.sending_started_at ? new Date(job.sending_started_at) : since;
      const windowStart = new Date(sendingStarted.getTime() - 2 * 60 * 1000);
      const windowEnd = new Date(sendingStarted.getTime() + 30 * 60 * 1000);
      const inWindow = parsedDate >= windowStart && parsedDate <= windowEnd;
      const toMatches = toEmail != null && parsedTo.includes(toEmail);
      const subjectMatches =
        parsedSubject.toLowerCase() === subject.toLowerCase() ||
        parsedSubject.toLowerCase().includes(subject.toLowerCase().replace(/^re:\s*/i, ''));

      if (inWindow && toMatches && subjectMatches) {
        return {
          sentFolder,
          match: {
            uid,
            messageId: mail.messageId ?? null,
            subject: parsedSubject,
            to: parsedTo,
            date: parsedDate,
            matchedBy: 'heuristic',
          },
        };
      }
    }

    return null;
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

async function markJobFailed(supabase: SupabaseClient, jobId: string, reason: string, dryRun: boolean) {
  if (dryRun) {
    console.log(`[DRY RUN] Would mark job ${jobId} failed: ${reason}`);
    return;
  }
  const { error } = await supabase
    .from('message_jobs')
    .update({
      status: 'failed',
      status_reason: 'uncertain_send_state',
      error_message: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'sending');
  if (error) throw new Error(`Failed to mark job failed: ${error.message}`);
  console.log(`[DB] Marked job ${jobId} as failed`);
}

async function reconcileFoundSend(
  supabase: SupabaseClient,
  job: MessageJobRow,
  mailbox: MailboxRow,
  match: SentMatch,
  dryRun: boolean,
) {
  const md = job.message_data;
  const threadId = String(md.thread_id ?? '');
  if (!threadId) throw new Error('Job missing thread_id in message_data');

  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('participants, message_count, account_id')
    .eq('id', threadId)
    .single();
  if (threadError || !thread) {
    throw new Error(`Failed to load thread ${threadId}: ${threadError?.message}`);
  }

  const toEmail = String(md.to_email ?? '');
  const cc = Array.isArray(md.cc) ? (md.cc as string[]) : [];
  const participants = (thread.participants || []) as string[];
  const newParticipants = [...new Set([...participants, toEmail, ...cc].filter(Boolean))];
  const sentAt = match.date.toISOString();
  const providerMessageId = match.messageId ?? null;

  if (dryRun) {
    console.log('[DRY RUN] Would insert email_messages and mark job sent', {
      threadId,
      providerMessageId,
      sentAt,
      matchedBy: match.matchedBy,
    });
    return;
  }

  const { error: insertError } = await supabase.from('email_messages').insert({
    thread_id: threadId,
    account_id: thread.account_id,
    message_job_id: job.id,
    direction: 'sent',
    from_email: mailbox.email_address,
    from_name: mailbox.display_name,
    to_email: toEmail,
    to_name: (md.to_name as string) || null,
    to_emails: toEmail?.trim() ? [toEmail.trim()] : null,
    cc: cc.length > 0 ? cc : null,
    subject: String(md.subject ?? '(No subject)'),
    body_text: String(md.body_text ?? ''),
    body_html: (md.body_html as string) ?? String(md.body_text ?? ''),
    message_id: providerMessageId,
    in_reply_to: (md.in_reply_to as string) ?? null,
    message_references: (md.message_references as string) ?? null,
    received_at: sentAt,
    attachments: [],
  });
  if (insertError) {
    throw new Error(`Failed to insert email_messages: ${insertError.message}`);
  }

  const { error: updateThreadError } = await supabase
    .from('email_threads')
    .update({
      last_message_at: sentAt,
      message_count: (thread.message_count || 0) + 1,
      participants: newParticipants,
      updated_at: sentAt,
    })
    .eq('id', threadId);
  if (updateThreadError) {
    throw new Error(`Failed to update email_threads: ${updateThreadError.message}`);
  }

  const { error: updateJobError } = await supabase
    .from('message_jobs')
    .update({
      status: 'sent',
      status_reason: 'sent_successfully',
      sent_at: sentAt,
      provider_message_id: providerMessageId,
      updated_at: sentAt,
    })
    .eq('id', job.id)
    .eq('status', 'sending');
  if (updateJobError) {
    throw new Error(`Failed to mark job sent: ${updateJobError.message}`);
  }

  console.log(`[DB] Reconciled job ${job.id} as sent (matched by ${match.matchedBy})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { targetEnv, urlSource, supabase } = await resolveSupabaseClient();
  console.log(`Target env: ${targetEnv} (${urlSource})`);
  console.log(`Job: ${args.jobId}${args.dryRun ? ' [dry-run]' : ''}`);

  const { data: job, error: jobError } = await supabase
    .from('message_jobs')
    .select('id, status, mailbox_id, account_id, message_type, message_data, created_at, sending_started_at')
    .eq('id', args.jobId)
    .maybeSingle();
  if (jobError) throw new Error(`Failed to load job: ${jobError.message}`);
  if (!job) throw new Error(`Job not found: ${args.jobId}`);
  if (job.message_type !== 'inbox_reply' && job.message_type !== 'inbox_forward') {
    throw new Error(`Job type ${job.message_type} is not supported`);
  }
  if (job.status !== 'sending') {
    console.log(`Job status is already "${job.status}" — nothing to reconcile.`);
    return;
  }

  const { data: mailbox, error: mailboxError } = await supabase
    .from('mailboxes')
    .select('id, email_address, display_name, imap_host, imap_port, imap_username, imap_password, imap_use_ssl')
    .eq('id', job.mailbox_id)
    .single();
  if (mailboxError || !mailbox) {
    throw new Error(`Failed to load mailbox: ${mailboxError?.message}`);
  }

  const result = await findSentMessage(mailbox as MailboxRow, job as MessageJobRow);
  if (!result) {
    const reason =
      'IMAP Sent folder check found no matching outbound message; send likely did not complete.';
    console.log(`[IMAP] No match found in Sent folder for job ${args.jobId}`);
    await markJobFailed(supabase, args.jobId, reason, args.dryRun);
    return;
  }

  console.log('[IMAP] Match found', {
    sentFolder: result.sentFolder,
    uid: result.match.uid,
    matchedBy: result.match.matchedBy,
    messageId: result.match.messageId,
    subject: result.match.subject,
    date: result.match.date.toISOString(),
  });

  await reconcileFoundSend(
    supabase,
    job as MessageJobRow,
    mailbox as MailboxRow,
    result.match,
    args.dryRun,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
