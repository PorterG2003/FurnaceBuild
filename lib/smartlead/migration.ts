import Papa from 'papaparse';
import { supabase } from '@/lib/supabase/client';
import { ensureCampaignEnrollmentsForLeads } from '@/lib/supabase/services/campaigns';
import { generateGlobalLeadId } from '@/lib/supabase/services/leads';
import type { Campaign } from '@/lib/supabase/types';

const SMARTLEAD_BASE = 'https://server.smartlead.ai/api/v1';

/** Smartlead allows max 200 requests per minute. Min ms between requests to stay under that. */
const SMARTLEAD_RATE_LIMIT_MS = 350;
let lastSmartleadRequestTime = 0;

async function throttleSmartleadRequest(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastSmartleadRequestTime;
  if (elapsed < SMARTLEAD_RATE_LIMIT_MS && lastSmartleadRequestTime > 0) {
    await new Promise((r) => setTimeout(r, SMARTLEAD_RATE_LIMIT_MS - elapsed));
  }
  lastSmartleadRequestTime = Date.now();
}

export interface SmartleadCampaign {
  id: number;
  name: string;
  status?: string;
  parent_campaign_id?: number | null;
  created_at?: string;
}

export interface SmartleadLead {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  website?: string;
  linkedin_profile?: string;
  phone_number?: string;
  location?: string;
  company_url?: string;
  /** Smartlead custom_fields object (e.g. { "Title": "Regional Manager" }). */
  custom_fields?: Record<string, unknown>;
  /** Status from the list-leads wrapper (STARTED, INPROGRESS, COMPLETED, PAUSED, STOPPED, SENT, …) */
  status?: string;
  [key: string]: unknown;
}

/** Map Smartlead lead status → Furnace enrollment state. */
export function smartleadStatusToEnrollmentState(
  status: string | undefined,
): 'active' | 'completed' | 'stopped' | 'paused' {
  switch (status?.toUpperCase()) {
    case 'COMPLETED': return 'completed';
    case 'PAUSED':    return 'paused';
    case 'STOPPED':   return 'stopped';
    default:          return 'active'; // STARTED, INPROGRESS, SENT, unknown
  }
}

/** Normalized campaign stats from Smartlead (for campaign_stats table). */
export interface SmartleadCampaignStats {
  sent: number;
  replied: number;
  positiveReply: number;
  bounce: number;
  lastBounceAt: string | null;
}

/** Per-day stats from Smartlead (for events backfill / chart). */
export interface SmartleadStatsByDay {
  date: string;
  sent: number;
  replied: number;
  positiveReply: number;
  bounce: number;
}

// ---------------------------------------------------------------------------
// Smartlead API helpers
// ---------------------------------------------------------------------------

