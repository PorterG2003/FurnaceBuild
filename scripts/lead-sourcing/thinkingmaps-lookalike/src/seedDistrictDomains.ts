import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { join } from 'node:path';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSupabaseUrlForTarget,
} from '../../../self-recovery-env.js';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import { writeJson } from './lib/io.js';
import { padLeaid } from './schoolNames.js';
import { FREE_MAIL } from './directoryParse.js';
import type { ListedSchool } from './types.js';

const ACCOUNT_ID = 'dce1f48b-ef5b-4bf7-b319-88d2dbc4a9ea';

export type DistrictDomain = {
  leaid: string;
  lea_name: string;
  domain: string;
  email_count: number;
  source: string;
};

export const DISTRICT_DOMAIN_COLUMNS = ['leaid', 'lea_name', 'domain', 'email_count', 'source'] as const;

async function client(): Promise<SupabaseClient> {
  loadSelfRecoveryEnv();
  const { url } = resolveSupabaseUrlForTarget('prod');
  const region = process.env.AWS_REGION?.trim() || 'us-west-2';
  const secretPath = resolveSecretParamPathForTarget('prod');
  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;
  if (secretPath) key = await fetchSecretFromParameterStore(secretPath, region);
  if (!url || !key) throw new Error('Missing prod Supabase URL or service key');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function emailDomain(email: string): string {
  return email.includes('@') ? email.split('@').at(-1)!.toLowerCase() : '';
}

export function pickDominantDomain(counts: Map<string, number>): { domain: string; count: number } | null {
  const ranked = [...counts.entries()]
    .filter(([domain]) => domain && !FREE_MAIL.has(domain))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const best = ranked[0];
  if (!best) return null;
  return { domain: best[0], count: best[1] };
}

export function loadDistrictDomainsCsv(path: string): DistrictDomain[] {
  return readCsv(path).map((row) => ({
    leaid: padLeaid(row.leaid),
    lea_name: row.lea_name ?? '',
    domain: row.domain.trim().toLowerCase(),
    email_count: Number(row.email_count) || 0,
    source: row.source || 'csv',
  }));
}

export function domainsFromEligible(schools: ListedSchool[], domains: DistrictDomain[]): DistrictDomain[] {
  const wanted = new Set(schools.map((row) => row.leaid));
  const names = new Map(schools.map((row) => [row.leaid, row.lea_name]));
  return domains
    .filter((row) => wanted.has(row.leaid))
    .map((row) => ({ ...row, lea_name: row.lea_name || names.get(row.leaid) || '' }));
}

export async function seedDistrictDomainsFromFurnace(schools: ListedSchool[]): Promise<DistrictDomain[]> {
  const wanted = new Set(schools.map((row) => row.leaid));
  const names = new Map(schools.map((row) => [row.leaid, row.lea_name]));
  const supabase = await client();
  const { data: campaignData, error: campaignError } = await supabase
    .from('campaigns')
    .select('id,name')
    .eq('account_id', ACCOUNT_ID)
    .is('deleted_at', null)
    .not('name', 'ilike', '%test%');
  if (campaignError) throw new Error(campaignError.message);
  const campaignIds = (campaignData ?? []).map((row) => row.id as string);

  const counts = new Map<string, Map<string, number>>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('leads')
      .select('email,custom_lead_data')
      .in('campaign_id', campaignIds)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      const leaid = padLeaid(String((row.custom_lead_data as Record<string, unknown> | null)?.nces_district_id ?? ''));
      if (!wanted.has(leaid)) continue;
      const domain = emailDomain(String(row.email ?? ''));
      if (!domain) continue;
      const byDomain = counts.get(leaid) ?? new Map<string, number>();
      byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
      counts.set(leaid, byDomain);
    }
    if (rows.length < pageSize) break;
  }

  const out: DistrictDomain[] = [];
  for (const leaid of wanted) {
    const picked = pickDominantDomain(counts.get(leaid) ?? new Map());
    if (!picked) continue;
    out.push({
      leaid,
      lea_name: names.get(leaid) ?? '',
      domain: picked.domain,
      email_count: picked.count,
      source: 'furnace_email',
    });
  }
  return out.sort((a, b) => a.lea_name.localeCompare(b.lea_name));
}

export function writeDistrictDomains(runDir: string, rows: DistrictDomain[]): void {
  writeCsv(join(runDir, 'district_domains.csv'), rows.map((row) => rowToRecord(row)), DISTRICT_DOMAIN_COLUMNS);
  writeJson(join(runDir, 'district_domains_summary.json'), {
    districts_with_domain: rows.length,
    sources: Object.fromEntries(
      [...new Set(rows.map((row) => row.source))].map((source) => [
        source,
        rows.filter((row) => row.source === source).length,
      ]),
    ),
  });
}
