/**
 * Read-only IMAP audit: cross-check inbound messages against June Training
 * sent jobs (provider_message_id) and Furnace ingestion state.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npm run audit:june-training-replies -- \
 *     --campaign-id 3d6a8efa-c7b0-42e0-8550-56865ef4da9e \
 *     --since 2026-06-09 \
 *     --output docs/audit/june-training/03-imap-results.json
 *
 *   --dry-run   list mailboxes only
 *   --limit N   scan first N mailboxes (for testing)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { openImapInbox } from '@furnace/mailbox-lib';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import pLimit from 'p-limit';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const DEFAULT_CAMPAIGN_ID = '3d6a8efa-c7b0-42e0-8550-56865ef4da9e';

type HeaderClass =
  | 'in_reply_to'
  | 'references_only'
  | 'headerless_reply_like'
  | 'headerless_other'
  | 'not_reply_like';

type ReplyBucket =
  | 'ingested'
  | 'missed_matchable'
  | 'unmatchable_no_headers'
  | 'unmatchable_no_job'
  | 'unrelated';

type MailboxRow = {
  id: string;
  account_id: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
};

type SentJob = {
  id: string;
  enrollment_id: string;
  mailbox_id: string;
  provider_message_id: string;
  normalized_ids: string[];
};

type AuditedMessage = {
  mailboxEmail: string;
  mailboxId: string;
  uid: number;
  subject: string;
  from: string;
  date: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  referencesPreview: string | null;
  headerClass: HeaderClass;
  bucket: ReplyBucket;
  matchedJobId: string | null;
  matchedEnrollmentId: string | null;
  searchIds: string[];
};

type Args = {
  campaignId: string;
  since: Date;
  until: Date | null;
  outputPath: string;
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
};

function parseArgs(argv: string[]): Args {
  let campaignId = process.env.CAMPAIGN_ID?.trim() || DEFAULT_CAMPAIGN_ID;
  let sinceStr = process.env.AUDIT_SINCE?.trim() || '2026-06-09';
  let untilStr = process.env.AUDIT_UNTIL?.trim() || null;
  let outputPath =
    process.env.AUDIT_OUTPUT?.trim() ||
    'docs/audit/june-training/03-imap-results.json';
  let dryRun = false;
  let limit: number | null = null;
  let concurrency = Number(process.env.AUDIT_CONCURRENCY ?? '5');

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--campaign-id' && argv[i + 1]) {
      campaignId = argv[++i]!;
    } else if (arg === '--since' && argv[i + 1]) {
      sinceStr = argv[++i]!;
    } else if (arg === '--until' && argv[i + 1]) {
      untilStr = argv[++i]!;
    } else if (arg === '--output' && argv[i + 1]) {
      outputPath = argv[++i]!;
    } else if (arg === '--limit' && argv[i + 1]) {
      limit = Number(argv[++i]);
    } else if (arg === '--concurrency' && argv[i + 1]) {
      concurrency = Number(argv[++i]);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return {
    campaignId,
    since: new Date(`${sinceStr}T00:00:00.000Z`),
    until: untilStr ? new Date(`${untilStr}T23:59:59.999Z`) : null,
    outputPath,
    dryRun,
    limit,
    concurrency,
  };
}

function normalizeMessageId(messageId: string | null | undefined): string | null {
  if (!messageId) return null;
  return messageId.trim().replace(/^<|>$/g, '').toLowerCase() || null;
}

function extractSearchIds(inReplyTo: string | null, references: string | null): string[] {
  const ids: string[] = [];
  const inNorm = normalizeMessageId(inReplyTo);
  if (inNorm) ids.push(inNorm);

  if (references) {
    for (const part of references.split(/\s+/)) {
      const norm = normalizeMessageId(part);
      if (norm && !ids.includes(norm)) ids.push(norm);
    }
  }
  return ids;
}

function looksLikeReplySubject(subject: string): boolean {
  const normalized = subject.trim().toLowerCase();
  return (
    normalized.startsWith('re:') ||
    normalized.startsWith('re ') ||
    normalized.startsWith('fwd:') ||
    normalized.startsWith('fw:')
  );
}

function classifyHeaders(input: {
  subject: string;
  inReplyTo: string | null;
  references: string | null;
}): HeaderClass {
  const hasInReplyTo = !!input.inReplyTo?.trim();
  const hasReferences = !!input.references?.trim();
  if (hasInReplyTo) return 'in_reply_to';
  if (hasReferences) return 'references_only';
  if (looksLikeReplySubject(input.subject)) return 'headerless_reply_like';
  return 'headerless_other';
}

function providerIdMatches(providerMessageId: string, searchId: string): boolean {
  const normProvider = normalizeMessageId(providerMessageId);
  if (!normProvider) return false;
  if (normProvider === searchId) return true;
  const lower = providerMessageId.toLowerCase();
  return lower.includes(searchId) || lower.includes(`<${searchId}>`);
}

function buildNormalizedIdsFromProvider(providerMessageId: string): string[] {
  const norm = normalizeMessageId(providerMessageId);
  return norm ? [norm] : [];
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
    secretSource: secretParamPath ? `Parameter Store ${secretParamPath}` : 'environment variable',
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function fetchCampaignMailboxes(
  supabase: SupabaseClient,
  campaignId: string,
  limit: number | null,
): Promise<MailboxRow[]> {
  const { data, error } = await supabase
    .from('campaign_mailboxes')
    .select(
      `
      mailbox_id,
      mailboxes!inner(
        id,
        account_id,
        email_address,
        imap_host,
        imap_port,
        imap_username,
        imap_password,
        imap_use_ssl,
        deleted_at,
        status
      )
    `,
    )
    .eq('campaign_id', campaignId);

  if (error) throw new Error(`Failed to load campaign mailboxes: ${error.message}`);

  const rows = (data ?? [])
    .map((row: any) => {
      const m = row.mailboxes;
      if (!m || m.deleted_at) return null;
      return {
        id: m.id as string,
        account_id: m.account_id as string,
        email_address: m.email_address as string,
        imap_host: m.imap_host as string,
        imap_port: m.imap_port as number,
        imap_username: m.imap_username as string,
        imap_password: m.imap_password as string,
        imap_use_ssl: m.imap_use_ssl as boolean,
      } satisfies MailboxRow;
    })
    .filter((m): m is MailboxRow => m != null)
    .sort((a, b) => a.email_address.localeCompare(b.email_address));

  return limit != null ? rows.slice(0, limit) : rows;
}

async function fetchSentJobs(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<SentJob[]> {
  const pageSize = 1000;
  const jobs: SentJob[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('message_jobs')
      .select('id, enrollment_id, mailbox_id, provider_message_id')
      .eq('campaign_id', campaignId)
      .eq('status', 'sent')
      .not('provider_message_id', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Failed to load message_jobs: ${error.message}`);
    const batch = data ?? [];
    for (const row of batch) {
      jobs.push({
        id: row.id,
        enrollment_id: row.enrollment_id,
        mailbox_id: row.mailbox_id,
        provider_message_id: row.provider_message_id!,
        normalized_ids: buildNormalizedIdsFromProvider(row.provider_message_id!),
      });
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return jobs;
}

async function fetchIngestedMessageIds(
  supabase: SupabaseClient,
  accountId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('email_messages')
      .select('message_id')
      .eq('account_id', accountId)
      .eq('direction', 'received')
      .not('message_id', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Failed to load email_messages: ${error.message}`);
    const batch = data ?? [];
    for (const row of batch) {
      const norm = normalizeMessageId(row.message_id);
      if (norm) ids.add(norm);
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return ids;
}

function findMatchingJob(
  jobs: SentJob[],
  mailboxId: string,
  searchIds: string[],
): SentJob | null {
  for (const searchId of searchIds) {
    const matches = jobs.filter(
      (job) =>
        job.mailbox_id === mailboxId &&
        providerIdMatches(job.provider_message_id, searchId),
    );
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      return matches.sort((a, b) => a.id.localeCompare(b.id))[0]!;
    }
  }
  return null;
}

function classifyAndBucket(input: {
  mailbox: MailboxRow;
  jobsByMailbox: Map<string, SentJob[]>;
  ingestedIds: Set<string>;
  subject: string;
  from: string;
  inReplyTo: string | null;
  references: string | null;
  messageId: string | null;
}): {
  headerClass: HeaderClass;
  bucket: ReplyBucket;
  searchIds: string[];
  matchedJob: SentJob | null;
} {
  const searchIds = extractSearchIds(input.inReplyTo, input.references);
  const headerClass = classifyHeaders({
    subject: input.subject,
    inReplyTo: input.inReplyTo,
    references: input.references,
  });
  const normalizedInboundId = normalizeMessageId(input.messageId);
  const mailboxJobs = input.jobsByMailbox.get(input.mailbox.id) ?? [];
  const matchedJob = findMatchingJob(mailboxJobs, input.mailbox.id, searchIds);

  let bucket: ReplyBucket;
  if (normalizedInboundId && input.ingestedIds.has(normalizedInboundId)) {
    bucket = 'ingested';
  } else if (matchedJob && searchIds.length > 0) {
    bucket = 'missed_matchable';
  } else if (searchIds.length === 0 && headerClass === 'headerless_reply_like') {
    bucket = 'unmatchable_no_headers';
  } else if (searchIds.length > 0 && !matchedJob) {
    bucket = 'unmatchable_no_job';
  } else {
    bucket = 'unrelated';
  }

  return { headerClass, bucket, searchIds, matchedJob };
}

async function auditMailbox(
  mailbox: MailboxRow,
  args: Args,
  jobsByMailbox: Map<string, SentJob[]>,
  ingestedIds: Set<string>,
): Promise<{ messages: AuditedMessage[]; errors: string[]; scanned: number }> {
  const mailboxTimeoutMs = Number(process.env.AUDIT_MAILBOX_TIMEOUT_MS ?? '180000');
  const auditPromise = auditMailboxInner(mailbox, args, jobsByMailbox, ingestedIds);
  const timeoutPromise = new Promise<{ messages: AuditedMessage[]; errors: string[]; scanned: number }>(
    (resolve) => {
      setTimeout(
        () =>
          resolve({
            messages: [],
            errors: [`Mailbox audit timed out after ${mailboxTimeoutMs}ms`],
            scanned: 0,
          }),
        mailboxTimeoutMs,
      );
    },
  );
  return Promise.race([auditPromise, timeoutPromise]);
}

async function auditMailboxInner(
  mailbox: MailboxRow,
  args: Args,
  jobsByMailbox: Map<string, SentJob[]>,
  ingestedIds: Set<string>,
): Promise<{ messages: AuditedMessage[]; errors: string[]; scanned: number }> {
  const messages: AuditedMessage[] = [];
  const errors: string[] = [];
  let scanned = 0;

  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_use_ssl,
    auth: {
      user: mailbox.imap_username,
      pass: mailbox.imap_password,
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 120_000,
  });
  client.on('error', (error) => {
    errors.push(error instanceof Error ? error.message : String(error));
  });

  const mailboxEmailNorm = mailbox.email_address.trim().toLowerCase();

  try {
    await client.connect();
    await openImapInbox(client);

    const uids = await client.search({ since: args.since }, { uid: true });
    const uidList = Array.isArray(uids) ? uids : [];

    for (const uid of uidList) {
      try {
        const fetched = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
        if (!fetched?.source) continue;

        const mail = await simpleParser(fetched.source as Buffer);
        const refs = mail.references;
        const referencesRaw =
          refs == null
            ? null
            : Array.isArray(refs)
              ? refs.filter(Boolean).join(' ')
              : String(refs);

        const fromAddress = mail.from?.value?.[0]?.address?.trim().toLowerCase() ?? '';
        if (!fromAddress || fromAddress === mailboxEmailNorm) continue;

        const msgDate = mail.date ?? null;
        if (args.until && msgDate && msgDate > args.until) continue;

        scanned += 1;

        const subject = mail.subject ?? '';
        const inReplyTo = mail.inReplyTo ?? null;
        const { headerClass, bucket, searchIds, matchedJob } = classifyAndBucket({
          mailbox,
          jobsByMailbox,
          ingestedIds,
          subject,
          from: fromAddress,
          inReplyTo,
          references: referencesRaw,
          messageId: mail.messageId ?? null,
        });

        // Only record reply-like or matchable buckets
        const isReplyLike =
          headerClass === 'in_reply_to' ||
          headerClass === 'references_only' ||
          headerClass === 'headerless_reply_like' ||
          bucket === 'missed_matchable' ||
          bucket === 'unmatchable_no_job';

        if (!isReplyLike) continue;

        messages.push({
          mailboxEmail: mailbox.email_address,
          mailboxId: mailbox.id,
          uid,
          subject: subject.slice(0, 200),
          from: fromAddress,
          date: msgDate?.toISOString() ?? null,
          messageId: normalizeMessageId(mail.messageId ?? null),
          inReplyTo: normalizeMessageId(inReplyTo),
          referencesPreview: referencesRaw ? referencesRaw.slice(0, 200) : null,
          headerClass,
          bucket,
          matchedJobId: matchedJob?.id ?? null,
          matchedEnrollmentId: matchedJob?.enrollment_id ?? null,
          searchIds,
        });
      } catch (error) {
        errors.push(`uid ${uid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }

  return { messages, errors, scanned };
}

function summarize(messages: AuditedMessage[]) {
  const bucketCounts: Record<ReplyBucket, number> = {
    ingested: 0,
    missed_matchable: 0,
    unmatchable_no_headers: 0,
    unmatchable_no_job: 0,
    unrelated: 0,
  };
  const headerCounts: Record<HeaderClass, number> = {
    in_reply_to: 0,
    references_only: 0,
    headerless_reply_like: 0,
    headerless_other: 0,
    not_reply_like: 0,
  };
  const byMailbox = new Map<string, Record<ReplyBucket, number>>();

  for (const msg of messages) {
    bucketCounts[msg.bucket] += 1;
    headerCounts[msg.headerClass] += 1;
    if (!byMailbox.has(msg.mailboxEmail)) {
      byMailbox.set(msg.mailboxEmail, {
        ingested: 0,
        missed_matchable: 0,
        unmatchable_no_headers: 0,
        unmatchable_no_job: 0,
        unrelated: 0,
      });
    }
    byMailbox.get(msg.mailboxEmail)![msg.bucket] += 1;
  }

  return { bucketCounts, headerCounts, byMailbox };
}

function toCsv(messages: AuditedMessage[]): string {
  const header =
    'mailbox,uid,from,date,subject,header_class,bucket,matched_job_id,message_id,in_reply_to';
  const rows = messages.map((m) =>
    [
      m.mailboxEmail,
      m.uid,
      m.from,
      m.date ?? '',
      `"${m.subject.replace(/"/g, '""')}"`,
      m.headerClass,
      m.bucket,
      m.matchedJobId ?? '',
      m.messageId ?? '',
      m.inReplyTo ?? '',
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { targetEnv, urlSource, secretSource, supabase } = await resolveSupabaseClient();

  console.log(`Target env: ${targetEnv}`);
  console.log(`Supabase URL from ${urlSource}`);
  console.log(`Supabase secret from ${secretSource}`);
  console.log(`Campaign: ${args.campaignId}`);
  console.log(`Since: ${args.since.toISOString()}`);
  if (args.until) console.log(`Until: ${args.until.toISOString()}`);

  const mailboxes = await fetchCampaignMailboxes(supabase, args.campaignId, args.limit);
  console.log(`Campaign mailboxes: ${mailboxes.length}`);

  if (args.dryRun) {
    for (const m of mailboxes) {
      console.log(`- ${m.email_address} (${m.imap_host})`);
    }
    return;
  }

  const sentJobs = await fetchSentJobs(supabase, args.campaignId);
  console.log(`Sent jobs loaded: ${sentJobs.length}`);

  const accountId = mailboxes[0]?.account_id;
  if (!accountId) throw new Error('No mailboxes found for campaign');

  const ingestedIds = await fetchIngestedMessageIds(supabase, accountId);
  console.log(`Ingested received message_ids: ${ingestedIds.size}`);

  const jobsByMailbox = new Map<string, SentJob[]>();
  for (const job of sentJobs) {
    const list = jobsByMailbox.get(job.mailbox_id) ?? [];
    list.push(job);
    jobsByMailbox.set(job.mailbox_id, list);
  }

  const limit = pLimit(args.concurrency);
  const allMessages: AuditedMessage[] = [];
  const mailboxResults: Array<{
    email: string;
    scanned: number;
    replyLike: number;
    missed: number;
    errors: string[];
  }> = [];

  await Promise.all(
    mailboxes.map((mailbox) =>
      limit(async () => {
        process.stdout.write(`Scanning ${mailbox.email_address}... `);
        const result = await auditMailbox(mailbox, args, jobsByMailbox, ingestedIds);
        allMessages.push(...result.messages);
        const missed = result.messages.filter((m) => m.bucket === 'missed_matchable').length;
        mailboxResults.push({
          email: mailbox.email_address,
          scanned: result.scanned,
          replyLike: result.messages.length,
          missed,
          errors: result.errors,
        });
        console.log(
          `${result.scanned} inbound, ${result.messages.length} reply-like, ${missed} missed${result.errors.length ? `, ${result.errors.length} err` : ''}`,
        );

        // Incremental checkpoint so a hung mailbox does not lose progress
        const checkpointPath = resolve(process.cwd(), args.outputPath.replace(/\.json$/, '-checkpoint.json'));
        mkdirSync(dirname(checkpointPath), { recursive: true });
        writeFileSync(
          checkpointPath,
          JSON.stringify(
            {
              updatedAt: new Date().toISOString(),
              completedMailboxes: mailboxResults.length,
              totalMailboxes: mailboxes.length,
              mailboxResults,
              messagesSoFar: allMessages.length,
              missedSoFar: allMessages.filter((m) => m.bucket === 'missed_matchable').length,
            },
            null,
            2,
          ),
        );
      }),
    ),
  );

  const summary = summarize(allMessages);
  const output = {
    generatedAt: new Date().toISOString(),
    campaignId: args.campaignId,
    since: args.since.toISOString(),
    until: args.until?.toISOString() ?? null,
    mailboxCount: mailboxes.length,
    sentJobsLoaded: sentJobs.length,
    summary: {
      bucketCounts: summary.bucketCounts,
      headerCounts: summary.headerCounts,
      byMailbox: Object.fromEntries(summary.byMailbox),
    },
    missedMatchable: allMessages.filter((m) => m.bucket === 'missed_matchable'),
    mailboxResults,
    allReplyLike: allMessages,
  };

  const outPath = resolve(process.cwd(), args.outputPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  const csvPath = outPath.replace(/\.json$/, '-summary.csv');
  writeFileSync(csvPath, toCsv(allMessages));

  console.log('\n=== IMAP audit summary ===');
  console.log(`Mailboxes scanned: ${mailboxes.length}`);
  console.log('Bucket counts:');
  for (const [key, value] of Object.entries(summary.bucketCounts)) {
    console.log(`- ${key}: ${value}`);
  }
  console.log(`\nResults written to:\n- ${outPath}\n- ${csvPath}`);

  if (summary.bucketCounts.missed_matchable >= 20) {
    console.log('\nRecommendation: STRONG case for last_synced_at backfill on campaign mailboxes.');
  } else if (summary.bucketCounts.missed_matchable >= 2) {
    console.log('\nRecommendation: Small outage gap; optional targeted backfill.');
  } else {
    console.log('\nRecommendation: No large matchable gap; low rate likely real or headerless.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
