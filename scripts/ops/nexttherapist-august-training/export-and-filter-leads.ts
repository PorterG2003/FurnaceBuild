/**
 * Export July Training leads, subtract Part 1 CSV + block list, write audit CSVs.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/ops/nexttherapist-august-training/export-and-filter-leads.ts
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/ops/nexttherapist-august-training/export-and-filter-leads.ts \
 *     --attendees "/Users/porter/Downloads/ethical-dilemmas-part-1-attendees (1).csv"
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/supabase/types/database.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from '../../self-recovery-env.js';

loadSelfRecoveryEnv();

type DbClient = SupabaseClient<Database>;

const ACCOUNT_ID = '8fe822e5-fccc-4799-ba5f-08232765fb73';
const JULY_CAMPAIGN_ID = '7548f6de-f2a1-4e30-b005-f3dc71186829';
const DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ATTENDEES =
  '/Users/porter/Downloads/ethical-dilemmas-part-1-attendees (1).csv';
const PAGE_SIZE = 1000;

type LeadRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  global_lead_id: string | null;
  mailbox_id: string | null;
};

function parseArgs(argv: string[]): { attendees: string } {
  let attendees = DEFAULT_ATTENDEES;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--attendees' && argv[i + 1]) {
      attendees = resolve(argv[++i]!);
    }
  }
  return { attendees };
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function writeCsv(path: string, headers: string[], rows: string[][]): void {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell)).join(','));
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

async function createSupabaseClient(): Promise<DbClient> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(targetEnv);
  if (!url) throw new Error(`No Supabase URL for ${targetEnv}`);

  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let resolvedKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    resolvedKey = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
  }
  if (!resolvedKey) throw new Error('Missing Supabase service role key');

  return createClient<Database>(url, resolvedKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadAttendeeEmails(path: string): Promise<Set<string>> {
  const emails = new Set<string>();
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let header: string[] | null = null;
  let emailIdx = -1;
  for await (const line of rl) {
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols.map((c) => c.trim().replace(/^"|"$/g, ''));
      emailIdx = header.findIndex((h) => h.toLowerCase() === 'email');
      if (emailIdx < 0) throw new Error(`No Email column in ${path}`);
      continue;
    }
    const email = normalizeEmail(cols[emailIdx]?.replace(/^"|"$/g, ''));
    if (email) emails.add(email);
  }
  return emails;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function loadBlockEmails(db: DbClient): Promise<Set<string>> {
  const emails = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await db
      .from('block_list')
      .select('value, type')
      .eq('account_id', ACCOUNT_ID)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      if (row.type === 'email') {
        const email = normalizeEmail(row.value);
        if (email) emails.add(email);
      }
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return emails;
}

async function loadJulyLeads(db: DbClient): Promise<LeadRow[]> {
  const leads: LeadRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db
      .from('leads')
      .select('id, email, first_name, last_name, name, global_lead_id, mailbox_id')
      .eq('campaign_id', JULY_CAMPAIGN_ID)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as LeadRow[];
    leads.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return leads;
}

async function loadJulyMailboxes(db: DbClient): Promise<string[]> {
  const { data, error } = await db
    .from('campaign_mailboxes')
    .select('mailbox_id')
    .eq('campaign_id', JULY_CAMPAIGN_ID);
  if (error) throw error;
  return (data ?? []).map((r) => r.mailbox_id).sort();
}

async function main(): Promise<void> {
  const { attendees } = parseArgs(process.argv.slice(2));
  mkdirSync(DIR, { recursive: true });

  const db = await createSupabaseClient();
  const [julyLeads, attendeeEmails, blockEmails, mailboxIds] = await Promise.all([
    loadJulyLeads(db),
    loadAttendeeEmails(attendees),
    loadBlockEmails(db),
    loadJulyMailboxes(db),
  ]);

  const included: LeadRow[] = [];
  const excluded: Array<LeadRow & { reason: string }> = [];

  for (const lead of julyLeads) {
    const email = normalizeEmail(lead.email);
    if (!email || !lead.global_lead_id) {
      excluded.push({ ...lead, reason: 'missing_email_or_global_lead_id' });
      continue;
    }
    const inAttendees = attendeeEmails.has(email);
    const inBlock = blockEmails.has(email);
    if (inAttendees && inBlock) {
      excluded.push({ ...lead, reason: 'part1_csv+block_list' });
    } else if (inAttendees) {
      excluded.push({ ...lead, reason: 'part1_csv' });
    } else if (inBlock) {
      excluded.push({ ...lead, reason: 'block_list' });
    } else {
      included.push(lead);
    }
  }

  writeCsv(
    resolve(DIR, 'included.csv'),
    ['email', 'first_name', 'last_name', 'name', 'global_lead_id', 'july_lead_id'],
    included.map((l) => [
      l.email,
      l.first_name ?? '',
      l.last_name ?? '',
      l.name ?? '',
      l.global_lead_id ?? '',
      l.id,
    ]),
  );

  writeCsv(
    resolve(DIR, 'excluded.csv'),
    ['email', 'first_name', 'last_name', 'name', 'global_lead_id', 'july_lead_id', 'reason'],
    excluded.map((l) => [
      l.email,
      l.first_name ?? '',
      l.last_name ?? '',
      l.name ?? '',
      l.global_lead_id ?? '',
      l.id,
      l.reason,
    ]),
  );

  writeFileSync(
    resolve(DIR, 'mailbox_ids.json'),
    `${JSON.stringify(mailboxIds, null, 2)}\n`,
    'utf8',
  );

  const reasonCounts = excluded.reduce<Record<string, number>>((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});

  const summary = {
    july_leads: julyLeads.length,
    attendee_csv_emails: attendeeEmails.size,
    block_list_emails: blockEmails.size,
    included: included.length,
    excluded: excluded.length,
    excluded_by_reason: reasonCounts,
    mailbox_count: mailboxIds.length,
    attendees_matched_in_july: excluded.filter((e) => e.reason.includes('part1_csv')).length,
    block_matched_in_july: excluded.filter((e) => e.reason.includes('block_list')).length,
  };

  writeFileSync(resolve(DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(
    resolve(DIR, 'included_global_lead_ids.json'),
    `${JSON.stringify(
      included.map((l) => l.global_lead_id).filter(Boolean),
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
