/**
 * Export HubSpot consultants campaign leads → Million Verifier → soft-delete rejects.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/mv-clean-hubspot-consultants.ts
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/mv-clean-hubspot-consultants.ts --verify-only
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/mv-clean-hubspot-consultants.ts --remove-only --rejected <path>
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/mv-clean-hubspot-consultants.ts --dry-run
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/supabase/types/database.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

const CAMPAIGN_ID = '46440e9f-be9a-427b-a711-dc560cfa7c59';
const ACCOUNT_ID = 'b8eaab72-d323-4aae-a15c-decbd3f5b364';
const RUN_DIR = resolve(
  'scripts/lead-sourcing/email-scoring/output/runs/hubspot-consultants-mv',
);
const KEEP = new Set(['ok', 'catch_all']);
const MV_ENDPOINT = 'https://api.millionverifier.com/api/v3/';
const PAGE = 1000;
const CONCURRENCY = 20;
const REMOVE_CHUNK = 100;

type LeadRow = {
  id: string;
  global_lead_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
};

type MvResult = 'ok' | 'catch_all' | 'invalid' | 'unknown' | 'error' | 'disposable' | string;

function parseArgs(argv: string[]) {
  let dryRun = false;
  let verifyOnly = false;
  let removeOnly = false;
  let rejected: string | null = null;
  let concurrency = CONCURRENCY;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--verify-only') verifyOnly = true;
    else if (arg === '--remove-only') removeOnly = true;
    else if (arg === '--rejected' && argv[i + 1]) rejected = resolve(argv[++i]!);
    else if (arg === '--concurrency' && argv[i + 1]) {
      concurrency = Number.parseInt(argv[++i]!, 10) || CONCURRENCY;
    }
  }
  return { dryRun, verifyOnly, removeOnly, rejected, concurrency };
}

async function createSupabaseClient(): Promise<SupabaseClient<Database>> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source } = resolveSupabaseUrlForTarget(targetEnv);
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

  if (!url || !resolvedKey) {
    throw new Error(`Missing Supabase URL (${source}) or service role key for ${targetEnv}`);
  }
  console.log(`Supabase: ${targetEnv} via ${source}`);
  return createClient(url, resolvedKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveMvApiKey(): Promise<string> {
  if (process.env.MILLION_VERIFIER_API_KEY?.trim()) {
    return process.env.MILLION_VERIFIER_API_KEY.trim();
  }
  const { resolveMillionVerifierApiKey } = await import('./self-recovery-env.js');
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { apiKey } = await resolveMillionVerifierApiKey({ targetEnv });
  return apiKey;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function writeCsv(path: string, rows: Record<string, string>[], columns: string[]): void {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c] ?? '')).join(','));
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((v) => v.trim())) rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const out: Record<string, string> = {};
    headers.forEach((h, idx) => {
      out[h] = (cells[idx] ?? '').trim();
    });
    return out;
  });
}

async function fetchLeads(db: SupabaseClient<Database>): Promise<LeadRow[]> {
  const all: LeadRow[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const { data, error } = await db
      .from('leads')
      .select('id, global_lead_id, email, first_name, last_name, company_name')
      .eq('campaign_id', CAMPAIGN_ID)
      .eq('account_id', ACCOUNT_ID)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Failed to fetch leads: ${error.message}`);
    const batch = (data ?? []) as LeadRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function verifyOne(apiKey: string, email: string): Promise<MvResult> {
  const url = `${MV_ENDPOINT}?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`;
  const res = await fetch(url);
  if (!res.ok) return 'error';
  const body = (await res.json()) as { result?: string };
  return (body.result ?? 'error') as MvResult;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function softDeleteLeads(db: SupabaseClient<Database>, leadIds: string[]): Promise<{
  succeeded: number;
  failed: Array<{ id: string; error: string }>;
}> {
  let succeeded = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (let i = 0; i < leadIds.length; i += REMOVE_CHUNK) {
    const chunk = leadIds.slice(i, i + REMOVE_CHUNK);
    const now = new Date().toISOString();
    const [leadResult, enrollmentsResult, jobsResult] = await Promise.all([
      db
        .from('leads')
        .update({ deleted_at: now, updated_at: now })
        .in('id', chunk)
        .eq('campaign_id', CAMPAIGN_ID)
        .is('deleted_at', null),
      db
        .from('enrollments')
        .update({
          deleted_at: now,
          state: 'stopped',
          next_run_at: null,
          updated_at: now,
        })
        .in('lead_id', chunk)
        .eq('campaign_id', CAMPAIGN_ID)
        .is('deleted_at', null),
      db
        .from('message_jobs')
        .update({
          status: 'cancelled',
          status_reason: 'lead_deleted',
          error_message: 'Lead deleted',
          updated_at: now,
        })
        .in('lead_id', chunk)
        .eq('campaign_id', CAMPAIGN_ID)
        .in('status', ['queued', 'reserved'])
        .or('message_type.eq.campaign,message_type.is.null'),
    ]);
    if (leadResult.error || enrollmentsResult.error || jobsResult.error) {
      for (const id of chunk) {
        failed.push({
          id,
          error:
            leadResult.error?.message ||
            enrollmentsResult.error?.message ||
            jobsResult.error?.message ||
            'unknown',
        });
      }
    } else {
      succeeded += chunk.length;
    }
    console.log(`Removed ${Math.min(i + chunk.length, leadIds.length)}/${leadIds.length}`);
  }
  return { succeeded, failed };
}

async function main() {
  const { dryRun, verifyOnly, removeOnly, rejected, concurrency } = parseArgs(
    process.argv.slice(2),
  );
  mkdirSync(RUN_DIR, { recursive: true });

  const db = await createSupabaseClient();

  if (removeOnly) {
    const rejectedPath = rejected ?? join(RUN_DIR, 'leads_rejected.csv');
    if (!existsSync(rejectedPath)) throw new Error(`Missing rejected CSV: ${rejectedPath}`);
    const rows = parseCsv(readFileSync(rejectedPath, 'utf8'));
    const leadIds = [...new Set(rows.map((r) => r.lead_id || r.id).filter(Boolean))];
    console.log(`Remove-only: ${leadIds.length} lead ids from ${rejectedPath}`);
    if (dryRun) return;
    const result = await softDeleteLeads(db, leadIds);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const leads = await fetchLeads(db);
  console.log(`Fetched ${leads.length} active leads from HubSpot consultants`);

  const exportPath = join(RUN_DIR, 'leads_export.csv');
  writeCsv(
    exportPath,
    leads.map((l) => ({
      lead_id: l.id,
      global_lead_id: l.global_lead_id,
      email: l.email,
      first_name: l.first_name ?? '',
      last_name: l.last_name ?? '',
      company_name: l.company_name ?? '',
    })),
    ['lead_id', 'global_lead_id', 'email', 'first_name', 'last_name', 'company_name'],
  );
  console.log(`Wrote ${exportPath}`);

  const checkpointPath = join(RUN_DIR, 'mv_checkpoint.json');
  const cache: Record<string, MvResult> = existsSync(checkpointPath)
    ? (JSON.parse(readFileSync(checkpointPath, 'utf8')) as Record<string, MvResult>)
    : {};

  const emails = [...new Set(leads.map((l) => l.email.trim().toLowerCase()).filter(Boolean))];
  const pending = emails.filter((e) => !cache[e]);
  console.log(`MV: ${emails.length} unique emails, ${pending.length} pending, concurrency=${concurrency}`);

  if (!dryRun && pending.length > 0) {
    const apiKey = await resolveMvApiKey();
    let done = 0;
    await mapPool(pending, concurrency, async (email) => {
      const result = await verifyOne(apiKey, email);
      cache[email] = result;
      done += 1;
      if (done % 50 === 0 || done === pending.length) {
        writeFileSync(checkpointPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
        console.log(`MV progress ${done}/${pending.length}`);
      }
      return result;
    });
    writeFileSync(checkpointPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  }

  const counts: Record<string, number> = {};
  for (const email of emails) {
    const result = cache[email] ?? (dryRun ? 'pending' : 'error');
    counts[result] = (counts[result] ?? 0) + 1;
  }
  console.log('MV result counts:', counts);

  const verifiedRows: Record<string, string>[] = [];
  const rejectedRows: Record<string, string>[] = [];
  const auditRows: Record<string, string>[] = [];

  for (const lead of leads) {
    const email = lead.email.trim().toLowerCase();
    const result = cache[email] ?? 'error';
    const row = {
      lead_id: lead.id,
      global_lead_id: lead.global_lead_id,
      email: lead.email,
      first_name: lead.first_name ?? '',
      last_name: lead.last_name ?? '',
      company_name: lead.company_name ?? '',
      mv_result: result,
    };
    auditRows.push(row);
    if (KEEP.has(result)) verifiedRows.push(row);
    else rejectedRows.push(row);
  }

  const verifiedPath = join(RUN_DIR, 'leads_verified.csv');
  const rejectedPath = join(RUN_DIR, 'leads_rejected.csv');
  const auditPath = join(RUN_DIR, 'leads_mv_audit.csv');
  writeCsv(verifiedPath, verifiedRows, Object.keys(verifiedRows[0] ?? { lead_id: '', email: '', mv_result: '' }));
  writeCsv(rejectedPath, rejectedRows, Object.keys(rejectedRows[0] ?? { lead_id: '', email: '', mv_result: '' }));
  writeCsv(auditPath, auditRows, Object.keys(auditRows[0] ?? { lead_id: '', email: '', mv_result: '' }));

  console.log(
    JSON.stringify(
      {
        verified: verifiedRows.length,
        rejected: rejectedRows.length,
        verifiedPath,
        rejectedPath,
        auditPath,
        dryRun,
        verifyOnly,
      },
      null,
      2,
    ),
  );

  if (dryRun || verifyOnly) return;

  const leadIds = rejectedRows.map((r) => r.lead_id).filter(Boolean);
  if (leadIds.length === 0) {
    console.log('No rejects to remove.');
    return;
  }
  const result = await softDeleteLeads(db, leadIds);
  console.log(JSON.stringify({ remove: result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
