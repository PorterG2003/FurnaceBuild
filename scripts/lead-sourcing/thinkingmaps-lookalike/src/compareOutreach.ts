import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { join } from 'node:path';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSupabaseUrlForTarget,
} from '../../../self-recovery-env.js';
import { readCsv, writeCsv } from './lib/csv.js';
import { repoRoot } from './lib/env.js';

const ACCOUNT_ID = 'dce1f48b-ef5b-4bf7-b319-88d2dbc4a9ea';
const TODAY = new Date('2026-08-28T00:00:00Z');

type Campaign = {
  id: string;
  name: string;
  source: string | null;
  created_at: string;
  smartlead_created_at: string | null;
};

type Lead = {
  id: string;
  campaign_id: string;
  global_lead_id: string;
  email: string;
  company_name: string | null;
  custom_lead_data: Record<string, unknown> | null;
};

type DailyStat = {
  campaign_id: string;
  date: string;
  sent_count: number;
};

type EventRow = {
  campaign_id: string;
  created_at: string;
};

type DistrictOutreach = {
  people: Set<string>;
  companies: Set<string>;
  domains: Set<string>;
  campaigns: Set<string>;
  latestTouch: string;
  touchBasis: Set<string>;
};

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

async function allPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const output: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    output.push(...rows);
    if (rows.length < pageSize) return output;
  }
}

function domain(email: string): string {
  return email.includes('@') ? email.split('@').at(-1)!.toLowerCase() : '';
}

function later(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

function daysSince(date: string): string {
  if (!date) return '';
  const touchDay = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return String(Math.max(0, Math.floor((TODAY.getTime() - touchDay.getTime()) / 86_400_000)));
}

async function main(): Promise<void> {
  const supabase = await client();
  const { data: campaignData, error: campaignError } = await supabase
    .from('campaigns')
    .select('id,name,source,created_at,smartlead_created_at')
    .eq('account_id', ACCOUNT_ID)
    .is('deleted_at', null)
    .not('name', 'ilike', '%test%');
  if (campaignError) throw new Error(campaignError.message);
  const campaigns = (campaignData ?? []) as Campaign[];
  const campaignIds = campaigns.map((row) => row.id);
  const campaignById = new Map(campaigns.map((row) => [row.id, row]));

  const leads = await allPages<Lead>((from, to) =>
    supabase
      .from('leads')
      .select('id,campaign_id,global_lead_id,email,company_name,custom_lead_data')
      .in('campaign_id', campaignIds)
      .is('deleted_at', null)
      .order('id')
      .range(from, to),
  );
  const stats = await allPages<DailyStat>((from, to) =>
    supabase
      .from('imported_campaign_stats_by_day')
      .select('campaign_id,date,sent_count')
      .in('campaign_id', campaignIds)
      .gt('sent_count', 0)
      .order('campaign_id')
      .order('date')
      .range(from, to),
  );
  const events = await allPages<EventRow>((from, to) =>
    supabase
      .from('events')
      .select('campaign_id,created_at')
      .in('campaign_id', campaignIds)
      .eq('event_type', 'sent')
      .order('created_at')
      .range(from, to),
  );

  const campaignTouch = new Map<string, { date: string; basis: string }>();
  for (const stat of stats) {
    const current = campaignTouch.get(stat.campaign_id);
    if (!current || new Date(stat.date) > new Date(current.date)) {
      campaignTouch.set(stat.campaign_id, {
        date: `${stat.date}T23:59:59Z`,
        basis: 'smartlead_campaign_last_send',
      });
    }
  }
  for (const event of events) {
    const current = campaignTouch.get(event.campaign_id);
    if (!current || new Date(event.created_at) > new Date(current.date)) {
      campaignTouch.set(event.campaign_id, {
        date: event.created_at,
        basis: 'furnace_campaign_last_send',
      });
    }
  }
  for (const campaign of campaigns) {
    if (campaignTouch.has(campaign.id)) continue;
    campaignTouch.set(campaign.id, {
      date: campaign.smartlead_created_at ?? campaign.created_at,
      basis: 'campaign_start_fallback',
    });
  }

  const byDistrict = new Map<string, DistrictOutreach>();
  let missingDistrictId = 0;
  for (const lead of leads) {
    const districtId = String(lead.custom_lead_data?.nces_district_id ?? '').trim();
    if (!districtId) {
      missingDistrictId += 1;
      continue;
    }
    const aggregate = byDistrict.get(districtId) ?? {
      people: new Set<string>(),
      companies: new Set<string>(),
      domains: new Set<string>(),
      campaigns: new Set<string>(),
      latestTouch: '',
      touchBasis: new Set<string>(),
    };
    aggregate.people.add(lead.global_lead_id);
    if (lead.company_name) aggregate.companies.add(lead.company_name);
    const emailDomain = domain(lead.email);
    if (emailDomain) aggregate.domains.add(emailDomain);
    const campaign = campaignById.get(lead.campaign_id);
    if (campaign) aggregate.campaigns.add(campaign.name);
    const touch = campaignTouch.get(lead.campaign_id);
    if (touch) {
      aggregate.latestTouch = later(aggregate.latestTouch, touch.date);
      aggregate.touchBasis.add(touch.basis);
    }
    byDistrict.set(districtId, aggregate);
  }

  const inputPath = join(repoRoot, 'tmp/thinkingmaps-lookalike-districts.csv');
  const lookalikes = readCsv(inputPath);
  const addedColumns = [
    'outreach_people',
    'outreach_companies',
    'outreach_domains',
    'last_touch_date',
    'days_since_last_touch',
    'last_touch_basis',
    'outreach_campaigns',
  ];
  const columns = [...Object.keys(lookalikes[0] ?? {}), ...addedColumns];
  const reached: Record<string, string>[] = [];
  const neverReached: Record<string, string>[] = [];

  for (const row of lookalikes) {
    const outreach = byDistrict.get(row.leaid);
    if (!outreach) {
      neverReached.push(row);
      continue;
    }
    reached.push({
      ...row,
      outreach_people: String(outreach.people.size),
      outreach_companies: String(outreach.companies.size),
      outreach_domains: [...outreach.domains].sort().join('|'),
      last_touch_date: outreach.latestTouch.slice(0, 10),
      days_since_last_touch: daysSince(outreach.latestTouch),
      last_touch_basis: [...outreach.touchBasis].sort().join('|'),
      outreach_campaigns: [...outreach.campaigns].sort().join('|'),
    });
  }

  const reachedPath = join(repoRoot, 'tmp/thinkingmaps-lookalike-reached.csv');
  const neverPath = join(repoRoot, 'tmp/thinkingmaps-lookalike-never-reached.csv');
  writeCsv(reachedPath, reached, columns);
  writeCsv(neverPath, neverReached, Object.keys(lookalikes[0] ?? {}));
  console.log(
    JSON.stringify(
      {
        campaigns: campaigns.length,
        campaign_lead_rows: leads.length,
        lead_rows_missing_nces_district_id: missingDistrictId,
        reached_districts: reached.length,
        never_reached_districts: neverReached.length,
        reached_path: reachedPath,
        never_reached_path: neverPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
