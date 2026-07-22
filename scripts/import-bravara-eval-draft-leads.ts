/**
 * Import a verified people CSV into Bravara's Eval & Draft July 2026 campaign.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/import-bravara-eval-draft-leads.ts \
 *     --input scripts/lead-sourcing/email-scoring/output/runs/.../people_..._verified.csv
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

type DbClient = SupabaseClient<Database>;

const CAMPAIGN_ID = 'e22d83af-59f6-45d4-8114-90b86a9dde17';
const ACCOUNT_ID = 'db4ddb6a-a6b8-4748-8cea-ca43e1a40ef2';
const CHUNK_SIZE = 100;

type LeadPayload = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  custom_lead_data?: Record<string, string> | null;
};

type ImportStats = {
  created: number;
  updated: number;
  enrolled: number;
  skipped: number;
  incomplete: number;
  failed: number;
  errors: Array<{ index?: number; message: string }>;
};

function parseArgs(argv: string[]): { input: string | null; dryRun: boolean } {
  let input: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) input = resolve(argv[++i]!);
    else if (arg === '--dry-run') dryRun = true;
  }
  return { input, dryRun };
}

function emptyStats(): ImportStats {
  return { created: 0, updated: 0, enrolled: 0, skipped: 0, incomplete: 0, failed: 0, errors: [] };
}

function mergeStats(a: ImportStats, b: ImportStats): ImportStats {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    enrolled: a.enrolled + b.enrolled,
    skipped: a.skipped + b.skipped,
    incomplete: a.incomplete + b.incomplete,
    failed: a.failed + b.failed,
    errors: [...a.errors, ...b.errors].slice(0, 100),
  };
}

function parseRpcStats(data: unknown): ImportStats {
  const row = (data ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(row.errors)
    ? row.errors.map((entry, index) => {
        const item = entry as Record<string, unknown>;
        return { index, message: String(item.message ?? 'Import failed') };
      })
    : [];
  return {
    created: typeof row.created === 'number' ? row.created : 0,
    updated: typeof row.updated === 'number' ? row.updated : 0,
    enrolled: typeof row.enrolled === 'number' ? row.enrolled : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: typeof row.incomplete === 'number' ? row.incomplete : 0,
    failed: typeof row.failed === 'number' ? row.failed : 0,
    errors,
  };
}

function sanitize(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function createSupabaseClient(): Promise<DbClient> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(targetEnv);
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
    throw new Error('Missing Supabase URL or service role key.');
  }

  return createClient(url, resolvedKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Minimal RFC4180-ish CSV parser (quoted fields, commas, newlines). */
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
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((values) => {
    const out: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      out[headers[i]!] = (values[i] ?? '').trim();
    }
    return out;
  });
}

function readCsvRows(path: string): Record<string, string>[] {
  return parseCsv(readFileSync(path, 'utf8'));
}

function toLeadPayload(row: Record<string, string>): LeadPayload | null {
  const email = sanitize(row.email)?.toLowerCase() ?? null;
  if (!email || !email.includes('@')) return null;

  const firstName = sanitize(row.first_name);
  const lastName = sanitize(row.last_name);
  const leagueName = sanitize(row.league_name);
  const title = sanitize(row.title);
  const leagueUrl = sanitize(row.league_url);
  const mvResult = sanitize(row.mv_result);

  const custom: Record<string, string> = {};
  if (title) custom.title = title;
  if (leagueName) custom.league_name = leagueName;
  if (leagueUrl) custom.league_url = leagueUrl;
  if (mvResult) custom.mv_result = mvResult;

  return {
    email,
    first_name: firstName,
    last_name: lastName,
    company_name: leagueName,
    website: leagueUrl,
    custom_lead_data: Object.keys(custom).length > 0 ? custom : null,
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function main() {
  const { input, dryRun } = parseArgs(process.argv.slice(2));
  if (!input) {
    throw new Error('Missing --input <verified.csv>');
  }

  const rows = readCsvRows(input);
  const leads: LeadPayload[] = [];
  let missingEmail = 0;
  let missingFirstName = 0;
  const seen = new Set<string>();
  let dupes = 0;

  for (const row of rows) {
    const lead = toLeadPayload(row);
    if (!lead) {
      missingEmail += 1;
      continue;
    }
    if (seen.has(lead.email)) {
      dupes += 1;
      continue;
    }
    seen.add(lead.email);
    if (!lead.first_name) missingFirstName += 1;
    leads.push(lead);
  }

  console.log(
    JSON.stringify(
      {
        input,
        campaignId: CAMPAIGN_ID,
        accountId: ACCOUNT_ID,
        rowsIn: rows.length,
        leadsReady: leads.length,
        missingEmail,
        missingFirstName,
        withinFileDupes: dupes,
        dryRun,
      },
      null,
      2,
    ),
  );

  if (dryRun || leads.length === 0) return;

  const db = await createSupabaseClient();
  const { data: campaign, error: campaignError } = await db
    .from('campaigns')
    .select('id, name, status, account_id')
    .eq('id', CAMPAIGN_ID)
    .eq('account_id', ACCOUNT_ID)
    .is('deleted_at', null)
    .single();
  if (campaignError || !campaign) {
    throw new Error(`Campaign not found: ${campaignError?.message ?? CAMPAIGN_ID}`);
  }

  let stats = emptyStats();
  const chunks = chunk(leads, CHUNK_SIZE);
  for (let i = 0; i < chunks.length; i += 1) {
    const leadChunk = chunks[i]!;
    const { data, error } = await db.rpc('import_api_leads_to_campaign', {
      p_account_id: ACCOUNT_ID,
      p_campaign_id: CAMPAIGN_ID,
      p_leads: leadChunk,
      p_options: { emit_row_webhooks: false },
    } as never);
    if (error) {
      throw new Error(`Import chunk ${i + 1}/${chunks.length} failed: ${error.message}`);
    }
    stats = mergeStats(stats, parseRpcStats(data));
    console.log(`Imported chunk ${i + 1}/${chunks.length}`);
  }

  const { count, error: countError } = await db
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', CAMPAIGN_ID)
    .is('deleted_at', null);
  if (countError) {
    throw new Error(`Lead count failed: ${countError.message}`);
  }

  console.log(
    JSON.stringify(
      {
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignStatus: campaign.status,
        importStats: stats,
        leadCount: count ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[import-bravara-eval-draft-leads]', error instanceof Error ? error.message : error);
  process.exit(1);
});
