/**
 * Read-only campaign send-integrity audit.
 *
 * Phase 1: DB reconciliation for campaign outbound jobs.
 * Phase 2: Optional IMAP Sent-folder verification with checkpoint/resume.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npm run audit:campaign-send-integrity -- \
 *     --campaign-id 3d6a8efa-c7b0-42e0-8550-56865ef4da9e \
 *     --since 2026-06-09 \
 *     --output tmp/audit/june-training/send-integrity-results.json
 *
 *   --dry-run       list mailboxes only
 *   --skip-imap     DB phase only
 *   --limit N       first N mailboxes for IMAP phase
 *   --checkpoint    explicit checkpoint path
 *   --resume-from   resume IMAP phase from checkpoint
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import pLimit from 'p-limit';
import {
  buildRecommendation,
  classifyDbJob,
  completedMailboxIdsFromResults,
  dedupeMailboxResults,
  heuristicMatchJobInSentEntries,
  isIncompleteMailboxResult,
  matchJobInSentIndex,
  normalizeMessageId,
  pickPreferredMailboxResult,
  summarizeDbBuckets,
  type CampaignJobSnapshot,
  type DbAnomalyBucket,
  type ImapMatchBucket,
  type ImapMatchMethod,
  type SentIndexEntry,
} from '../lib/audit/campaignSendIntegrity.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const LOG_PREFIX = '[send-integrity]';
const CHECKPOINT_KIND = 'send_integrity';
const CHECKPOINT_VERSION = 1;

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

type Args = {
  campaignId: string;
  since: Date;
  until: Date | null;
  outputPath: string;
  checkpointPath: string;
  resumeFromPath: string | null;
  dryRun: boolean;
  skipImap: boolean;
  limit: number | null;
  concurrency: number;
};

type DbJobRow = CampaignJobSnapshot;

type DbSampleRow = {
  message_job_id: string;
  bucket: DbAnomalyBucket;
  status: string;
  status_reason: string | null;
  mailbox_id: string;
  enrollment_id: string;
  lead_id: string;
  provider_message_id: string | null;
  sent_at: string | null;
};

type ImapJobResult = {
  message_job_id: string;
  mailbox_id: string;
  mailbox_email: string;
  status: string;
  status_reason: string | null;
  bucket: ImapMatchBucket;
  matched_by: ImapMatchMethod;
  provider_message_id: string | null;
  sent_at: string | null;
  imap_uid: number | null;
  imap_message_id: string | null;
};

type MailboxImapSummary = {
  mailbox_id: string;
  mailbox_email: string;
  sent_folder: string | null;
  scanned_sent_messages: number;
  jobs_checked: number;
  confirmed: number;
  missing_imap_match: number;
  uncertain_but_found: number;
  errors: string[];
};

type SendIntegrityCheckpoint = {
  kind: typeof CHECKPOINT_KIND;
  version: typeof CHECKPOINT_VERSION;
  generatedAt: string;
  updatedAt: string;
  campaignId: string;
  selectedMailboxIds: string[];
  args: {
    since: string;
    until: string | null;
    skipImap: boolean;
    concurrency: number;
  };
  dbPhaseComplete: boolean;
  dbSummary: Record<string, unknown>;
  dbSamples: DbSampleRow[];
  completedMailboxIds: string[];
  mailboxResults: MailboxImapSummary[];
  imapJobResults: ImapJobResult[];
  errors: string[];
};

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function parseArgs(argv: string[]): Args {
  let campaignId = process.env.CAMPAIGN_ID?.trim() || '3d6a8efa-c7b0-42e0-8550-56865ef4da9e';
  let sinceStr = process.env.AUDIT_SINCE?.trim() || '2026-06-09';
  let untilStr = process.env.AUDIT_UNTIL?.trim() || null;
  let outputPath =
    process.env.AUDIT_OUTPUT?.trim() ||
    'tmp/audit/june-training/send-integrity-results.json';
  let checkpointPath = process.env.AUDIT_CHECKPOINT?.trim() || '';
  let resumeFromPath = process.env.AUDIT_RESUME_FROM?.trim() || null;
  let explicitCheckpoint = Boolean(checkpointPath.trim());
  let dryRun = false;
  let skipImap = false;
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
    } else if (arg === '--checkpoint' && argv[i + 1]) {
      checkpointPath = argv[++i]!;
      explicitCheckpoint = true;
    } else if (arg === '--resume-from' && argv[i + 1]) {
      resumeFromPath = argv[++i]!;
    } else if (arg === '--limit' && argv[i + 1]) {
      limit = Number(argv[++i]);
    } else if (arg === '--concurrency' && argv[i + 1]) {
      concurrency = Number(argv[++i]);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--skip-imap') {
      skipImap = true;
    }
  }

  const resolvedOutput = resolve(process.cwd(), outputPath);
  const resolvedResume = resumeFromPath ? resolve(process.cwd(), resumeFromPath) : null;
  const resolvedCheckpoint = explicitCheckpoint
    ? resolve(process.cwd(), checkpointPath)
    : resolvedResume ?? resolvedOutput.replace(/\.json$/, '-checkpoint.json');

  return {
    campaignId,
    since: new Date(`${sinceStr}T00:00:00.000Z`),
    until: untilStr ? new Date(`${untilStr}T23:59:59.999Z`) : null,
    outputPath: resolvedOutput,
    checkpointPath: resolvedCheckpoint,
    resumeFromPath: resolvedResume,
    dryRun,
    skipImap,
    limit,
    concurrency,
  };
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
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
      const mailbox = row.mailboxes;
      if (!mailbox || mailbox.deleted_at) return null;
      return {
        id: mailbox.id as string,
        account_id: mailbox.account_id as string,
        email_address: mailbox.email_address as string,
        imap_host: mailbox.imap_host as string,
        imap_port: mailbox.imap_port as number,
        imap_username: mailbox.imap_username as string,
        imap_password: mailbox.imap_password as string,
        imap_use_ssl: mailbox.imap_use_ssl as boolean,
      } satisfies MailboxRow;
    })
    .filter((row): row is MailboxRow => row != null)
    .sort((a, b) => a.email_address.localeCompare(b.email_address));

  return limit != null ? rows.slice(0, limit) : rows;
}

async function fetchCampaignJobs(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<DbJobRow[]> {
  const pageSize = 1000;
  const jobs: DbJobRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('message_jobs')
      .select(
        'id, status, status_reason, mailbox_id, enrollment_id, lead_id, provider_message_id, sent_at, sending_started_at, created_at, message_data',
      )
      .eq('campaign_id', campaignId)
      .eq('message_type', 'campaign')
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Failed to load campaign message_jobs: ${error.message}`);
    const batch = (data ?? []) as DbJobRow[];
    jobs.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return jobs;
}

function initDbBucketCounts(): Record<DbAnomalyBucket, number> {
  return {
    healthy_sent: 0,
    sent_missing_provider_id: 0,
    sent_missing_sent_at: 0,
    failed_uncertain_send_state: 0,
    stale_sending: 0,
    stale_reserved: 0,
    other_non_sent: 0,
  };
}

function jobInDateWindow(job: DbJobRow, since: Date, until: Date | null): boolean {
  const anchor = job.sent_at ?? job.sending_started_at ?? job.created_at;
  const anchorDate = new Date(anchor);
  if (anchorDate < since) return false;
  if (until && anchorDate > until) return false;
  return true;
}

async function runDbPhase(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<{
  jobs: DbJobRow[];
  bucketCounts: Record<DbAnomalyBucket, number>;
  samples: DbSampleRow[];
  campaignStats: Record<string, unknown> | null;
  statsDrift: number;
}> {
  log('Loading campaign jobs...');
  const jobs = await fetchCampaignJobs(supabase, campaignId);
  log(`Loaded ${jobs.length} campaign message_jobs.`);

  const bucketCounts = initDbBucketCounts();
  const samples: DbSampleRow[] = [];

  for (const job of jobs) {
    const bucket = classifyDbJob(job);
    bucketCounts[bucket] += 1;
    if (bucket !== 'healthy_sent' && bucket !== 'other_non_sent' && samples.length < 100) {
      samples.push({
        message_job_id: job.id,
        bucket,
        status: job.status,
        status_reason: job.status_reason,
        mailbox_id: job.mailbox_id,
        enrollment_id: job.enrollment_id,
        lead_id: job.lead_id,
        provider_message_id: job.provider_message_id,
        sent_at: job.sent_at,
      });
    }
  }

  const { data: stats, error: statsError } = await supabase
    .from('campaign_stats')
    .select('sent_count, replied_count, positive_reply_count, bounce_count, updated_at')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (statsError) {
    throw new Error(`Failed to load campaign_stats: ${statsError.message}`);
  }

  const sentCampaignJobs =
    bucketCounts.healthy_sent +
    bucketCounts.sent_missing_provider_id +
    bucketCounts.sent_missing_sent_at;
  const statsDrift = (stats?.sent_count ?? 0) - sentCampaignJobs;

  return {
    jobs,
    bucketCounts,
    samples,
    campaignStats: stats ?? null,
    statsDrift,
  };
}

function collectAddressList(value: unknown): string[] {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : [value];
  const emails: string[] = [];
  for (const entry of entries) {
    const addr =
      typeof entry === 'object' && entry != null && 'address' in entry
        ? String((entry as { address?: string }).address ?? '').trim().toLowerCase()
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
      if (path.toLowerCase().includes('sent')) {
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

async function buildSentIndex(
  mailbox: MailboxRow,
  since: Date,
  until: Date | null,
  options?: { shouldAbort?: () => boolean },
): Promise<{ sentFolder: string | null; entries: SentIndexEntry[]; errors: string[] }> {
  const errors: string[] = [];
  const entries: SentIndexEntry[] = [];

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

  await client.connect();
  try {
    const sentFolder = await resolveSentFolder(client);
    if (!sentFolder) {
      errors.push(`Could not open Sent folder for ${mailbox.email_address}`);
      return { sentFolder: null, entries, errors };
    }

    const uids = await client.search({ since }, { uid: true });
    const uidList = Array.isArray(uids) ? uids : [];

    for (const uid of uidList) {
      if (options?.shouldAbort?.()) break;
      try {
        const fetched = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
        if (!fetched?.source) continue;
        const mail = await simpleParser(fetched.source as Buffer);
        const msgDate = mail.date ?? null;
        if (until && msgDate && msgDate > until) continue;

        entries.push({
          uid,
          messageId: mail.messageId ?? null,
          normalizedMessageId: normalizeMessageId(mail.messageId ?? null),
          xMessageId: getHeaderValue(mail.headers, 'x-message-id'),
          subject: (mail.subject ?? '').trim(),
          toEmails: collectAddressList(mail.to),
          date: (msgDate ?? new Date()).toISOString(),
        });
      } catch (error) {
        errors.push(`uid ${uid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { sentFolder, entries, errors };
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

function indexSentEntries(entries: SentIndexEntry[]): {
  byXMessageId: Map<string, SentIndexEntry>;
  byProviderMessageId: Map<string, SentIndexEntry>;
} {
  const byXMessageId = new Map<string, SentIndexEntry>();
  const byProviderMessageId = new Map<string, SentIndexEntry>();

  for (const entry of entries) {
    if (entry.xMessageId && !byXMessageId.has(entry.xMessageId)) {
      byXMessageId.set(entry.xMessageId, entry);
    }
    if (entry.normalizedMessageId && !byProviderMessageId.has(entry.normalizedMessageId)) {
      byProviderMessageId.set(entry.normalizedMessageId, entry);
    }
  }

  return { byXMessageId, byProviderMessageId };
}

function upsertMailboxResult(
  checkpoint: SendIntegrityCheckpoint,
  summary: MailboxImapSummary,
): void {
  const index = checkpoint.mailboxResults.findIndex((row) => row.mailbox_id === summary.mailbox_id);
  if (index >= 0) {
    checkpoint.mailboxResults[index] = pickPreferredMailboxResult(
      summary,
      checkpoint.mailboxResults[index],
    );
  } else {
    checkpoint.mailboxResults.push(summary);
  }
}

function upsertMailboxImapResults(
  checkpoint: SendIntegrityCheckpoint,
  mailboxId: string,
  imapResults: ImapJobResult[],
): void {
  checkpoint.imapJobResults = checkpoint.imapJobResults.filter((row) => row.mailbox_id !== mailboxId);
  checkpoint.imapJobResults.push(...imapResults);
}

async function scanMailboxSentFolder(
  mailbox: MailboxRow,
  mailboxJobs: DbJobRow[],
  args: Pick<Args, 'since' | 'until'>,
  onProgress: {
    markComplete: (summary: MailboxImapSummary, imapResults: ImapJobResult[]) => Promise<void>;
    markIncomplete: (summary: MailboxImapSummary) => Promise<void>;
    completedCount: () => number;
    totalCount: number;
  },
): Promise<void> {
  const mailboxTimeoutMs = Number(process.env.AUDIT_MAILBOX_TIMEOUT_MS ?? '600000');
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = async (
    outcome: 'success' | 'timeout' | 'error',
    payload?: {
      summary?: MailboxImapSummary;
      imapResults?: ImapJobResult[];
      errorMessage?: string;
    },
  ) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);

    if (outcome === 'success' && payload?.summary) {
      const summary = payload.summary;
      if (isIncompleteMailboxResult(summary)) {
        await onProgress.markIncomplete(summary);
        log(
          `Done ${onProgress.completedCount()}/${onProgress.totalCount}: ${mailbox.email_address} — incomplete Sent scan (will retry on resume): scanned=${summary.scanned_sent_messages}, checked=${summary.jobs_checked}, confirmed=${summary.confirmed}, suspect=${summary.missing_imap_match}${summary.errors.length ? `, ${summary.errors.length} err` : ''}`,
        );
        return;
      }

      await onProgress.markComplete(payload.summary, payload.imapResults ?? []);
      log(
        `Done ${onProgress.completedCount()}/${onProgress.totalCount}: ${mailbox.email_address} — scanned=${summary.scanned_sent_messages}, checked=${summary.jobs_checked}, confirmed=${summary.confirmed}, suspect=${summary.missing_imap_match}${summary.errors.length ? `, ${summary.errors.length} err` : ''}`,
      );
      return;
    }

    const message =
      outcome === 'timeout'
        ? `Mailbox audit timed out after ${mailboxTimeoutMs}ms`
        : payload?.errorMessage ?? 'Mailbox audit failed';
    const summary: MailboxImapSummary = {
      mailbox_id: mailbox.id,
      mailbox_email: mailbox.email_address,
      sent_folder: payload?.summary?.sent_folder ?? null,
      scanned_sent_messages: payload?.summary?.scanned_sent_messages ?? 0,
      jobs_checked: mailboxJobs.length,
      confirmed: payload?.summary?.confirmed ?? 0,
      missing_imap_match: payload?.summary?.missing_imap_match ?? 0,
      uncertain_but_found: payload?.summary?.uncertain_but_found ?? 0,
      errors: [message, ...(payload?.summary?.errors ?? [])],
    };
    await onProgress.markIncomplete(summary);
    log(
      `Done ${onProgress.completedCount()}/${onProgress.totalCount}: ${mailbox.email_address} — ${outcome === 'timeout' ? 'timed out (will retry on resume)' : 'failed'}`,
    );
  };

  timer = setTimeout(() => {
    void finish('timeout');
  }, mailboxTimeoutMs);

  try {
    const { sentFolder, entries, errors } = await buildSentIndex(
      mailbox,
      args.since,
      args.until,
      { shouldAbort: () => settled },
    );
    if (settled) return;

    const index = indexSentEntries(entries);
    let confirmed = 0;
    let missingImapMatch = 0;
    let uncertainButFound = 0;
    const imapResults: ImapJobResult[] = [];

    for (const job of mailboxJobs) {
      if (settled) return;

      let match = matchJobInSentIndex(job, index);
      if (match.bucket === 'db_sent_missing_imap_match' && match.matchedBy == null) {
        const heuristicEntry = heuristicMatchJobInSentEntries(job, entries);
        if (heuristicEntry) {
          match = {
            bucket: 'db_sent_and_imap_confirmed',
            matchedBy: 'heuristic',
            entry: heuristicEntry,
          };
        }
      }

      if (match.bucket === 'db_sent_and_imap_confirmed') confirmed += 1;
      if (match.bucket === 'db_sent_missing_imap_match') missingImapMatch += 1;
      if (match.bucket === 'db_failed_uncertain_but_imap_found') uncertainButFound += 1;

      if (
        match.bucket === 'db_sent_missing_imap_match' ||
        match.bucket === 'db_failed_uncertain_but_imap_found' ||
        (match.bucket === 'db_sent_and_imap_confirmed' && match.matchedBy === 'heuristic')
      ) {
        imapResults.push({
          message_job_id: job.id,
          mailbox_id: mailbox.id,
          mailbox_email: mailbox.email_address,
          status: job.status,
          status_reason: job.status_reason,
          bucket: match.bucket,
          matched_by: match.matchedBy,
          provider_message_id: job.provider_message_id,
          sent_at: job.sent_at,
          imap_uid: match.entry?.uid ?? null,
          imap_message_id: match.entry?.messageId ?? null,
        });
      }
    }

    if (settled) return;

    await finish('success', {
      summary: {
        mailbox_id: mailbox.id,
        mailbox_email: mailbox.email_address,
        sent_folder: sentFolder,
        scanned_sent_messages: entries.length,
        jobs_checked: mailboxJobs.length,
        confirmed,
        missing_imap_match: missingImapMatch,
        uncertain_but_found: uncertainButFound,
        errors,
      },
      imapResults,
    });
  } catch (error) {
    if (!settled) {
      await finish('error', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function normalizeCheckpointState(checkpoint: SendIntegrityCheckpoint): void {
  checkpoint.mailboxResults = dedupeMailboxResults(checkpoint.mailboxResults);
  checkpoint.completedMailboxIds = completedMailboxIdsFromResults(checkpoint.mailboxResults);
  const completedSet = new Set(checkpoint.completedMailboxIds);
  checkpoint.imapJobResults = checkpoint.imapJobResults.filter((row) =>
    completedSet.has(row.mailbox_id),
  );
}

function loadCheckpoint(
  checkpointPath: string | null,
  campaignId: string,
  selectedMailboxIds: string[],
  args: Args,
): SendIntegrityCheckpoint | null {
  if (!checkpointPath || !existsSync(checkpointPath)) return null;
  const checkpoint = readJsonFile<SendIntegrityCheckpoint>(checkpointPath);
  if (checkpoint.kind !== CHECKPOINT_KIND || checkpoint.version !== CHECKPOINT_VERSION) {
    throw new Error(`Checkpoint ${checkpointPath} is not a send-integrity checkpoint.`);
  }
  if (checkpoint.campaignId !== campaignId) {
    throw new Error(`Checkpoint ${checkpointPath} belongs to a different campaign.`);
  }
  if (checkpoint.args.since !== args.since.toISOString()) {
    throw new Error(`Checkpoint ${checkpointPath} was created with a different --since value.`);
  }
  if ((checkpoint.args.until ?? null) !== (args.until?.toISOString() ?? null)) {
    throw new Error(`Checkpoint ${checkpointPath} was created with a different --until value.`);
  }
  if (checkpoint.args.skipImap !== args.skipImap) {
    throw new Error(`Checkpoint ${checkpointPath} was created with a different --skip-imap value.`);
  }
  const currentMailboxIds = [...selectedMailboxIds].sort();
  const checkpointMailboxIds = [...checkpoint.selectedMailboxIds].sort();
  if (JSON.stringify(currentMailboxIds) !== JSON.stringify(checkpointMailboxIds)) {
    throw new Error(`Checkpoint ${checkpointPath} mailbox selection does not match the current run.`);
  }
  normalizeCheckpointState(checkpoint);
  return checkpoint;
}

function toCsvRows(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { targetEnv, urlSource, secretSource, supabase } = await resolveSupabaseClient();

  log(`Target env: ${targetEnv}`);
  log(`Supabase URL from ${urlSource}`);
  log(`Supabase secret from ${secretSource}`);
  log(`Campaign: ${args.campaignId}`);
  log(`Since: ${args.since.toISOString()}`);
  if (args.until) log(`Until: ${args.until.toISOString()}`);

  const mailboxes = await fetchCampaignMailboxes(supabase, args.campaignId, args.limit);
  log(`Campaign mailboxes: ${mailboxes.length}`);

  if (args.dryRun) {
    for (const mailbox of mailboxes) {
      console.log(`- ${mailbox.email_address} (${mailbox.imap_host})`);
    }
    return;
  }

  const existingCheckpoint = args.resumeFromPath
    ? loadCheckpoint(
        args.resumeFromPath,
        args.campaignId,
        mailboxes.map((mailbox) => mailbox.id),
        args,
      )
    : null;

  let dbSummary: Record<string, unknown>;
  let dbSamples: DbSampleRow[];
  let jobs: DbJobRow[];
  let bucketCounts: Record<DbAnomalyBucket, number>;

  if (existingCheckpoint?.dbPhaseComplete) {
    log('Resuming with DB phase from checkpoint.');
    dbSummary = existingCheckpoint.dbSummary;
    dbSamples = existingCheckpoint.dbSamples;
    jobs = await fetchCampaignJobs(supabase, args.campaignId);
    bucketCounts = (dbSummary.bucketCounts ?? initDbBucketCounts()) as Record<DbAnomalyBucket, number>;
  } else {
    const dbPhase = await runDbPhase(supabase, args.campaignId);
    jobs = dbPhase.jobs;
    bucketCounts = dbPhase.bucketCounts;
    dbSamples = dbPhase.samples;
    const dbRollup = summarizeDbBuckets(bucketCounts);
    dbSummary = {
      totalCampaignJobs: jobs.length,
      bucketCounts,
      sentCampaignJobs: dbRollup.sentCampaignJobs,
      healthySent: dbRollup.healthySent,
      dbSuspectCount: dbRollup.dbSuspectCount,
      campaignStats: dbPhase.campaignStats,
      statsDriftSentCountMinusJobs: dbPhase.statsDrift,
    };
    log(
      `DB phase complete: sent=${dbRollup.sentCampaignJobs}, healthy=${dbRollup.healthySent}, suspect=${dbRollup.dbSuspectCount}, uncertain=${bucketCounts.failed_uncertain_send_state}, statsDrift=${dbPhase.statsDrift}`,
    );
  }

  const checkpoint: SendIntegrityCheckpoint = existingCheckpoint ?? {
    kind: CHECKPOINT_KIND,
    version: CHECKPOINT_VERSION,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    campaignId: args.campaignId,
    selectedMailboxIds: mailboxes.map((mailbox) => mailbox.id),
    args: {
      since: args.since.toISOString(),
      until: args.until?.toISOString() ?? null,
      skipImap: args.skipImap,
      concurrency: args.concurrency,
    },
    dbPhaseComplete: true,
    dbSummary,
    dbSamples,
    completedMailboxIds: [],
    mailboxResults: [],
    imapJobResults: [],
    errors: [],
  };

  checkpoint.dbPhaseComplete = true;
  checkpoint.dbSummary = dbSummary;
  checkpoint.dbSamples = dbSamples;

  if (args.skipImap) {
    writeJson(args.checkpointPath, { ...checkpoint, updatedAt: new Date().toISOString() });
    const recommendation = buildRecommendation({
      sentCampaignJobs: Number(dbSummary.sentCampaignJobs ?? 0),
      dbSuspectCount: Number(dbSummary.dbSuspectCount ?? 0),
      imapMissingMatchCount: 0,
      uncertainFailedCount: bucketCounts.failed_uncertain_send_state,
      uncertainButFoundInImapCount: 0,
    });
    const output = {
      generatedAt: new Date().toISOString(),
      campaignId: args.campaignId,
      since: args.since.toISOString(),
      until: args.until?.toISOString() ?? null,
      skipImap: true,
      dbSummary,
      dbSamples,
      imapSummary: null,
      recommendation,
    };
    writeJson(args.outputPath, output);
    log(`DB-only report written to ${args.outputPath}`);
    log(`Recommendation: ${recommendation.message}`);
    return;
  }

  const jobsByMailbox = new Map<string, DbJobRow[]>();
  for (const job of jobs) {
    if (!jobInDateWindow(job, args.since, args.until)) continue;
    if (job.status !== 'sent' && !(job.status === 'failed' && job.status_reason === 'uncertain_send_state')) {
      continue;
    }
    const list = jobsByMailbox.get(job.mailbox_id) ?? [];
    list.push(job);
    jobsByMailbox.set(job.mailbox_id, list);
  }

  const completedMailboxIdSet = new Set(checkpoint.completedMailboxIds);
  const remainingMailboxes = mailboxes.filter((mailbox) => !completedMailboxIdSet.has(mailbox.id));
  let checkpointWriteChain = Promise.resolve();

  const persistCheckpoint = () => {
    normalizeCheckpointState(checkpoint);
    checkpoint.updatedAt = new Date().toISOString();
    writeJson(args.checkpointPath, checkpoint);
  };

  const limit = pLimit(args.concurrency);

  if (existingCheckpoint) {
    log(
      `Resuming IMAP phase: ${completedMailboxIdSet.size}/${mailboxes.length} mailboxes complete, ${remainingMailboxes.length} remaining.`,
    );
  }

  await Promise.all(
    remainingMailboxes.map((mailbox) =>
      limit(async () => {
        const mailboxJobs = jobsByMailbox.get(mailbox.id) ?? [];
        log(
          `Sent scan ${completedMailboxIdSet.size + 1}/${mailboxes.length}: ${mailbox.email_address}`,
        );

        await scanMailboxSentFolder(mailbox, mailboxJobs, args, {
          totalCount: mailboxes.length,
          completedCount: () => completedMailboxIdSet.size,
          markComplete: async (summary, imapResults) => {
            checkpointWriteChain = checkpointWriteChain.then(async () => {
              upsertMailboxResult(checkpoint, summary);
              upsertMailboxImapResults(checkpoint, mailbox.id, imapResults);
              completedMailboxIdSet.add(mailbox.id);
              checkpoint.errors.push(
                ...summary.errors.map((error) => `${mailbox.email_address}: ${error}`),
              );
              persistCheckpoint();
            });
            await checkpointWriteChain;
          },
          markIncomplete: async (summary) => {
            checkpointWriteChain = checkpointWriteChain.then(async () => {
              upsertMailboxResult(checkpoint, summary);
              completedMailboxIdSet.delete(mailbox.id);
              checkpoint.imapJobResults = checkpoint.imapJobResults.filter(
                (row) => row.mailbox_id !== mailbox.id,
              );
              checkpoint.errors.push(
                ...summary.errors.map((error) => `${mailbox.email_address}: ${error}`),
              );
              persistCheckpoint();
            });
            await checkpointWriteChain;
          },
        });
      }),
    ),
  );

  normalizeCheckpointState(checkpoint);

  const completeMailboxResults = checkpoint.mailboxResults.filter(
    (row) => !isIncompleteMailboxResult(row),
  );
  const incompleteMailboxResults = checkpoint.mailboxResults.filter((row) =>
    isIncompleteMailboxResult(row),
  );

  const imapBucketCounts: Record<ImapMatchBucket, number> = {
    db_sent_and_imap_confirmed: completeMailboxResults.reduce((sum, row) => sum + row.confirmed, 0),
    db_sent_missing_imap_match: completeMailboxResults.reduce(
      (sum, row) => sum + row.missing_imap_match,
      0,
    ),
    db_failed_uncertain_but_imap_found: completeMailboxResults.reduce(
      (sum, row) => sum + row.uncertain_but_found,
      0,
    ),
    skipped_not_verifiable: 0,
  };

  const recommendation = buildRecommendation({
    sentCampaignJobs: Number(dbSummary.sentCampaignJobs ?? 0),
    dbSuspectCount: Number(dbSummary.dbSuspectCount ?? 0),
    imapMissingMatchCount: imapBucketCounts.db_sent_missing_imap_match,
    uncertainFailedCount: bucketCounts.failed_uncertain_send_state,
    uncertainButFoundInImapCount: imapBucketCounts.db_failed_uncertain_but_imap_found,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    campaignId: args.campaignId,
    since: args.since.toISOString(),
    until: args.until?.toISOString() ?? null,
    mailboxCount: mailboxes.length,
    dbSummary,
    dbSamples,
    imapSummary: {
      bucketCounts: imapBucketCounts,
      mailboxResults: checkpoint.mailboxResults,
      incompleteMailboxes: incompleteMailboxResults.map((row) => ({
        mailbox_id: row.mailbox_id,
        mailbox_email: row.mailbox_email,
        scanned_sent_messages: row.scanned_sent_messages,
        confirmed: row.confirmed,
        missing_imap_match: row.missing_imap_match,
        error_count: row.errors.length,
      })),
      suspectJobs: checkpoint.imapJobResults.filter(
        (row) =>
          row.bucket === 'db_sent_missing_imap_match' ||
          row.bucket === 'db_failed_uncertain_but_imap_found',
      ),
    },
    recommendation,
    errors: checkpoint.errors,
  };

  writeJson(args.outputPath, output);
  const csvPath = args.outputPath.replace(/\.json$/, '-suspects.csv');
  writeFileSync(csvPath, toCsvRows(output.imapSummary.suspectJobs as Array<Record<string, unknown>>));

  log('=== Send integrity audit summary ===');
  log(`Mailboxes completed: ${checkpoint.completedMailboxIds.length}/${mailboxes.length}`);
  if (incompleteMailboxResults.length > 0) {
    log(
      `Incomplete IMAP scans (excluded from totals, retry on resume): ${incompleteMailboxResults.map((row) => row.mailbox_email).join(', ')}`,
    );
  }
  log(`DB suspect rows: ${dbSummary.dbSuspectCount}`);
  log(`IMAP missing matches: ${imapBucketCounts.db_sent_missing_imap_match}`);
  log(`Uncertain failed but found in Sent: ${imapBucketCounts.db_failed_uncertain_but_imap_found}`);
  log(`Results written to:\n- ${args.outputPath}\n- ${csvPath}\n- ${args.checkpointPath}`);
  log(`Recommendation (${recommendation.level}): ${recommendation.message}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
