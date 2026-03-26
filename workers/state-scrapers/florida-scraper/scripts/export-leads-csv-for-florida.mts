/**
 * Build data/input.csv for Docker CSV mode from leads Supabase companies.
 *
 * Loads LEADS_SUPABASE_URL + LEADS_SUPABASE_SECRET_KEY from repo-root .env.local then .env
 * (simple KEY=value lines). Writes workers/state-scrapers/florida-scraper/data/input.csv
 *
 * Usage: npx tsx scripts/export-leads-csv-for-florida.mts
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const OUT_DIR = path.resolve(__dirname, '../data');
const OUT_CSV = path.join(OUT_DIR, 'input.csv');

/** Default batch from operator list (override with FLORIDA_EXPORT_IDS=comma,separated) */
const DEFAULT_IDS = [
  '24dddb0a-f0c2-42c3-939b-a87089ed3bec',
  'a6c7f2bb-a3f3-4224-badb-b5c5ce8727ad',
  'ba58756b-ac7d-41be-9f95-374465007e94',
  '7403f13a-8d9f-4f40-82f3-c6de30fcc04c',
  'e9eb42fa-bb0c-4517-9389-4af860381538',
  '96775465-dcf3-446b-92ab-c35f7d28847d',
  'e1a8808b-7d86-410a-8b62-eb42183f7f6d',
  'b88d0e0a-d79f-4cf8-b009-ef4414118505',
  '67748d3a-c041-4a85-92f5-d09eb95d6c26',
  '17eeed39-1cfc-4d17-b6e5-e00402af5ff4',
  'c6dbaf30-d209-4066-82f4-9d38121a8157',
  'af744d51-2c42-40a8-a1c4-174a3eef866f',
  '5767bd12-c769-4830-b209-9a46d0e6bceb',
  'c78b7ff3-5fa7-4291-afe4-1535e95b0e1f',
  '329fc32a-c174-4c70-bc99-0d313dbfc83d',
  '53613490-715f-4195-ae8e-71c6345fb326',
  '7d67eb8b-087d-4d4d-8c8f-0f751f271a0b',
  'd60b6858-0901-4122-8392-ecf8a13eee9c',
  '9f8c05ce-26c8-4479-873c-cdf64189c0a3',
  'e3416134-2277-4b35-923c-271dd1243242',
  'f1746fb6-ce59-4ec1-a141-821f6098fe40',
  '55f8dc20-e2d8-45af-8c2d-a8c623894f00',
  'f4b966ff-1739-4d21-8d11-ceb6c0ced6fc',
  'addc460d-1fec-4154-ab1c-0635d16cd88f',
  'e8240cf2-810a-44da-9b13-fa085b2f7e01',
  '0c6abca7-7ac1-49d7-a087-cdae5d31cdcc',
  '3ef6eb72-9cc8-486b-a003-2e2edad9f158',
  '924e7d50-3339-4d26-80ec-eb9af4479568',
  '52cba5fe-33de-4490-96f7-cc0f60b4a9a2',
  '7dd52e4b-cca3-4040-b1bd-b5f25499b37a',
  '0dab1baa-4056-43af-b5de-62b4b8033196',
  'f3dde028-845f-4b8e-b186-ef5dd31fbd28',
  'f06c7c56-a22e-4948-8618-7d9f53dc74ef',
  '3fb891ab-178e-4866-93cf-b05208be6320',
];

function loadDotEnvFile(filePath: string): void {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main(): Promise<void> {
  loadDotEnvFile(path.join(REPO_ROOT, '.env.local'));
  loadDotEnvFile(path.join(REPO_ROOT, '.env'));

  const url = process.env.LEADS_SUPABASE_URL?.trim();
  const secret = process.env.LEADS_SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    console.error(
      'Missing LEADS_SUPABASE_URL or LEADS_SUPABASE_SECRET_KEY after loading .env.local / .env from repo root.',
    );
    console.error('Add LEADS_SUPABASE_SECRET_KEY (service role) to .env.local, then re-run.');
    process.exit(1);
  }

  const idsEnv = process.env.FLORIDA_EXPORT_IDS?.trim();
  const ids = idsEnv
    ? idsEnv.split(/[\s,]+/).filter(Boolean)
    : DEFAULT_IDS;

  const client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await client
    .from('companies')
    .select('id, legal_name')
    .in('id', ids);
  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  const byId = new Map((rows ?? []).map((r) => [r.id as string, (r.legal_name as string) ?? '']));
  const header = 'Id,Company Name,Enrich company,Name - People - Results';
  const lines = [header];
  for (const id of ids) {
    const name = byId.get(id) ?? '';
    if (!name) {
      console.warn(`Warning: no company row for id ${id}; empty Company Name`);
    }
    lines.push(
      [csvEscape(id), csvEscape(name), '', ''].join(','),
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_CSV, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${lines.length - 1} rows to ${OUT_CSV}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
