/**
 * Upsert a Smartlead Block_Lists CSV into Bravara's Furnace block_list.
 *
 * Does not wipe existing rows — only inserts missing (account_id, value, type).
 *
 * Usage:
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/import-bravara-block-list-csv.ts \
 *     --input "/Users/porter/Downloads/Block_Lists (2).csv"
 *   SELF_RECOVERY_TARGET_ENV=prod npx tsx scripts/import-bravara-block-list-csv.ts \
 *     --input "/Users/porter/Downloads/Block_Lists (2).csv" --dry-run
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

const ACCOUNT_ID = 'db4ddb6a-a6b8-4748-8cea-ca43e1a40ef2';
const CHUNK_SIZE = 200;

type BlockRow = {
  account_id: string;
  value: string;
  type: 'email' | 'domain';
  reason: string;
};

function parseArgs(argv: string[]): { input: string | null; dryRun: boolean } {
  let input: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--input') input = argv[++i] ?? null;
    else if (arg.startsWith('--input=')) input = arg.slice('--input='.length);
  }
  return { input, dryRun };
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = cols[c] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
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
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function mapSourceToReason(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized.includes('bounce')) return 'bounced';
  if (normalized.includes('unsub')) return 'unsubscribed';
  return 'manual';
}

function rowsFromCsv(csvPath: string): BlockRow[] {
  const text = readFileSync(resolve(csvPath), 'utf8');
  const parsed = parseCsv(text);
  const byKey = new Map<string, BlockRow>();

  for (const row of parsed) {
    const raw = (row.domain || row.value || row.email_or_domain || '').trim().toLowerCase();
    if (!raw) continue;
    const type: 'email' | 'domain' = raw.includes('@') ? 'email' : 'domain';
    const reason = mapSourceToReason(row.source || '');
    byKey.set(`${type}:${raw}`, {
      account_id: ACCOUNT_ID,
      value: raw,
      type,
      reason,
    });
  }

  return [...byKey.values()];
}

async function createDb(): Promise<DbClient> {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url } = resolveSupabaseUrlForTarget(targetEnv);
  if (!url) throw new Error(`Missing Supabase URL for ${targetEnv}`);

  const secretParam = resolveSecretParamPathForTarget(targetEnv);
  if (!secretParam) throw new Error(`Missing secret param path for ${targetEnv}`);

  const secretKey = await fetchSecretFromParameterStore(
    secretParam,
    process.env.AWS_REGION || 'us-west-2',
  );

  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main(): Promise<void> {
  const { input, dryRun } = parseArgs(process.argv.slice(2));
  if (!input) {
    throw new Error('Missing --input path to Block_Lists CSV');
  }

  const rows = rowsFromCsv(input);
  const emailCount = rows.filter((r) => r.type === 'email').length;
  const domainCount = rows.filter((r) => r.type === 'domain').length;
  const reasonCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});

  console.log('[import-bravara-block-list-csv]', {
    accountId: ACCOUNT_ID,
    uniqueRows: rows.length,
    emailCount,
    domainCount,
    reasonCounts,
    dryRun,
  });

  const db = await createDb();

  const { count: beforeCount, error: beforeError } = await db
    .from('block_list')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', ACCOUNT_ID);
  if (beforeError) throw new Error(`Failed to count existing block_list: ${beforeError.message}`);

  // Overlap check (chunked)
  let alreadyPresent = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const values = chunk.map((r) => r.value);
    const { data, error } = await db
      .from('block_list')
      .select('value, type')
      .eq('account_id', ACCOUNT_ID)
      .in('value', values);
    if (error) throw new Error(`Failed overlap check: ${error.message}`);
    const existing = new Set((data ?? []).map((r) => `${r.type}:${r.value}`));
    alreadyPresent += chunk.filter((r) => existing.has(`${r.type}:${r.value}`)).length;
  }

  const toInsert = rows.length - alreadyPresent;
  console.log('[import-bravara-block-list-csv] overlap', {
    beforeCount: beforeCount ?? 0,
    alreadyPresent,
    toInsert,
  });

  if (dryRun) {
    console.log('[import-bravara-block-list-csv] dry-run complete; no writes');
    return;
  }

  let insertedApprox = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error, count } = await db
      .from('block_list')
      .upsert(chunk as never, {
        onConflict: 'account_id,value,type',
        ignoreDuplicates: true,
        count: 'exact',
      });
    if (error) throw new Error(`Upsert failed at offset ${i}: ${error.message}`);
    insertedApprox += count ?? 0;
    console.log(`[import-bravara-block-list-csv] upserted chunk ${i}-${i + chunk.length - 1}`);
  }

  const { count: afterCount, error: afterError } = await db
    .from('block_list')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', ACCOUNT_ID);
  if (afterError) throw new Error(`Failed to count after upsert: ${afterError.message}`);

  console.log('[import-bravara-block-list-csv] done', {
    beforeCount: beforeCount ?? 0,
    afterCount: afterCount ?? 0,
    delta: (afterCount ?? 0) - (beforeCount ?? 0),
    upsertReportedCount: insertedApprox,
  });
}

main().catch((error) => {
  console.error('[import-bravara-block-list-csv]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
