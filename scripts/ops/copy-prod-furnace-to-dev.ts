/**
 * Copy the prod "Furnace" account into the shared dev DB for realistic metrics.
 *
 * Safety:
 * - Reads prod, writes dest only. Aborts if dest URL looks like prod.
 * - Strips mailbox passwords and disconnects mailboxes.
 * - Pauses campaigns, pauses active enrollments, cancels queued/deferred jobs.
 * - Remaps owner/mailbox user ids to SEED_OWNER_USER_ID (prod auth users do not exist on dest).
 *
 * Usage:
 *   npx tsx scripts/ops/copy-prod-furnace-to-dev.ts
 *   npx tsx scripts/ops/copy-prod-furnace-to-dev.ts --dry-run
 *   npx tsx scripts/ops/copy-prod-furnace-to-dev.ts --inbox-only
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSupabaseUrlForTarget,
} from '../self-recovery-env.js';

loadSelfRecoveryEnv();

const PROD_PROJECT_REF = 'lrfonoslwzodzijzdyiy';
const DEV_PROJECT_REF = 'hibwbebpcwbstqbjeviq';
const FURNACE_ACCOUNT_ID = 'b8eaab72-d323-4aae-a15c-decbd3f5b364';
const PAGE_SIZE = 500;
const UPSERT_SIZE = 200;
const PENDING_JOB_STATUSES = new Set([
  'queued',
  'deferred',
  'pending',
  'sending',
  'reserved',
  'held',
]);

const STRIP_COLUMNS: Record<string, string[]> = {
  message_jobs: ['message_data', 'claim_token'],
};

type AnyRow = Record<string, unknown>;
type Db = SupabaseClient;

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function requireUrlRef(url: string, ref: string, label: string): void {
  if (!url.includes(ref)) {
    throw new Error(`${label} URL does not contain expected project ref ${ref}: ${url}`);
  }
}

async function createEnvClient(
  target: 'prod' | 'dev',
  fallbackKey: string | null,
): Promise<{ client: Db; url: string }> {
  const { url } = resolveSupabaseUrlForTarget(target);
  if (!url) throw new Error(`No Supabase URL for ${target}`);

  const awsRegion =
    process.env.AWS_REGION?.trim() || process.env.CDK_DEFAULT_REGION?.trim() || 'us-west-2';
  const secretParamPath = resolveSecretParamPathForTarget(target);
  let key = fallbackKey;
  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
    } catch (error) {
      if (!key) throw error;
      console.warn(
        `[copy-prod-furnace-to-dev] SSM ${secretParamPath} failed; using env fallback for ${target}.`,
      );
    }
  }
  if (!key) throw new Error(`Missing service role key for ${target}`);

  return {
    url,
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

const MESSAGE_JOB_SELECT = [
  'id',
  'enrollment_id',
  'campaign_id',
  'lead_id',
  'mailbox_id',
  'node_id',
  'status',
  'scheduled_at',
  'reserved_at',
  'sent_at',
  'provider_message_id',
  'sqs_message_id',
  'error_message',
  'retry_count',
  'max_retries',
  'created_at',
  'updated_at',
  'interval_id',
  'message_type',
  'account_id',
  'send_wait_reason',
  'throttle_bypass_next_attempt',
  'variant_id',
  'flow_version_number',
  'status_reason',
  'lease_expires_at',
  'claim_token',
  'sending_started_at',
  'submitted_message_id',
].join(',');

async function countEq(client: Db, table: string, column: string, value: string): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function fetchAll(
  client: Db,
  table: string,
  column: string,
  value: string,
  select = '*',
): Promise<AnyRow[]> {
  const rows: AnyRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .from(table)
      .select(select)
      .eq(column, value)
      .range(from, to);
    if (error) throw new Error(`fetch ${table} [${from}-${to}]: ${error.message}`);
    const page = (data ?? []) as AnyRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function pickColumns(row: AnyRow, allowed: Set<string> | null, skip: Set<string>): AnyRow {
  const out: AnyRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (skip.has(key)) continue;
    if (allowed && !allowed.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function isMissingColumnError(message: string): string | null {
  const match =
    message.match(/Could not find the '([^']+)' column/i) ||
    message.match(/column "([^"]+)" (?:of relation|does not exist)/i);
  return match?.[1] ?? null;
}

async function upsertRows(
  dest: Db,
  table: string,
  rows: AnyRow[],
  onConflict: string,
  skipColumns: Set<string>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let allowed: Set<string> | null = null;
  let skipped = new Set(skipColumns);
  let written = 0;

  for (const page of chunk(rows, UPSERT_SIZE)) {
    for (;;) {
      const payload = page.map((row) => pickColumns(row, allowed, skipped));
      const { error } = await dest.from(table).upsert(payload, { onConflict });
      if (!error) {
        written += page.length;
        break;
      }
      const missing = isMissingColumnError(error.message);
      if (missing) {
        skipped = new Set(skipped);
        skipped.add(missing);
        console.warn(`[copy-prod-furnace-to-dev] ${table}: dropping dest-missing column ${missing}`);
        continue;
      }
      throw new Error(`upsert ${table}: ${error.message}`);
    }
  }
  return written;
}

function remapUserId(value: unknown, seedOwnerUserId: string): string {
  if (typeof value === 'string' && value === seedOwnerUserId) return value;
  return seedOwnerUserId;
}

function sanitizeAccount(row: AnyRow): AnyRow {
  return {
    ...row,
    webhook_url: null,
    webhook_signing_secret: null,
  };
}

function sanitizeCampaign(row: AnyRow, seedOwnerUserId: string): AnyRow {
  const status = row.status === 'running' ? 'paused' : row.status;
  return {
    ...row,
    status,
    owner_id: seedOwnerUserId,
    owner_user_id: seedOwnerUserId,
    webhook_url_override: null,
    webhook_signing_secret_override: null,
  };
}

function sanitizeMailbox(row: AnyRow, seedOwnerUserId: string): AnyRow {
  return {
    ...row,
    user_id: remapUserId(row.user_id, seedOwnerUserId),
    smtp_password: 'redacted',
    imap_password: 'redacted',
    status: 'disconnected',
    smtp_status: 'disabled',
    imap_next_check_at: null,
    imap_claimed_at: null,
    imap_last_recovery_at: null,
    error_message: 'Copied from prod for local metrics; credentials stripped.',
  };
}

function sanitizeEnrollment(row: AnyRow): AnyRow {
  return {
    ...row,
    state: row.state === 'active' ? 'paused' : row.state,
    next_run_at: null,
    held_next_run_at: null,
    reply_thread_id: null,
  };
}

function sanitizeMessageJob(row: AnyRow): AnyRow {
  const pending = typeof row.status === 'string' && PENDING_JOB_STATUSES.has(row.status);
  return {
    ...row,
    interval_id: null,
    message_data: {},
    claim_token: null,
    lease_expires_at: null,
    reserved_at: null,
    status: pending ? 'cancelled' : row.status,
    status_reason: pending ? 'manually_cancelled' : row.status_reason,
  };
}

async function fetchIds(client: Db, table: string, accountId: string): Promise<Set<string>> {
  const rows = await fetchAll(client, table, 'account_id', accountId, 'id');
  return new Set(rows.map((row) => String(row.id)));
}

function filterInboxRows(
  threads: AnyRow[],
  messages: AnyRow[],
  dest: {
    campaigns: Set<string>;
    leads: Set<string>;
    enrollments: Set<string>;
    mailboxes: Set<string>;
    jobs: Set<string>;
  },
): { threads: AnyRow[]; messages: AnyRow[]; skippedThreads: number } {
  const keptThreads = threads.filter((row) => {
    const campaignId = String(row.campaign_id ?? '');
    const leadId = String(row.lead_id ?? '');
    const mailboxId = String(row.mailbox_id ?? '');
    const jobId = String(row.message_job_id ?? '');
    const enrollmentId = row.enrollment_id == null ? null : String(row.enrollment_id);
    return (
      dest.campaigns.has(campaignId) &&
      dest.leads.has(leadId) &&
      dest.mailboxes.has(mailboxId) &&
      dest.jobs.has(jobId) &&
      (enrollmentId == null || dest.enrollments.has(enrollmentId))
    );
  });
  const keptThreadIds = new Set(keptThreads.map((row) => String(row.id)));
  const keptMessages = messages.filter((row) => {
    if (!keptThreadIds.has(String(row.thread_id ?? ''))) return false;
    const jobId = row.message_job_id == null ? null : String(row.message_job_id);
    return jobId == null || dest.jobs.has(jobId);
  });
  return {
    threads: keptThreads,
    messages: keptMessages,
    skippedThreads: threads.length - keptThreads.length,
  };
}

async function copyInbox(prod: Db, dest: Db): Promise<{ email_threads: number; email_messages: number }> {
  const destKeys = {
    campaigns: await fetchIds(dest, 'campaigns', FURNACE_ACCOUNT_ID),
    leads: await fetchIds(dest, 'leads', FURNACE_ACCOUNT_ID),
    enrollments: await fetchIds(dest, 'enrollments', FURNACE_ACCOUNT_ID),
    mailboxes: await fetchIds(dest, 'mailboxes', FURNACE_ACCOUNT_ID),
    jobs: await fetchIds(dest, 'message_jobs', FURNACE_ACCOUNT_ID),
  };
  const filtered = filterInboxRows(
    await fetchAll(prod, 'email_threads', 'account_id', FURNACE_ACCOUNT_ID),
    await fetchAll(prod, 'email_messages', 'account_id', FURNACE_ACCOUNT_ID),
    destKeys,
  );
  if (filtered.skippedThreads > 0) {
    console.warn(
      `[copy-prod-furnace-to-dev] skipping ${filtered.skippedThreads} threads whose campaign/lead/job/mailbox is missing on dest`,
    );
  }
  const writtenThreads = await upsertRows(dest, 'email_threads', filtered.threads, 'id', new Set());
  const writtenMessages = await upsertRows(dest, 'email_messages', filtered.messages, 'id', new Set());
  return { email_threads: writtenThreads, email_messages: writtenMessages };
}

async function main(): Promise<void> {
  const dryRun = argFlag('--dry-run');
  const inboxOnly = argFlag('--inbox-only');
  const seedOwnerUserId = process.env.SEED_OWNER_USER_ID?.trim();
  if (!seedOwnerUserId) throw new Error('SEED_OWNER_USER_ID is required');

  const repoServiceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || null;

  const prod = await createEnvClient('prod', null);
  const dest = await createEnvClient('dev', repoServiceRole);

  requireUrlRef(prod.url, PROD_PROJECT_REF, 'prod');
  requireUrlRef(dest.url, DEV_PROJECT_REF, 'dev');
  if (dest.url.includes(PROD_PROJECT_REF)) {
    throw new Error('Refusing to write: dest URL looks like prod');
  }

  const { data: seedUser, error: seedUserError } = await dest.client
    .from('users')
    .select('id,email')
    .eq('id', seedOwnerUserId)
    .maybeSingle();
  if (seedUserError) throw new Error(`dest users lookup: ${seedUserError.message}`);
  if (!seedUser) throw new Error(`SEED_OWNER_USER_ID ${seedOwnerUserId} is not in dest users`);

  const { data: prodAccount, error: prodAccountError } = await prod.client
    .from('accounts')
    .select('*')
    .eq('id', FURNACE_ACCOUNT_ID)
    .maybeSingle();
  if (prodAccountError) throw new Error(`prod account: ${prodAccountError.message}`);
  if (!prodAccount) throw new Error(`Prod account ${FURNACE_ACCOUNT_ID} not found`);

  const campaigns = await fetchAll(prod.client, 'campaigns', 'account_id', FURNACE_ACCOUNT_ID);
  const campaignIds = campaigns.map((row) => String(row.id));

  const preflight = {
    dryRun,
    prodAccount: { id: prodAccount.id, name: prodAccount.name },
    destUser: seedUser,
    counts: {
      campaigns: campaigns.length,
      nodes: await countEq(prod.client, 'nodes', 'account_id', FURNACE_ACCOUNT_ID),
      mailboxes: await countEq(prod.client, 'mailboxes', 'account_id', FURNACE_ACCOUNT_ID),
      campaignMailboxes: await countEq(
        prod.client,
        'campaign_mailboxes',
        'account_id',
        FURNACE_ACCOUNT_ID,
      ),
      leads: await countEq(prod.client, 'leads', 'account_id', FURNACE_ACCOUNT_ID),
      enrollments: await countEq(prod.client, 'enrollments', 'account_id', FURNACE_ACCOUNT_ID),
      messageJobs: await countEq(prod.client, 'message_jobs', 'account_id', FURNACE_ACCOUNT_ID),
      events: await countEq(prod.client, 'events', 'account_id', FURNACE_ACCOUNT_ID),
      campaignStats: campaignIds.length,
      emailThreads: await countEq(prod.client, 'email_threads', 'account_id', FURNACE_ACCOUNT_ID),
      emailMessages: await countEq(prod.client, 'email_messages', 'account_id', FURNACE_ACCOUNT_ID),
    },
    destInbox: {
      emailThreads: await countEq(dest.client, 'email_threads', 'account_id', FURNACE_ACCOUNT_ID),
      emailMessages: await countEq(dest.client, 'email_messages', 'account_id', FURNACE_ACCOUNT_ID),
    },
    inboxOnly,
  };
  console.log(JSON.stringify(preflight, null, 2));
  if (dryRun) return;

  const written: Record<string, number> = {};
  const logStep = (label: string) => {
    console.log(`[copy-prod-furnace-to-dev] copying ${label}`);
  };

  if (inboxOnly) {
    logStep('email_threads + email_messages');
    Object.assign(written, await copyInbox(prod.client, dest.client));
    const destCounts = {
      email_threads: await countEq(dest.client, 'email_threads', 'account_id', FURNACE_ACCOUNT_ID),
      email_messages: await countEq(dest.client, 'email_messages', 'account_id', FURNACE_ACCOUNT_ID),
      ooo_threads: (
        await dest.client
          .from('email_threads')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', FURNACE_ACCOUNT_ID)
          .eq('out_of_office', true)
      ).count ?? 0,
    };
    console.log(JSON.stringify({ written, destCounts }, null, 2));
    return;
  }

  if (campaignIds.length === 0) throw new Error('No campaigns to copy');

  const wipeDestChildren = async (): Promise<void> => {
    const tables = [
      'email_messages',
      'thread_tag_assignments',
      'inbox_interactions',
      'inbox_attachment_uploads',
      'email_threads',
      'events',
      'message_jobs',
      'enrollments',
      'campaign_stats',
      'campaign_mailboxes',
      'leads',
      'campaign_intervals',
      'nodes',
      'mailboxes',
    ];
    for (const table of tables) {
      const { error } = await dest.client.from(table).delete().eq('account_id', FURNACE_ACCOUNT_ID);
      if (error) {
        console.warn(`[copy-prod-furnace-to-dev] wipe ${table}: ${error.message}`);
      } else {
        console.log(`[copy-prod-furnace-to-dev] wiped dest ${table} for account`);
      }
    }
  };

  logStep('accounts');
  written.accounts = await upsertRows(
    dest.client,
    'accounts',
    [sanitizeAccount(prodAccount as AnyRow)],
    'id',
    new Set(),
  );

  logStep('campaigns');
  written.campaigns = await upsertRows(
    dest.client,
    'campaigns',
    campaigns.map((row) => sanitizeCampaign(row, seedOwnerUserId)),
    'id',
    new Set(),
  );

  await wipeDestChildren();

  logStep('nodes');
  const nodes = await fetchAll(prod.client, 'nodes', 'account_id', FURNACE_ACCOUNT_ID);
  written.nodes = await upsertRows(dest.client, 'nodes', nodes, 'id', new Set());

  logStep('mailboxes');
  const mailboxes = await fetchAll(prod.client, 'mailboxes', 'account_id', FURNACE_ACCOUNT_ID);
  written.mailboxes = await upsertRows(
    dest.client,
    'mailboxes',
    mailboxes.map((row) => sanitizeMailbox(row, seedOwnerUserId)),
    'id',
    new Set(),
  );

  logStep('campaign_mailboxes');
  const campaignMailboxes = await fetchAll(
    prod.client,
    'campaign_mailboxes',
    'account_id',
    FURNACE_ACCOUNT_ID,
  );
  written.campaign_mailboxes = await upsertRows(
    dest.client,
    'campaign_mailboxes',
    campaignMailboxes,
    'id',
    new Set(),
  );

  logStep('leads');
  const leads = await fetchAll(prod.client, 'leads', 'account_id', FURNACE_ACCOUNT_ID);
  written.leads = await upsertRows(dest.client, 'leads', leads, 'id', new Set());

  logStep('enrollments');
  const enrollments = await fetchAll(prod.client, 'enrollments', 'account_id', FURNACE_ACCOUNT_ID);
  written.enrollments = await upsertRows(
    dest.client,
    'enrollments',
    enrollments.map(sanitizeEnrollment),
    'id',
    new Set(),
  );

  logStep('message_jobs');
  const messageJobs = await fetchAll(
    prod.client,
    'message_jobs',
    'account_id',
    FURNACE_ACCOUNT_ID,
    MESSAGE_JOB_SELECT,
  );
  written.message_jobs = await upsertRows(
    dest.client,
    'message_jobs',
    messageJobs.map(sanitizeMessageJob),
    'id',
    new Set(STRIP_COLUMNS.message_jobs ?? []),
  );

  logStep('events');
  const events = await fetchAll(prod.client, 'events', 'account_id', FURNACE_ACCOUNT_ID);
  written.events = await upsertRows(dest.client, 'events', events, 'id', new Set());

  logStep('email_threads + email_messages');
  Object.assign(written, await copyInbox(prod.client, dest.client));

  logStep('campaign_stats');
  const campaignStats = await fetchAll(
    prod.client,
    'campaign_stats',
    'account_id',
    FURNACE_ACCOUNT_ID,
  );
  written.campaign_stats = await upsertRows(
    dest.client,
    'campaign_stats',
    campaignStats,
    'campaign_id',
    new Set(),
  );

  logStep('account_users');
  const membership = {
    account_id: FURNACE_ACCOUNT_ID,
    user_id: seedOwnerUserId,
    is_owner: true,
    role: 'owner',
  };
  const { error: membershipError } = await dest.client
    .from('account_users')
    .upsert(membership, { onConflict: 'account_id,user_id' });
  if (membershipError) throw new Error(`account_users: ${membershipError.message}`);
  written.account_users = 1;

  const destCounts = {
    campaigns: await countEq(dest.client, 'campaigns', 'account_id', FURNACE_ACCOUNT_ID),
    leads: await countEq(dest.client, 'leads', 'account_id', FURNACE_ACCOUNT_ID),
    enrollments: await countEq(dest.client, 'enrollments', 'account_id', FURNACE_ACCOUNT_ID),
    message_jobs: await countEq(dest.client, 'message_jobs', 'account_id', FURNACE_ACCOUNT_ID),
    events: await countEq(dest.client, 'events', 'account_id', FURNACE_ACCOUNT_ID),
    email_threads: await countEq(dest.client, 'email_threads', 'account_id', FURNACE_ACCOUNT_ID),
    email_messages: await countEq(dest.client, 'email_messages', 'account_id', FURNACE_ACCOUNT_ID),
  };

  console.log(JSON.stringify({ written, destCounts }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
