import Papa from 'papaparse';
import { stripHtml } from '@furnace/email-lib';
import type { Campaign } from '@/lib/supabase/types';
import type { Database } from '@/lib/supabase/types/database';
import { SMARTLEAD_BASE, smartleadRequest } from '@/lib/smartlead/api';

type MigrationDatabaseClient = {
  from: (...args: any[]) => any;
};

async function resolveMigrationDb(
  db?: MigrationDatabaseClient,
): Promise<MigrationDatabaseClient> {
  if (!db) {
    throw new Error('A migration database client is required for Smartlead import operations.');
  }

  return db;
}

async function generateGlobalLeadIdForMigration(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.toLowerCase().trim());
    const hashBuffer = await subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

async function ensureCampaignEnrollmentsForLeadsInDb(
  db: MigrationDatabaseClient,
  campaignId: string,
  leadIds: string[],
  enrollmentStates?: Array<'active' | 'completed' | 'stopped' | 'paused'>,
): Promise<void> {
  if (!leadIds.length) return;

  const { data: campaignData, error: campaignError } = await (db
    .from('campaigns')
    .select('account_id')
    .eq('id', campaignId)
    .single() as any);
  const campaign = campaignData as { account_id: string | null } | null;

  if (campaignError || !campaign?.account_id) {
    throw new Error(`Campaign not found or missing account_id: ${campaignError?.message}`);
  }

  const rows = leadIds.map((leadId, index) => ({
    campaign_id: campaignId,
    account_id: campaign.account_id,
    lead_id: leadId,
    current_node_id: null,
    state: enrollmentStates?.[index] ?? 'active',
    next_run_at: new Date().toISOString(),
    flow_position: {},
  }));

  const { error } = await (db
    .from('enrollments')
    .upsert(rows as any, {
      onConflict: 'campaign_id,lead_id',
      ignoreDuplicates: enrollmentStates === undefined,
    }) as any);

  if (error) {
    throw new Error(`Failed to ensure campaign enrollments: ${error.message}`);
  }
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

export interface SmartleadInboxReplyLead {
  email_lead_id: number;
  email_campaign_id: number | null;
  lead_email?: string;
  lead_first_name?: string;
  lead_last_name?: string;
}

export interface SmartleadMessageHistoryItem {
  stats_id?: string;
  from: string;
  to: string;
  type: 'SENT' | 'REPLY';
  message_id?: string;
  time: string;
  email_body?: string;
  subject?: string;
  cc?: string[];
  raw: Record<string, unknown>;
}

type SmartleadLeadEnrollmentMapValue = {
  leadId: string;
  enrollmentId: string | null;
};

const SMARTLEAD_INBOX_REPLIES_PAGE_LIMIT = 20;

/** Max lead_id count per enrollments request to avoid URL length 400 (Supabase/PostgREST). */
const ENROLLMENTS_IN_QUERY_BATCH_SIZE = 25;

// ---------------------------------------------------------------------------
// Smartlead API helpers
// ---------------------------------------------------------------------------

export async function fetchSmartleadCampaigns(apiKey: string): Promise<SmartleadCampaign[]> {
  const url = `${SMARTLEAD_BASE}/analytics/campaign/list?api_key=${encodeURIComponent(apiKey)}`;
  const res = await smartleadRequest({ url });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid API key. Please check your Smartlead API key and try again.');
    }
    throw new Error(`Smartlead API error (${res.status}). Please try again.`);
  }
  const data = await res.json() as any;
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
    const url =
      `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/leads` +
      `?api_key=${enc(apiKey)}&offset=${offset}&limit=${LEADS_PAGE_LIMIT}`;
    const res = await smartleadRequest({ url });
    if (!res.ok) {
      throw new Error(`Smartlead leads API error (${res.status}) for campaign ${smartleadCampaignId}.`);
    }
    const json = await res.json() as any;
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

