/**
 * Enroll filtered August Training leads via import_api_leads_to_campaign.
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/ops/nexttherapist-august-training/enroll-leads.ts
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/ops/nexttherapist-august-training/enroll-leads.ts --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
const CAMPAIGN_ID = 'c8e95f14-f447-4fb5-ab14-ab32ca9c8136';
const DIR = dirname(fileURLToPath(import.meta.url));
const CHUNK_SIZE = 100;

type LeadPayload = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
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

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function sanitize(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const includedPath = resolve(DIR, 'included.csv');
  const rows = parseCsv(readFileSync(includedPath, 'utf8'));

  const leads: LeadPayload[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const email = sanitize(row.email)?.toLowerCase() ?? null;
    if (!email || !email.includes('@')) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    leads.push({
      email,
      first_name: sanitize(row.first_name),
      last_name: sanitize(row.last_name),
      name: sanitize(row.name),
    });
  }

  console.log(
    JSON.stringify(
      {
        campaignId: CAMPAIGN_ID,
        accountId: ACCOUNT_ID,
        leadsReady: leads.length,
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
  if (campaign.status !== 'draft') {
    throw new Error(`Expected draft campaign, got ${campaign.status}`);
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
    if ((i + 1) % 10 === 0 || i + 1 === chunks.length) {
      console.log(`Imported chunk ${i + 1}/${chunks.length}`);
    }
  }

  const { count, error: countError } = await db
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', CAMPAIGN_ID)
    .is('deleted_at', null);
  if (countError) throw new Error(`Lead count failed: ${countError.message}`);

  const result = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignStatus: campaign.status,
    importStats: stats,
    leadCount: count ?? 0,
  };
  writeFileSync(resolve(DIR, 'enroll_result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
