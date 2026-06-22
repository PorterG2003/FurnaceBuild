import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import {
  CATEGORIZER_PROMPT_VERSION,
  MANUAL_SMART_HANDLING_VERSION,
} from '../lib/inbox/smartHandlingVersion.js';

type InteractionRow = {
  id: string;
  account_id: string;
  thread_id: string;
  suggestion_mode: 'manual' | 'ai' | null;
  suggestion_version: string | null;
  action: string;
  source: string;
  intent: {
    suggested_primary?: string | null;
    suggested_category?: string | null;
    matched_suggestion?: boolean | null;
  } | null;
  created_at: string;
};

type CliOptions = {
  version: string | 'all';
  mode: 'manual' | 'ai' | null;
  accountId: string | null;
  limit: number;
  exportCsv: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    version: 'default',
    mode: null,
    accountId: null,
    limit: 500,
    exportCsv: null,
  } as CliOptions & { version: string };

  for (const arg of argv) {
    if (arg.startsWith('--version=')) options.version = arg.slice('--version='.length) || 'default';
    else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      options.mode = value === 'manual' || value === 'ai' ? value : null;
    } else if (arg.startsWith('--account-id=')) options.accountId = arg.slice('--account-id='.length) || null;
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice('--limit='.length)) || 500;
    else if (arg.startsWith('--export-csv=')) options.exportCsv = arg.slice('--export-csv='.length) || null;
  }

  return {
    ...options,
    version: options.version === 'default'
      ? `${MANUAL_SMART_HANDLING_VERSION},${CATEGORIZER_PROMPT_VERSION}`
      : (options.version as string | 'all'),
  };
}

function resolveVersions(versionArg: string | 'all'): string[] | null {
  if (versionArg === 'all') return null;
  return versionArg
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function requireEnv(name: string, fallback?: string | null): string {
  const value = process.env[name]?.trim() || fallback?.trim() || '';
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function groupCount(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function csvEscape(value: unknown): string {
  const stringValue = value == null ? '' : String(value);
  if (!/[",\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const versions = resolveVersions(options.version);
  const supabase = createClient(
    requireEnv('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? null),
    requireEnv('SUPABASE_SECRET_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY ?? null),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let query = supabase
    .from('inbox_interactions')
    .select('id, account_id, thread_id, suggestion_mode, suggestion_version, action, source, intent, created_at')
    .order('created_at', { ascending: false })
    .limit(options.limit);

  if (options.accountId) query = query.eq('account_id', options.accountId);
  if (options.mode) query = query.eq('suggestion_mode', options.mode);
  if (versions?.length === 1) query = query.eq('suggestion_version', versions[0]);
  else if (versions && versions.length > 1) query = query.in('suggestion_version', versions);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load inbox interactions: ${error.message}`);
  }

  const rows = (data ?? []) as InteractionRow[];
  const rowsWithSuggestions = rows.filter((row) => row.intent?.suggested_primary || row.intent?.suggested_category);
  const mismatches = rowsWithSuggestions.filter((row) => row.intent?.matched_suggestion === false);
  const dismissals = rows.filter((row) => row.action === 'thread.dismiss_suggestion');
  const alternatePaths = rows.filter(
    (row) =>
      row.source !== 'smart_handling_bar'
      && (row.intent?.suggested_primary != null || row.intent?.suggested_category != null),
  );

  console.log(`Loaded ${rows.length} inbox interactions`);
  console.log(`Version filter: ${versions?.join(', ') ?? 'all'}`);
  if (options.mode) console.log(`Mode filter: ${options.mode}`);
  if (options.accountId) console.log(`Account filter: ${options.accountId}`);

  console.log('');
  console.log('Mismatch rate');
  console.log(`- mismatches: ${mismatches.length}/${rowsWithSuggestions.length || 0}`);

  const mismatchBreakdown = groupCount(
    mismatches.map((row) => {
      const suggested = row.intent?.suggested_primary ?? row.intent?.suggested_category ?? 'unknown';
      return `${row.suggestion_version ?? 'null'} | ${suggested} -> ${row.action} (${row.source})`;
    }),
  ).slice(0, 10);

  console.log('');
  console.log('Top mismatches');
  for (const [label, count] of mismatchBreakdown) {
    console.log(`- ${count}  ${label}`);
  }

  const dismissBreakdown = groupCount(
    dismissals.map((row) => `${row.suggestion_version ?? 'null'} | ${row.intent?.suggested_category ?? 'unknown'}`),
  );
  console.log('');
  console.log('Dismiss rates by version/category');
  for (const [label, count] of dismissBreakdown.slice(0, 10)) {
    console.log(`- ${count}  ${label}`);
  }

  console.log('');
  console.log('Alternate-path usage');
  console.log(`- alternate-path rows: ${alternatePaths.length}/${rows.length || 0}`);

  if (options.exportCsv) {
    const header = [
      'created_at',
      'account_id',
      'thread_id',
      'suggestion_mode',
      'suggestion_version',
      'suggested_primary',
      'suggested_category',
      'matched_suggestion',
      'action',
      'source',
    ];
    const lines = [
      header.join(','),
      ...rows.map((row) =>
        [
          row.created_at,
          row.account_id,
          row.thread_id,
          row.suggestion_mode,
          row.suggestion_version,
          row.intent?.suggested_primary ?? '',
          row.intent?.suggested_category ?? '',
          row.intent?.matched_suggestion ?? '',
          row.action,
          row.source,
        ].map(csvEscape).join(','),
      ),
    ];
    await fs.writeFile(options.exportCsv, `${lines.join('\n')}\n`, 'utf8');
    console.log('');
    console.log(`Exported CSV: ${options.exportCsv}`);
  }
}

main().catch((error) => {
  console.error('[analyze-inbox-interaction-mismatches] failed', error);
  process.exitCode = 1;
});