function smartleadApiErrorMessage(res: Response, resource: string): string {
  if (res.status === 401 || res.status === 403) {
    return 'Invalid API key. Please check your Smartlead API key and try again.';
  }
  return `Smartlead ${resource} API error (${res.status}).`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildSmartleadLeadName(firstName?: string, lastName?: string): string | null {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ').trim();
  return fullName || null;
}

function parseSmartleadInboxReplyLead(item: unknown): SmartleadInboxReplyLead | null {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;
  const emailLeadId = numberOrNull(row.email_lead_id);
  if (emailLeadId == null) return null;
  return {
    email_lead_id: emailLeadId,
    email_campaign_id: numberOrNull(row.email_campaign_id),
    lead_email: stringOrUndefined(row.lead_email),
    lead_first_name: stringOrUndefined(row.lead_first_name),
    lead_last_name: stringOrUndefined(row.lead_last_name),
  };
}

async function fetchSmartleadInboxRepliesPage(
  apiKey: string,
  offset: number,
  limit: number,
  campaignIdFilter: number | null,
): Promise<{ data: unknown[]; json: unknown }> {
  const enc = (s: string) => encodeURIComponent(s);
  const url =
    `${SMARTLEAD_BASE}/master-inbox/inbox-replies` +
    `?api_key=${enc(apiKey)}&fetch_message_history=false`;
  const body: { offset: number; limit: number; filters?: { campaignId: number[] }; sortBy: string } = {
    offset,
    limit,
    sortBy: 'REPLY_TIME_DESC',
  };
  if (campaignIdFilter != null) {
    body.filters = { campaignId: [campaignIdFilter] };
  }
  const res = await smartleadRequest({
    url,
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${smartleadApiErrorMessage(res, 'inbox replies')} for campaign ${campaignIdFilter}`);
  }
  const json = await res.json() as any;
  const data = Array.isArray(json?.data) ? json.data : [];
  return { data, json };
}

export async function fetchSmartleadInboxReplies(
  apiKey: string,
  smartleadCampaignId: number,
  onProgress?: (totalFetched: number) => void,
): Promise<SmartleadInboxReplyLead[]> {
  const all: SmartleadInboxReplyLead[] = [];
  let offset = 0;
  const useFilter = true;

  while (true) {
    const { data } = await fetchSmartleadInboxRepliesPage(
      apiKey,
      offset,
      SMARTLEAD_INBOX_REPLIES_PAGE_LIMIT,
      useFilter ? smartleadCampaignId : null,
    );
    for (const item of data) {
      const parsed = parseSmartleadInboxReplyLead(item);
      if (!parsed) continue;
      const matchesCampaign =
        parsed.email_campaign_id == null || parsed.email_campaign_id === smartleadCampaignId;
      if (matchesCampaign) {
        all.push(parsed);
      }
    }
    onProgress?.(all.length);
    if (data.length < SMARTLEAD_INBOX_REPLIES_PAGE_LIMIT) {
      break;
    }
    offset += data.length;
  }

  if (all.length === 0 && useFilter) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Smartlead migration] inbox-replies with campaign filter returned 0; retrying without filter');
    }
    offset = 0;
    while (true) {
      const { data } = await fetchSmartleadInboxRepliesPage(
        apiKey,
        offset,
        SMARTLEAD_INBOX_REPLIES_PAGE_LIMIT,
        null,
      );
      for (const item of data) {
        const parsed = parseSmartleadInboxReplyLead(item);
        if (!parsed) continue;
        if (parsed.email_campaign_id === smartleadCampaignId) {
          all.push(parsed);
        }
      }
      onProgress?.(all.length);
      if (data.length < SMARTLEAD_INBOX_REPLIES_PAGE_LIMIT) {
        break;
      }
      offset += data.length;
    }
  }

  return all;
}

function normalizeSmartleadMessageType(value: unknown): 'SENT' | 'REPLY' | null {
  const upper = stringOrUndefined(value)?.toUpperCase();
  if (upper === 'SENT') return 'SENT';
  if (upper === 'REPLY') return 'REPLY';
  return null;
}

function describeForLog(value: unknown): string {
  if (value == null) return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return `object(${Object.keys(value).join(',')})`;
  return typeof value;
}

function parseSmartleadMessageHistoryItems(raw: unknown): SmartleadMessageHistoryItem[] {
  const obj = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const candidates: unknown[] = Array.isArray(raw) ? [raw] : [];
  if (obj) {
    candidates.push(obj.data, obj.email_history, obj.messages, obj.conversation, obj.thread, obj.history);
    const fromData = obj.data != null && typeof obj.data === 'object' && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : null;
    if (fromData) {
      candidates.push(
        fromData.email_history,
        fromData.messages,
        fromData.conversation,
        fromData.thread,
        fromData.history,
      );
    }
  }
  const items = candidates.find((candidate) => Array.isArray(candidate));
  if (!Array.isArray(items)) {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      const keyTypes: Record<string, string> = {};
      for (const k of Object.keys(o)) {
        keyTypes[k] = describeForLog(o[k]);
      }
      console.warn('[Smartlead migration] message-history: no array in response shape', {
        topLevelKeys: Object.keys(o),
        keyTypes,
      });
    }
    return [];
  }

  const parsed: SmartleadMessageHistoryItem[] = [];
  let skipped = 0;
  for (const item of items) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      skipped += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const type = normalizeSmartleadMessageType(row.type);
    const from = stringOrUndefined(row.from);
    const to = stringOrUndefined(row.to);
    const time = stringOrUndefined(row.time);
    if (!type || !from || !to || !time) {
      skipped += 1;
      continue;
    }
    parsed.push({
      stats_id: stringOrUndefined(row.stats_id),
      from,
      to,
      type,
      message_id: stringOrUndefined(row.message_id),
      time,
      email_body: stringOrUndefined(row.email_body),
      subject: stringOrUndefined(row.subject),
      cc: Array.isArray(row.cc)
        ? row.cc.map((value) => stringOrUndefined(value)).filter((value): value is string => !!value)
        : undefined,
      raw: row,
    });
  }
  if (parsed.length === 0 && items.length > 0) {
    const first = items[0];
    const sample = typeof first === 'object' && first !== null && !Array.isArray(first)
      ? { keys: Object.keys(first as object), type: (first as any)?.type, from: (first as any)?.from }
      : null;
    console.warn('[Smartlead migration] message-history: array had items but none passed validation', {
      arrayLength: items.length,
      skipped,
      sampleFirstItem: sample,
    });
  }
  return parsed.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

export async function fetchSmartleadMessageHistory(
  apiKey: string,
  smartleadCampaignId: number,
  smartleadLeadId: number,
): Promise<SmartleadMessageHistoryItem[]> {
  const result = await fetchSmartleadMessageHistoryWithRaw(
    apiKey,
    smartleadCampaignId,
    smartleadLeadId,
  );
  return result.items;
}

/** Internal: fetches and returns both parsed items and raw JSON (for debug when empty). */
async function fetchSmartleadMessageHistoryWithRaw(
  apiKey: string,
  smartleadCampaignId: number,
  smartleadLeadId: number,
): Promise<{ items: SmartleadMessageHistoryItem[]; rawJson: unknown }> {
  const enc = (s: string) => encodeURIComponent(s);
  const url =
    `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/leads/${smartleadLeadId}/message-history` +
    `?api_key=${enc(apiKey)}`;
  const res = await smartleadRequest({ url });
  if (!res.ok) {
    throw new Error(
      `${smartleadApiErrorMessage(res, 'message history')} for campaign ${smartleadCampaignId}, lead ${smartleadLeadId}`,
    );
  }
  const rawJson = await res.json();
  const items = parseSmartleadMessageHistoryItems(rawJson);
  if (items.length === 0) {
    console.warn('[Smartlead migration] message-history empty for lead', {
      smartleadCampaignId,
      smartleadLeadId,
      responseTopLevelKeys: typeof rawJson === 'object' && rawJson !== null ? Object.keys(rawJson) : [],
    });
  }
  return { items, rawJson };
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
    const res = await smartleadRequest({ url });
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
  const url =
    `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/analytics-by-date` +
    `?api_key=${enc(apiKey)}&start_date=${enc(startDate)}&end_date=${enc(endDate)}`;
  const res = await smartleadRequest({ url });
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
    const url =
      `${SMARTLEAD_BASE}/campaigns/${smartleadCampaignId}/analytics-by-date` +
      `?api_key=${enc(apiKey)}&start_date=${d}&end_date=${d}`;
    const res = await smartleadRequest({ url });
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
  db?: MigrationDatabaseClient,
): Promise<Campaign> {
  const database = await resolveMigrationDb(db);
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

  const { data, error } = await database
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
  db?: MigrationDatabaseClient,
): Promise<string[]> {
  const database = await resolveMigrationDb(db);
  if (smartleadLeads.length === 0) return [];

  const allLeadIds: string[] = [];

  for (let i = 0; i < smartleadLeads.length; i += LEAD_BATCH_SIZE) {
    const batch = smartleadLeads.slice(i, i + LEAD_BATCH_SIZE);
    const now = new Date().toISOString();

    const rows = await Promise.all(
      batch.map(async (sl) => {
        const email = sl.email?.trim() || null;
        const globalLeadId = await generateGlobalLeadIdForMigration(email);
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

    const { data, error } = await database
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
  db?: MigrationDatabaseClient,
): Promise<void> {
  const database = await resolveMigrationDb(db);
  const { error } = await ((database
    .from('campaign_stats') as any)
    .update({
      sent_count: stats.sent,
      replied_count: stats.replied,
      positive_reply_count: stats.positiveReply,
      bounce_count: stats.bounce,
      last_bounce_at: stats.lastBounceAt,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', furnaceCampaignId));

  if (error) throw new Error(`Failed to update campaign_stats: ${error.message}`);
}

/**
 * Upsert per-day stats into imported_campaign_stats_by_day (idempotent).
 * Used for Smartlead and other imported campaigns instead of synthetic events.
 */
export async function upsertImportedCampaignStatsByDay(
  campaignId: string,
  byDay: SmartleadStatsByDay[],
  db?: MigrationDatabaseClient,
): Promise<void> {
  const database = await resolveMigrationDb(db);
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
  const { error } = await (database
    .from('imported_campaign_stats_by_day')
    .upsert(rows as any, { onConflict: 'campaign_id,date', ignoreDuplicates: false }) as any);
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

async function getSmartleadLeadEnrollmentMap(
  campaignId: string,
  smartleadLeadIds: number[],
  repliedLeadsWithEmail?: SmartleadInboxReplyLead[],
  db?: MigrationDatabaseClient,
): Promise<Map<number, SmartleadLeadEnrollmentMapValue>> {
  const database = await resolveMigrationDb(db);
  const ids = [...new Set(smartleadLeadIds.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, SmartleadLeadEnrollmentMapValue>();

  if (ids.length > 0) {
    const { data: leadRowsData, error: leadsError } = await (database
      .from('leads')
      .select('id, smartlead_lead_id')
      .eq('campaign_id', campaignId)
      .in('smartlead_lead_id', ids) as any);
    const leadRows = (leadRowsData ?? []) as Array<{ id: string; smartlead_lead_id: number | null }>;
    if (leadsError) {
      throw new Error(`Failed to fetch Smartlead lead mappings: ${leadsError.message}`);
    }

    const furnaceLeadIds: string[] = [];
    for (const row of leadRows) {
      if (row.smartlead_lead_id == null) continue;
      furnaceLeadIds.push(row.id);
    }

    if (furnaceLeadIds.length > 0) {
      const enrollmentIdByLeadId = new Map<string, string>();
      for (let b = 0; b < furnaceLeadIds.length; b += ENROLLMENTS_IN_QUERY_BATCH_SIZE) {
        const batch = furnaceLeadIds.slice(b, b + ENROLLMENTS_IN_QUERY_BATCH_SIZE);
        const { data: enrollmentRowsData, error: enrollmentsError } = await (database
          .from('enrollments')
          .select('id, lead_id')
          .eq('campaign_id', campaignId)
          .in('lead_id', batch) as any);
        const enrollmentRows = (enrollmentRowsData ?? []) as Array<{ id: string; lead_id: string }>;
        if (enrollmentsError) {
          throw new Error(`Failed to fetch Smartlead enrollment mappings: ${enrollmentsError.message}`);
        }
        for (const row of enrollmentRows) {
          if (!enrollmentIdByLeadId.has(row.lead_id)) {
            enrollmentIdByLeadId.set(row.lead_id, row.id);
          }
        }
      }

      for (const row of leadRows) {
        if (row.smartlead_lead_id == null) continue;
        out.set(row.smartlead_lead_id, {
          leadId: row.id,
          enrollmentId: enrollmentIdByLeadId.get(row.id) ?? null,
        });
      }
    }
  }

  // Fallback: match by email when inbox-replies email_lead_id doesn't match leads.smartlead_lead_id
  const withEmail = repliedLeadsWithEmail?.filter((r) => r.lead_email?.trim()) ?? [];
  if (withEmail.length > 0) {
    const emails = [...new Set(withEmail.map((r) => r.lead_email!.trim().toLowerCase()))];
    const { data: leadByEmailRowsData, error: emailError } = await (database
      .from('leads')
      .select('id, email')
      .eq('campaign_id', campaignId) as any);
    const leadByEmailRows = (leadByEmailRowsData ?? []) as Array<{ id: string; email: string | null }>;
    if (!emailError && leadByEmailRows.length) {
      const leadIdByEmail = new Map<string, string>();
      for (const row of leadByEmailRows) {
        const e = row.email?.trim().toLowerCase();
        if (e) leadIdByEmail.set(e, row.id);
      }
      const furnaceLeadIdsFromEmail = [...new Set(leadIdByEmail.values())];
      if (furnaceLeadIdsFromEmail.length > 0) {
        const enrollmentIdByLeadId = new Map<string, string>();
        for (let b = 0; b < furnaceLeadIdsFromEmail.length; b += ENROLLMENTS_IN_QUERY_BATCH_SIZE) {
          const batch = furnaceLeadIdsFromEmail.slice(b, b + ENROLLMENTS_IN_QUERY_BATCH_SIZE);
          const { data: enrollmentRowsData } = await (database
            .from('enrollments')
            .select('id, lead_id')
            .eq('campaign_id', campaignId)
            .in('lead_id', batch) as any);
          const enrollmentRows = (enrollmentRowsData ?? []) as Array<{ id: string; lead_id: string }>;
          for (const row of enrollmentRows) {
            if (!enrollmentIdByLeadId.has(row.lead_id)) enrollmentIdByLeadId.set(row.lead_id, row.id);
          }
        }
        for (const replied of withEmail) {
          if (out.has(replied.email_lead_id)) continue;
          const leadId = leadIdByEmail.get(replied.lead_email!.trim().toLowerCase());
          if (leadId) {
            out.set(replied.email_lead_id, {
              leadId,
              enrollmentId: enrollmentIdByLeadId.get(leadId) ?? null,
            });
          }
        }
      }
    }
  }

  return out;
}

function getSmartleadThreadSubject(messages: SmartleadMessageHistoryItem[]): string {
  for (const message of messages) {
    const subject = message.subject?.trim();
    if (message.type === 'SENT' && subject) return subject;
  }
  for (const message of messages) {
    const subject = message.subject?.trim();
    if (subject) return subject;
  }
  return '(No subject)';
}

function getSmartleadThreadParticipants(messages: SmartleadMessageHistoryItem[]): string[] {
  const participants: string[] = [];
  const seen = new Set<string>();
  const add = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    participants.push(trimmed);
  };

  for (const message of messages) {
    add(message.from);
    add(message.to);
    for (const cc of message.cc ?? []) add(cc);
  }

  return participants;
}

function getParticipantName(
  email: string,
  leadEmail: string | undefined,
  leadName: string | null,
): string | null {
  if (!leadEmail || !leadName) return null;
  return email.trim().toLowerCase() === leadEmail.trim().toLowerCase() ? leadName : null;
}

async function upsertSmartleadConversationThread(params: {
  accountId: string;
  campaignId: string;
  leadId: string;
  enrollmentId: string | null;
  smartleadLeadId: number;
  messages: SmartleadMessageHistoryItem[];
  db?: MigrationDatabaseClient;
}): Promise<string> {
  const { accountId, campaignId, leadId, enrollmentId, smartleadLeadId, messages, db } = params;
  const database = await resolveMigrationDb(db);
  const subject = getSmartleadThreadSubject(messages);
  const participants = getSmartleadThreadParticipants(messages);
  const lastMessageAt = messages[messages.length - 1]?.time ?? new Date().toISOString();

  const { data, error } = await (database
    .from('email_threads')
    .upsert({
      account_id: accountId,
      campaign_id: campaignId,
      lead_id: leadId,
      enrollment_id: enrollmentId,
      message_job_id: null,
      mailbox_id: null,
      smartlead_lead_id: smartleadLeadId,
      subject,
      participants,
      last_message_at: lastMessageAt,
      message_count: messages.length,
      has_reply: true,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: 'campaign_id,smartlead_lead_id' })
    .select('id')
    .single() as any);

  if (error) {
    throw new Error(`Failed to upsert Smartlead thread: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('No thread id returned when upserting Smartlead thread.');
  }
  return data.id;
}

async function replaceSmartleadConversationMessages(params: {
  threadId: string;
  accountId: string;
  leadEmail?: string;
  leadFirstName?: string;
  leadLastName?: string;
  threadSubject: string;
  messages: SmartleadMessageHistoryItem[];
  db?: MigrationDatabaseClient;
}): Promise<void> {
  const { threadId, accountId, leadEmail, leadFirstName, leadLastName, threadSubject, messages, db } = params;
  const database = await resolveMigrationDb(db);
  const leadName = buildSmartleadLeadName(leadFirstName, leadLastName);

  const { error: deleteError } = await database
    .from('email_messages')
    .delete()
    .eq('thread_id', threadId);
  if (deleteError) {
    throw new Error(`Failed to replace Smartlead thread messages: ${deleteError.message}`);
  }

  if (messages.length === 0) return;

  const now = new Date().toISOString();
  const rows = messages.map((message) => ({
    thread_id: threadId,
    account_id: accountId,
    message_job_id: null,
    direction: message.type === 'REPLY' ? 'received' as const : 'sent' as const,
    from_email: message.from,
    from_name: getParticipantName(message.from, leadEmail, leadName),
    to_email: message.to,
    to_name: getParticipantName(message.to, leadEmail, leadName),
    cc: message.cc?.length ? message.cc : null,
    subject: message.subject?.trim() || threadSubject,
    body_text: stripHtml(message.email_body),
    body_html: message.email_body?.trim() || null,
    message_id: message.message_id ?? null,
    in_reply_to: null,
    message_references: null,
    received_at: message.time,
    headers: {
      source: 'smartlead',
      smartlead_type: message.type,
      smartlead_stats_id: message.stats_id ?? null,
    },
    attachments: [],
    created_at: now,
    updated_at: now,
  }));

  const { error: insertError } = await (database
    .from('email_messages')
    .insert(rows as any) as any);
  if (insertError) {
    throw new Error(`Failed to insert Smartlead thread messages: ${insertError.message}`);
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface MigrationProgress {
  campaignIndex: number;
  campaignCount: number;
  campaignName: string;
  phase: 'campaign' | 'leads' | 'enrollments' | 'conversations' | 'stats' | 'done';
  leadCount?: number;
  leadIndex?: number;
  detail?: string;
}

/** Why 0 conversations might have been imported (for UI/logging). */
export interface ConversationImportDiagnostics {
  repliedFromApi: number;
  leadsMatched: number;
  skippedNoMatch: number;
  skippedEmptyHistory: number;
  imported: number;
}

export interface CampaignMigrationResult {
  campaignRowId?: string;
  campaignId?: string;
  campaignName: string;
  status: 'succeeded' | 'failed';
  error?: string;
  leadsImported?: number;
  conversationsImported?: number;
  /** Set when phase ran; explains why conversation count may be 0. */
  conversationDiagnostics?: ConversationImportDiagnostics;
  totalsStatsImported?: boolean;
  dayByDayStatsImported?: boolean;
}

export interface SingleCampaignMigrationParams {
  apiKey: string;
  campaign: SmartleadCampaign;
  accountId: string,
  ownerId: string,
  campaignIndex: number;
  campaignCount: number;
  onProgress?: (p: MigrationProgress) => void,
  db?: MigrationDatabaseClient;
}

export async function migrateSingleSmartleadCampaign(
  params: SingleCampaignMigrationParams,
): Promise<CampaignMigrationResult> {
  const {
    apiKey,
    campaign: sl,
    accountId,
    ownerId,
    campaignIndex,
    campaignCount,
    onProgress,
    db,
  } = params;
  const database = await resolveMigrationDb(db);

  const campaignResult: CampaignMigrationResult = {
    campaignName: sl.name,
    status: 'succeeded',
    leadsImported: 0,
    conversationsImported: 0,
    totalsStatsImported: false,
    dayByDayStatsImported: false,
  };

  try {
    onProgress?.({ campaignIndex, campaignCount, campaignName: sl.name, phase: 'campaign' });

    const campaign = await upsertCampaignFromSmartlead(sl, accountId, ownerId, database);
    campaignResult.campaignId = campaign.id;

    onProgress?.({ campaignIndex, campaignCount, campaignName: sl.name, phase: 'leads' });

    const smartleadLeads = await fetchSmartleadLeads(apiKey, sl.id);

    const leadIds = await upsertLeadsFromSmartlead(
      campaign.id,
      campaign.bucket_id,
      accountId,
      smartleadLeads,
      database,
    );

    campaignResult.leadsImported = leadIds.length;

    onProgress?.({
      campaignIndex,
      campaignCount,
      campaignName: sl.name,
      phase: 'enrollments',
      leadCount: leadIds.length,
    });

    await ensureCampaignEnrollmentsForLeadsInDb(
      database,
      campaign.id,
      leadIds,
      smartleadLeads.map((lead) => smartleadStatusToEnrollmentState(lead.status)),
    );

    onProgress?.({
      campaignIndex,
      campaignCount,
      campaignName: sl.name,
      phase: 'conversations',
      detail: 'fetching replied threads...',
    });

    const repliedLeads = await fetchSmartleadInboxReplies(
      apiKey,
      sl.id,
      (totalFetched) =>
        onProgress?.({
          campaignIndex,
          campaignCount,
          campaignName: sl.name,
          phase: 'conversations',
          detail: `fetching replied threads (${totalFetched} found)...`,
        }),
    );

    const leadEnrollmentMap = await getSmartleadLeadEnrollmentMap(
      campaign.id,
      repliedLeads.map((lead) => lead.email_lead_id),
      repliedLeads,
      db,
    );

    const conversationDiagnostics: ConversationImportDiagnostics = {
      repliedFromApi: repliedLeads.length,
      leadsMatched: leadEnrollmentMap.size,
      skippedNoMatch: 0,
      skippedEmptyHistory: 0,
      imported: 0,
    };
    campaignResult.conversationDiagnostics = conversationDiagnostics;

    console.log('[Smartlead migration] conversations', {
      campaignName: sl.name,
      smartleadCampaignId: sl.id,
      repliedLeadsFromApi: repliedLeads.length,
      leadsMatchedToFurnace: leadEnrollmentMap.size,
    });

    for (let leadIndex = 0; leadIndex < repliedLeads.length; leadIndex++) {
      const repliedLead = repliedLeads[leadIndex];
      const mapping = leadEnrollmentMap.get(repliedLead.email_lead_id);

      if (!mapping) {
        conversationDiagnostics.skippedNoMatch += 1;
        console.warn('[Smartlead migration] skipping conversation: no Furnace lead match', {
          campaignName: sl.name,
          smartleadLeadId: repliedLead.email_lead_id,
          lead_email: repliedLead.lead_email ?? '(missing)',
        });
        continue;
      }

      onProgress?.({
        campaignIndex,
        campaignCount,
        campaignName: sl.name,
        phase: 'conversations',
        leadIndex: leadIndex + 1,
        leadCount: repliedLeads.length,
        detail: `fetching message history for lead ${leadIndex + 1} of ${repliedLeads.length}...`,
      });

      const { items: messageHistory, rawJson } = await fetchSmartleadMessageHistoryWithRaw(
        apiKey,
        sl.id,
        repliedLead.email_lead_id,
      );

      if (messageHistory.length === 0) {
        conversationDiagnostics.skippedEmptyHistory += 1;
        console.warn('[Smartlead migration] skipping conversation: empty message history', {
          campaignName: sl.name,
          smartleadLeadId: repliedLead.email_lead_id,
        });

        if (conversationDiagnostics.skippedEmptyHistory === 1) {
          console.warn('[Smartlead migration] first empty message-history raw response (for parsing debug)', {
            campaignName: sl.name,
            smartleadLeadId: repliedLead.email_lead_id,
            topLevelKeys: typeof rawJson === 'object' && rawJson !== null ? Object.keys(rawJson) : [],
            rawResponseSample: typeof rawJson === 'object'
              ? JSON.stringify(rawJson).slice(0, 1200)
              : String(rawJson),
          });
        }
        continue;
      }

      const threadId = await upsertSmartleadConversationThread({
        accountId,
        campaignId: campaign.id,
        leadId: mapping.leadId,
        enrollmentId: mapping.enrollmentId,
        smartleadLeadId: repliedLead.email_lead_id,
        messages: messageHistory,
        db: database,
      });
      const threadSubject = getSmartleadThreadSubject(messageHistory);
      await replaceSmartleadConversationMessages({
        threadId,
        accountId,
        leadEmail: repliedLead.lead_email,
        leadFirstName: repliedLead.lead_first_name,
        leadLastName: repliedLead.lead_last_name,
        threadSubject,
        messages: messageHistory,
        db: database,
      });
      conversationDiagnostics.imported += 1;
      campaignResult.conversationsImported = (campaignResult.conversationsImported ?? 0) + 1;
    }

    if (conversationDiagnostics.imported === 0 && repliedLeads.length > 0) {
      console.warn('[Smartlead migration] 0 conversations imported', {
        campaignName: sl.name,
        ...conversationDiagnostics,
      });
    }

    onProgress?.({ campaignIndex, campaignCount, campaignName: sl.name, phase: 'stats' });

    try {
      const stats = await fetchSmartleadCampaignStats(apiKey, sl.id);
      await upsertCampaignStatsFromSmartlead(campaign.id, accountId, stats, database);
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
          sample: sample.map((day) => ({ date: day.date, sent: day.sent, replied: day.replied, bounce: day.bounce })),
        });
      }
      if (byDay.length > 0) {
        await upsertImportedCampaignStatsByDay(campaign.id, byDay, database);
        campaignResult.dayByDayStatsImported = true;
      }
    } catch (statsError) {
      console.warn(
        '[Smartlead] Stats could not be imported (API returned 400/404). Campaign and lead data were imported successfully.',
        statsError,
      );
    }

    return campaignResult;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      campaignName: sl.name,
      status: 'failed',
      error: errorMessage,
    };
  }
}