export async function fetchSmartleadCampaigns(apiKey: string): Promise<SmartleadCampaign[]> {
  await throttleSmartleadRequest();
  const url = `${SMARTLEAD_BASE}/analytics/campaign/list?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid API key. Please check your Smartlead API key and try again.');
    }
    throw new Error(`Smartlead API error (${res.status}). Please try again.`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.campaign_list)) return data.data.campaign_list;
  throw new Error('Unexpected response from Smartlead campaign list API.');
}

function parseLeadsResponse(text: string): SmartleadLead[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try JSON first
  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) return data as SmartleadLead[];
    if (Array.isArray(data?.data)) return data.data as SmartleadLead[];
    return [];
  } catch {
    // Response may be CSV (Smartlead sometimes returns CSV from leads-export)
  }

  // Try CSV (Smartlead leads-export sometimes returns CSV)
  try {
    const parsed = Papa.parse<Record<string, string>>(trimmed, { header: true, skipEmptyLines: true });
    if (parsed.errors.length > 0 || !parsed.meta.fields?.length) return [];

    const headers = parsed.meta.fields;
    const findCol = (...candidates: string[]) => {
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '_');
      for (const c of candidates) {
        const n = norm(c);
        const h = headers.find((x) => norm(x) === n || norm(x).includes(n) || n.includes(norm(x)));
        if (h) return h;
      }
      return null;
    };

    return parsed.data.map((row, index) => {
      const idCol = findCol('id', 'lead_id', 'leadid');
      const idStr = idCol ? row[idCol] : null;
      const id = idStr != null && idStr !== '' ? parseInt(String(idStr), 10) : index + 1;
      const numId = Number.isFinite(id) ? id : index + 1;
      const locationCol = findCol('location');
      const companyUrlCol = findCol('company_url', 'company url');
      return {
        id: numId,
        email: row[findCol('email') ?? ''] ?? undefined,
        first_name: row[findCol('first_name', 'firstname') ?? ''] ?? undefined,
        last_name: row[findCol('last_name', 'lastname') ?? ''] ?? undefined,
        company_name: row[findCol('company_name', 'company', 'companyname') ?? ''] ?? undefined,
        website: row[findCol('website') ?? ''] ?? undefined,
        linkedin_profile: row[findCol('linkedin_profile', 'linkedin') ?? ''] ?? undefined,
        phone_number: row[findCol('phone_number', 'phone') ?? ''] ?? undefined,
        location: locationCol ? (row[locationCol] ?? undefined) : undefined,
        company_url: companyUrlCol ? (row[companyUrlCol] ?? undefined) : undefined,
      } as SmartleadLead;
    });
  } catch {
    return [];
  }
}

const LEADS_PAGE_LIMIT = 100; // Smartlead API max is 100

/**
 * Fetch all leads for a campaign using the paginated List endpoint.
 * GET /campaigns/{campaign_id}/leads with offset/limit until all pages are fetched.
 */
export async function fetchSmartleadLeads(
  apiKey: string,
  smartleadCampaignId: number,
): Promise<SmartleadLead[]> {
  const enc = (s: string) => encodeURIComponent(s);
  const all: SmartleadLead[] = [];
  let offset = 0;

  const parseLead = (item: Record<string, unknown> & { lead?: Record<string, unknown> }): SmartleadLead => {
    const lead: Record<string, unknown> = item?.lead ?? item;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const customFields = lead.custom_fields;
    const customFieldsObj =
      customFields != null && typeof customFields === 'object' && !Array.isArray(customFields)
        ? (customFields as Record<string, unknown>)
        : undefined;
    return {
      id: num(lead.id),
      email: str(lead.email),
      first_name: str(lead.first_name),
      last_name: str(lead.last_name),
      company_name: str(lead.company_name),
      website: str(lead.website),
      linkedin_profile: str(lead.linkedin_profile),
      phone_number: lead.phone_number != null ? String(lead.phone_number) : undefined,
      location: str(lead.location),
      company_url: str(lead.company_url),
      custom_fields: customFieldsObj,
      // status lives on the wrapper object, not on lead
      status: str(item.status),
    };
  };

  while (true) {
    await throttleSmartleadRequest();
    const url =
      `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/leads` +
      `?api_key=${enc(apiKey)}&offset=${offset}&limit=${LEADS_PAGE_LIMIT}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Smartlead leads API error (${res.status}) for campaign ${smartleadCampaignId}.`);
    }
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const item of data) {
      all.push(parseLead(item));
    }
    // Only stop when we get a partial page; don't rely on total_leads (API may cap it at 1000)
    if (data.length < LEADS_PAGE_LIMIT) {
      break;
    }
    offset += data.length;
  }
  return all;
}

function parseSmartleadCampaignStatsResponse(raw: unknown): SmartleadCampaignStats {
  const data = (raw as any)?.data ?? raw;
  const num = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const parsed = Number(v.trim());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

  return {
    sent: num(data?.emails_sent ?? data?.emails_sent_count ?? data?.sent_count ?? data?.sent),
    replied: num(data?.num_replied ?? data?.replied_count ?? data?.replied ?? data?.replies),
    positiveReply: num(
      data?.positive_reply_count ?? data?.positive_replies ?? data?.interested_count ?? data?.positiveReply,
    ),
    bounce: num(data?.bounce_count ?? data?.bounced ?? data?.bounces ?? data?.bounce),
    lastBounceAt: str(data?.last_bounce_at) ?? null,
  };
}

/**
 * Aggregate per-day stats into a single SmartleadCampaignStats (totals). lastBounceAt remains null.
 */
function aggregateStatsByDay(byDay: SmartleadStatsByDay[]): SmartleadCampaignStats {
  let sent = 0;
  let replied = 0;
  let positiveReply = 0;
  let bounce = 0;
  for (const row of byDay) {
    sent += row.sent;
    replied += row.replied;
    positiveReply += row.positiveReply;
    bounce += row.bounce;
  }
  return { sent, replied, positiveReply, bounce, lastBounceAt: null };
}

/**
 * Fetch campaign-level stats from Smartlead (totals for campaign_stats).
 * Tries in order:
 * 1. campaigns/{campaign_id}/analytics (top-level campaign analytics)
 * 2. campaigns/{campaign_id}/analytics-by-date (date-range analytics)
 * 3. Fallback: derive totals from fetchSmartleadCampaignStatsByDay when available
 */
export async function fetchSmartleadCampaignStats(
  apiKey: string,
  smartleadCampaignId: number,
): Promise<SmartleadCampaignStats> {
  const enc = (s: string) => encodeURIComponent(s);
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = '2015-01-01';

  const urls = [
    `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/analytics?api_key=${enc(apiKey)}`,
    `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/analytics-by-date?api_key=${enc(apiKey)}&start_date=${startDate}&end_date=${endDate}`,
  ];

  for (const url of urls) {
    await throttleSmartleadRequest();
    const res = await fetch(url);
    if (res.ok) {
      const raw = await res.json();
      return parseSmartleadCampaignStatsResponse(raw);
    }
  }

  // Fallback: get day-wise stats and sum into totals (no lastBounceAt)
  const byDay = await fetchSmartleadCampaignStatsByDay(apiKey, smartleadCampaignId, startDate, endDate);
  if (byDay.length > 0) {
    return aggregateStatsByDay(byDay);
  }

  throw new Error(`Smartlead stats API error for campaign ${smartleadCampaignId} (all endpoints returned non-OK).`);
}


const numFromResponse = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const STATS_RANGE_MAX_DAYS = 30;

/**
 * Fetch aggregated stats for a date range from Smartlead (analytics-by-date).
 * API requires start_date & end_date to be at most 30 days apart.
 */
async function fetchSmartleadCampaignStatsRange(
  apiKey: string,
  smartleadCampaignId: number,
  startDate: string,
  endDate: string,
): Promise<SmartleadCampaignStats> {
  const enc = (s: string) => encodeURIComponent(s);
  await throttleSmartleadRequest();
  const url =
    `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/analytics-by-date` +
    `?api_key=${enc(apiKey)}&start_date=${enc(startDate)}&end_date=${enc(endDate)}`;
  const res = await fetch(url);
  if (!res.ok) return { sent: 0, replied: 0, positiveReply: 0, bounce: 0, lastBounceAt: null };
  const raw = await res.json();
  return parseSmartleadCampaignStatsResponse(raw);
}

/** Add days to a YYYY-MM-DD date string; returns YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Return the earlier of two YYYY-MM-DD strings. */
function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * Find the end date for day-by-day stats. Smartlead only allows max 30-day ranges,
 * so we slide 30-day windows from startDate, accumulate stats, then binary-search
 * within the window where cumulative stats reach the total.
 */
async function findSmartleadCampaignStatsEndDate(
  apiKey: string,
  smartleadCampaignId: number,
  startDate: string,
  totalStats: SmartleadCampaignStats,
): Promise<string> {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (startDate > todayStr) return startDate;
  if (totalStats.sent === 0 && totalStats.replied === 0 && totalStats.bounce === 0) return startDate;

  const running = { sent: 0, replied: 0, bounce: 0 };
  let windowStart = startDate;

  while (windowStart <= todayStr) {
    const windowEnd = minDate(addDays(windowStart, STATS_RANGE_MAX_DAYS - 1), todayStr);
    const rangeStats = await fetchSmartleadCampaignStatsRange(
      apiKey,
      smartleadCampaignId,
      windowStart,
      windowEnd,
    );
    running.sent += rangeStats.sent;
    running.replied += rangeStats.replied;
    running.bounce += rangeStats.bounce;

    const hasAll =
      running.sent >= totalStats.sent &&
      running.replied >= totalStats.replied &&
      running.bounce >= totalStats.bounce;

    if (hasAll) {
      const runningPrev = {
        sent: running.sent - rangeStats.sent,
        replied: running.replied - rangeStats.replied,
        bounce: running.bounce - rangeStats.bounce,
      };
      const needInWindow = {
        sent: totalStats.sent - runningPrev.sent,
        replied: totalStats.replied - runningPrev.replied,
        bounce: totalStats.bounce - runningPrev.bounce,
      };
      let lowT = new Date(windowStart + 'T00:00:00.000Z').getTime();
      let highT = new Date(windowEnd + 'T00:00:00.000Z').getTime();
      const maxIters = 32;
      for (let iter = 0; iter < maxIters && lowT < highT; iter++) {
        const midT = Math.floor((lowT + highT) / 2);
        const midStr = new Date(midT).toISOString().slice(0, 10);
        const inWindow = await fetchSmartleadCampaignStatsRange(
          apiKey,
          smartleadCampaignId,
          windowStart,
          midStr,
        );
        const hasEnough =
          inWindow.sent >= needInWindow.sent &&
          inWindow.replied >= needInWindow.replied &&
          inWindow.bounce >= needInWindow.bounce;
        if (hasEnough) highT = new Date(midStr + 'T00:00:00.000Z').getTime();
        else lowT = new Date(midStr + 'T00:00:00.000Z').getTime() + 86400000;
      }
      const resolved = new Date(highT).toISOString().slice(0, 10);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Smartlead migration] findEndDate', {
          smartleadCampaignId,
          startDate,
          endDate: resolved,
          totalStats: { sent: totalStats.sent, replied: totalStats.replied, bounce: totalStats.bounce },
        });
      }
      return resolved;
    }

    windowStart = addDays(windowEnd, 1);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[Smartlead migration] findEndDate: no window reached total, using today', {
      smartleadCampaignId,
      startDate,
      running,
      totalStats,
    });
  }
  return todayStr;
}

/**
 * Fetch day-wise stats from Smartlead by calling analytics-by-date once per day.
 * Returns array of { date, sent, replied, positiveReply, bounce } for upsert into imported_campaign_stats_by_day.
 */
export async function fetchSmartleadCampaignStatsByDay(
  apiKey: string,
  smartleadCampaignId: number,
  startDate: string,
  endDate: string,
): Promise<SmartleadStatsByDay[]> {
  const enc = (s: string) => encodeURIComponent(s);
  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T00:00:00.000Z');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const byDay: SmartleadStatsByDay[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    await throttleSmartleadRequest();
    const url =
      `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/analytics-by-date` +
      `?api_key=${enc(apiKey)}&start_date=${d}&end_date=${d}`;
    const res = await fetch(url);
    if (res.ok) {
      const raw = await res.json();
      const data = (raw as any)?.data ?? raw;
      byDay.push({
        date: d,
        sent: numFromResponse(data?.sent_count ?? data?.emails_sent),
        replied: numFromResponse(data?.reply_count ?? data?.num_replied),
        positiveReply: numFromResponse(data?.positive_reply_count ?? 0),
        bounce: numFromResponse(data?.bounce_count),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return byDay;
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

export async function upsertCampaignFromSmartlead(
  sl: SmartleadCampaign,
  accountId: string,
  ownerId: string,
): Promise<Campaign> {
  const now = new Date().toISOString();

  const row = {
    name: sl.name,
    owner_id: ownerId,
    account_id: accountId,
    status: 'stopped' as const,
    source: 'smartlead',
    smartlead_campaign_id: sl.id,
    smartlead_created_at: sl.created_at ?? null,
    locked: false,
    sending_interval_seconds: 300,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('campaigns')
    .upsert(row as any, { onConflict: 'smartlead_campaign_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert campaign "${sl.name}": ${error.message}`);
  if (!data) throw new Error(`No data returned when upserting campaign "${sl.name}".`);
  return data as Campaign;
}

const LEAD_BATCH_SIZE = 200;

function isLinkedInUrl(url: string): boolean {
  return /linkedin\.com/i.test(url.trim());
}

/** Normalize a value for JSONB: only string, number, boolean; else stringify. */
function jsonbSafeValue(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

/**
 * Build custom_lead_data from Smartlead lead: merge custom_fields, then set location (if value),
 * and company_url (if value and not a LinkedIn URL). Prefer explicit location/company_url over
 * keys from custom_fields.
 */
function buildCustomLeadData(sl: SmartleadLead): Record<string, string | number | boolean> | null {
  const out: Record<string, string | number | boolean> = {};
  if (sl.custom_fields && typeof sl.custom_fields === 'object' && !Array.isArray(sl.custom_fields)) {
    for (const [k, v] of Object.entries(sl.custom_fields)) {
      out[k] = jsonbSafeValue(v);
    }
  }
  const location = sl.location?.trim();
  if (location) out.location = location;
  const companyUrl = sl.company_url?.trim();
  if (companyUrl && !isLinkedInUrl(companyUrl)) out.company_url = companyUrl;
  if (Object.keys(out).length === 0) return null;
  return out;
}

export async function upsertLeadsFromSmartlead(
  campaignId: string,
  bucketId: string,
  accountId: string,
  smartleadLeads: SmartleadLead[],
): Promise<string[]> {
  if (smartleadLeads.length === 0) return [];

  const allLeadIds: string[] = [];

  for (let i = 0; i < smartleadLeads.length; i += LEAD_BATCH_SIZE) {
    const batch = smartleadLeads.slice(i, i + LEAD_BATCH_SIZE);
    const now = new Date().toISOString();

    const rows = await Promise.all(
      batch.map(async (sl) => {
        const email = sl.email?.trim() || null;
        const globalLeadId = await generateGlobalLeadId(email);
        const companyUrl = sl.company_url?.trim();
        const companyLinkedInUrl =
          companyUrl && isLinkedInUrl(companyUrl) ? companyUrl : null;
        const customLeadData = buildCustomLeadData(sl);

        return {
          campaign_id: campaignId,
          bucket_id: bucketId,
          account_id: accountId,
          email,
          first_name: sl.first_name?.trim() || null,
          last_name: sl.last_name?.trim() || null,
          company_name: sl.company_name?.trim() || null,
          website: sl.website?.trim() || null,
          linkedin_url: sl.linkedin_profile?.trim() || null,
          company_linkedin_url: companyLinkedInUrl,
          phone_number: sl.phone_number?.trim() || null,
          custom_lead_data: customLeadData,
          source: 'smartlead',
          smartlead_lead_id: sl.id,
          global_lead_id: globalLeadId,
          status: 'new' as const,
          created_at: now,
          updated_at: now,
        };
      }),
    );

    const { data, error } = await supabase
      .from('leads')
      .upsert(rows as any, { onConflict: 'smartlead_lead_id' })
      .select('id');

    if (error) throw new Error(`Failed to upsert leads batch: ${error.message}`);
    if (data) allLeadIds.push(...data.map((r: any) => r.id));
  }

  return allLeadIds;
}

/**
 * Update campaign_stats row for a Furnace campaign with Smartlead totals.
 * Row already exists (created by trigger on campaign insert). Idempotent.
 */
export async function upsertCampaignStatsFromSmartlead(
  furnaceCampaignId: string,
  accountId: string,
  stats: SmartleadCampaignStats,
): Promise<void> {
  const { error } = await supabase
    .from('campaign_stats')
    .update({
      sent_count: stats.sent,
      replied_count: stats.replied,
      positive_reply_count: stats.positiveReply,
      bounce_count: stats.bounce,
      last_bounce_at: stats.lastBounceAt,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', furnaceCampaignId);

  if (error) throw new Error(`Failed to update campaign_stats: ${error.message}`);
}

/**
 * Upsert per-day stats into imported_campaign_stats_by_day (idempotent).
 * Used for Smartlead and other imported campaigns instead of synthetic events.
 */
export async function upsertImportedCampaignStatsByDay(
  campaignId: string,
  byDay: SmartleadStatsByDay[],
): Promise<void> {
  if (byDay.length === 0) return;
  const now = new Date().toISOString();
  const rows = byDay.map((day) => ({
    campaign_id: campaignId,
    date: day.date,
    sent_count: day.sent,
    replied_count: day.replied,
    positive_reply_count: day.positiveReply,
    bounce_count: day.bounce,
    updated_at: now,
  }));
  if (process.env.NODE_ENV !== 'production') {
    const first = byDay[0];
    const last = byDay[byDay.length - 1];
    console.log('[Smartlead migration] upsertImportedCampaignStatsByDay', {
      campaignId,
      rowCount: byDay.length,
      dateRange: first && last ? { from: first.date, to: last.date } : null,
      sampleFirst: first ? { date: first.date, sent: first.sent, replied: first.replied, bounce: first.bounce } : null,
      sampleLast: last && last !== first ? { date: last.date, sent: last.sent, replied: last.replied, bounce: last.bounce } : null,
    });
  }
  const { error } = await supabase
    .from('imported_campaign_stats_by_day')
    .upsert(rows, { onConflict: 'campaign_id,date', ignoreDuplicates: false });
  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[Smartlead migration] upsertImportedCampaignStatsByDay error', { campaignId, error: error.message, byDayLength: byDay.length });
    }
    throw new Error(`Failed to upsert imported campaign stats by day: ${error.message}`);
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Smartlead migration] upsertImportedCampaignStatsByDay ok', { campaignId, rowCount: byDay.length });
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface MigrationProgress {
  campaignIndex: number;
  campaignCount: number;
  campaignName: string;
  phase: 'campaign' | 'leads' | 'enrollments' | 'stats' | 'done';
  leadCount?: number;
}

export interface CampaignMigrationResult {
  campaignName: string;
  status: 'succeeded' | 'failed';
  error?: string;
  leadsImported?: number;
  totalsStatsImported?: boolean;
  dayByDayStatsImported?: boolean;
}

export async function migrateSmartleadCampaigns(
  apiKey: string,
  selectedCampaigns: SmartleadCampaign[],
  accountId: string,
  ownerId: string,
  onProgress?: (p: MigrationProgress) => void,
): Promise<{
  succeeded: string[];
  failed: { name: string; error: string }[];
  statsImported: boolean;
  totalLeadsImported: number;
  campaignResults: CampaignMigrationResult[];
}> {
  const succeeded: string[] = [];
  const failed: { name: string; error: string }[] = [];
  const campaignResults: CampaignMigrationResult[] = [];
  let statsApiAvailable: boolean | null = null;
  let totalLeadsImported = 0;

  for (let i = 0; i < selectedCampaigns.length; i++) {
    const sl = selectedCampaigns[i];
    const campaignResult: CampaignMigrationResult = {
      campaignName: sl.name,
      status: 'succeeded',
      leadsImported: 0,
      totalsStatsImported: false,
      dayByDayStatsImported: false,
    };
    try {
      onProgress?.({ campaignIndex: i, campaignCount: selectedCampaigns.length, campaignName: sl.name, phase: 'campaign' });

      const campaign = await upsertCampaignFromSmartlead(sl, accountId, ownerId);

      onProgress?.({ campaignIndex: i, campaignCount: selectedCampaigns.length, campaignName: sl.name, phase: 'leads' });

      const smartleadLeads = await fetchSmartleadLeads(apiKey, sl.id);

      const leadIds = await upsertLeadsFromSmartlead(
        campaign.id,
        campaign.bucket_id,
        accountId,
        smartleadLeads,
      );

      campaignResult.leadsImported = leadIds.length;

      onProgress?.({
        campaignIndex: i,
        campaignCount: selectedCampaigns.length,
        campaignName: sl.name,
        phase: 'enrollments',
        leadCount: leadIds.length,
      });

      await ensureCampaignEnrollmentsForLeads(
        campaign.id,
        leadIds,
        smartleadLeads.map((l) => smartleadStatusToEnrollmentState(l.status)),
      );

      if (statsApiAvailable !== false) {
        onProgress?.({ campaignIndex: i, campaignCount: selectedCampaigns.length, campaignName: sl.name, phase: 'stats' });

        try {
          const stats = await fetchSmartleadCampaignStats(apiKey, sl.id);
          statsApiAvailable = true;
          await upsertCampaignStatsFromSmartlead(campaign.id, accountId, stats);
          campaignResult.totalsStatsImported = true;

          const startDate = (sl.created_at ?? new Date().toISOString()).slice(0, 10);
          const endDate = await findSmartleadCampaignStatsEndDate(apiKey, sl.id, startDate, stats);
          if (process.env.NODE_ENV !== 'production') {
            console.log('[Smartlead migration] day-by-day range', {
              campaignName: sl.name,
              furnaceCampaignId: campaign.id,
              smartleadCampaignId: sl.id,
              startDate,
              endDate,
              totals: { sent: stats.sent, replied: stats.replied, bounce: stats.bounce },
            });
          }
          const byDay = await fetchSmartleadCampaignStatsByDay(apiKey, sl.id, startDate, endDate);
          if (process.env.NODE_ENV !== 'production') {
            const sample = byDay.slice(0, 3).concat(byDay.length > 6 ? byDay.slice(-3) : byDay.slice(3, 6));
            console.log('[Smartlead migration] fetchSmartleadCampaignStatsByDay result', {
              campaignName: sl.name,
              furnaceCampaignId: campaign.id,
              dayCount: byDay.length,
              dateRange: byDay.length ? { from: byDay[0].date, to: byDay[byDay.length - 1].date } : null,
              sample: sample.map((d) => ({ date: d.date, sent: d.sent, replied: d.replied, bounce: d.bounce })),
            });
          }
          if (byDay.length > 0) {
            await upsertImportedCampaignStatsByDay(campaign.id, byDay);
            campaignResult.dayByDayStatsImported = true;
          }
        } catch (statsErr) {
          statsApiAvailable = false;
          if (i === 0) {
            console.warn(
              '[Smartlead] Stats could not be imported (API returned 400/404). Campaign and lead data were imported successfully.',
            );
          }
        }
      }

      totalLeadsImported += leadIds.length;
      succeeded.push(sl.name);
      campaignResults.push(campaignResult);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      failed.push({ name: sl.name, error: errorMessage });
      campaignResults.push({
        campaignName: sl.name,
        status: 'failed',
        error: errorMessage,
      });
    }
  }

  onProgress?.({ campaignIndex: selectedCampaigns.length, campaignCount: selectedCampaigns.length, campaignName: '', phase: 'done' });

  return {
    succeeded,
    failed,
    statsImported: statsApiAvailable === true,
    totalLeadsImported,
    campaignResults,
  };
}