export async function migrateSmartleadCampaigns(
  apiKey: string,
  selectedCampaigns: SmartleadCampaign[],
  accountId: string,
  ownerId: string,
  onProgress?: (p: MigrationProgress) => void,
  db?: MigrationDatabaseClient,
): Promise<{
  succeeded: string[];
  failed: { name: string; error: string }[];
  statsImported: boolean;
  totalLeadsImported: number;
  campaignResults: CampaignMigrationResult[];
}> {
  const database = await resolveMigrationDb(db);
  const succeeded: string[] = [];
  const failed: { name: string; error: string }[] = [];
  const campaignResults: CampaignMigrationResult[] = [];
  let totalLeadsImported = 0;
  let statsImported = false;

  for (let i = 0; i < selectedCampaigns.length; i++) {
    const campaignResult = await migrateSingleSmartleadCampaign({
      apiKey,
      campaign: selectedCampaigns[i],
      accountId,
      ownerId,
      campaignIndex: i,
      campaignCount: selectedCampaigns.length,
      onProgress,
      db: database,
    });

    campaignResults.push(campaignResult);
    totalLeadsImported += campaignResult.leadsImported ?? 0;
    statsImported = statsImported || campaignResult.totalsStatsImported === true || campaignResult.dayByDayStatsImported === true;

    if (campaignResult.status === 'succeeded') {
      succeeded.push(campaignResult.campaignName);
    } else {
      failed.push({
        name: campaignResult.campaignName,
        error: campaignResult.error ?? 'Migration failed.',
      });
    }
  }

  onProgress?.({ campaignIndex: selectedCampaigns.length, campaignCount: selectedCampaigns.length, campaignName: '', phase: 'done' });

  return {
    succeeded,
    failed,
    statsImported,
    totalLeadsImported,
    campaignResults,
  };
}
