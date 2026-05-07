import { supabase } from '../client';
import {
  applyLeadReplacementSummary,
  buildLeadReplacementSummariesByLeadIds,
  type LeadReplacementRole,
  type LeadReplacementRow,
  type LeadReplacementSummary,
} from '@/lib/leads/replacementSummary';
import type { Lead, LeadInsert, LeadUpdate, ReplacementReason } from '../types';

export type { LeadReplacementRole, LeadReplacementSummary } from '@/lib/leads/replacementSummary';

/** PostgREST encodes `.in()` as a long query string; keep chunks under typical proxy URL limits. */
const POSTGREST_IN_CHUNK_SIZE = 100;

function chunkIds<T>(ids: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [ids];
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

/** PostgREST `.in('id', …)` on GET becomes a huge URL; use RPC with uuid[] in JSON body instead. */
function campaignScopedLeadIdsNeedRpc(scopedLeadIds: string[] | null | undefined): boolean {
  return scopedLeadIds != null && scopedLeadIds.length > POSTGREST_IN_CHUNK_SIZE;
}

const SUPABASE_PAGE_RANGE_SIZE = 1000;

/**
 * Lead service for database operations.
 * For getLeadDisplayName and generateGlobalLeadId use @/lib/leads.
 */

export interface LeadFilters {
  campaignId?: string;
  bucketId?: string;
  status?: Lead['status'];
  /** Max number of leads to return (for pagination/preview). */
  limit?: number;
  /** Offset for pagination (use with limit). */
  offset?: number;
  /** Search by email or name (ilike). */
  search?: string;
  /** Filter to leads where any of these fields is null or empty. Prefix custom fields with "custom." */
  missingFields?: string[];
}

export interface CampaignLeadTableRow {
  id: string;
  email: string;
  name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  company_linkedin_url?: string | null;
  phone_number?: string | null;
  source?: string | null;
  custom_lead_data?: Record<string, unknown> | null;
  status?: Lead['status'] | null;
  enrollment_state: 'active' | 'completed' | 'stopped' | 'paused' | null;
  enrollment_current_node_id: string | null;
  enrollment_stopped_reason: 'replied' | 'bounced' | 'unsubscribed' | 'error' | null;
  enrollment_stopped_error_message: string | null;
  reply_category: 'Interested' | 'Neutral' | 'Not Interested' | null;
  replacement_role: LeadReplacementRole | null;
  replacement_counterpart_lead_id: string | null;
  replacement_counterpart_name: string | null;
  replacement_counterpart_email: string | null;
  replacement_counterpart_label: string | null;
  replacement_reason: ReplacementReason | null;
  replacement_reason_note: string | null;
  replacement_completed_at: string | null;
  created_at: string;
}

export type CampaignLeadStatusFilterValue = NonNullable<CampaignLeadTableRow['status']>;
export type CampaignLeadEnrollmentFilterValue = NonNullable<CampaignLeadTableRow['enrollment_state']> | 'not_started';
export type CampaignLeadReplyCategoryFilterValue = NonNullable<CampaignLeadTableRow['reply_category']> | 'not_categorized';

export interface CampaignLeadTableQuery {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  statuses?: CampaignLeadStatusFilterValue[];
  enrollmentStates?: CampaignLeadEnrollmentFilterValue[];
  replyCategories?: CampaignLeadReplyCategoryFilterValue[];
  leadIds?: string[];
}

export interface CampaignLeadTableResult {
  rows: CampaignLeadTableRow[];
  totalCount: number;
}

const CAMPAIGN_LEAD_TABLE_SELECT =
  'id, email, name, first_name, last_name, company_name, website, linkedin_url, company_linkedin_url, phone_number, source, custom_lead_data, status, created_at';

const CAMPAIGN_LEAD_TABLE_SORT_COLUMNS = new Set([
  'email',
  'name',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'phone_number',
  'source',
  'status',
  'created_at',
]);

type CampaignLeadBaseRow = Pick<
  CampaignLeadTableRow,
  | 'id'
  | 'email'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'company_name'
  | 'website'
  | 'linkedin_url'
  | 'company_linkedin_url'
  | 'phone_number'
  | 'source'
  | 'custom_lead_data'
  | 'status'
  | 'created_at'
>;

export interface ReplaceLeadWithNewContactInput {
  oldLeadId: string;
  newEmail: string;
  newName?: string | null;
  newFirstName?: string | null;
  newLastName?: string | null;
  newPhoneNumber?: string | null;
  reason?: ReplacementReason;
  reasonNote?: string | null;
  sourceMessageId?: string | null;
}

export interface ReplaceLeadWithNewContactResult {
  replacementId: string;
  newLeadId: string;
  enrollmentId: string | null;
  newLead: Lead;
}

export interface UpdateLeadProfileFieldsInput {
  leadId: string;
  companyName?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  companyLinkedinUrl?: string | null;
  customLeadData?: Record<string, unknown> | null;
}

function getCampaignLeadTableSortBy(sortBy?: string): keyof CampaignLeadBaseRow {
  return CAMPAIGN_LEAD_TABLE_SORT_COLUMNS.has(sortBy ?? '')
    ? (sortBy as keyof CampaignLeadBaseRow)
    : 'created_at';
}

async function getLeadReplacementRowsByLeadIds(leadIds: string[]): Promise<LeadReplacementRow[]> {
  if (leadIds.length === 0) return [];

  const replacements = new Map<string, LeadReplacementRow>();

  for (const idChunk of chunkIds(leadIds, POSTGREST_IN_CHUNK_SIZE)) {
    const [oldMatchResult, newMatchResult] = await Promise.all([
      supabase
        .from('lead_replacements')
        .select('id, old_lead_id, new_lead_id, reason, reason_note, created_at, completed_at')
        .in('old_lead_id', idChunk)
        .neq('status', 'cancelled'),
      supabase
        .from('lead_replacements')
        .select('id, old_lead_id, new_lead_id, reason, reason_note, created_at, completed_at')
        .in('new_lead_id', idChunk)
        .neq('status', 'cancelled'),
    ]);

    if (oldMatchResult.error) {
      throw new Error(`Failed to fetch lead replacements: ${oldMatchResult.error.message}`);
    }
    if (newMatchResult.error) {
      throw new Error(`Failed to fetch lead replacements: ${newMatchResult.error.message}`);
    }

    for (const row of [...(oldMatchResult.data ?? []), ...(newMatchResult.data ?? [])] as LeadReplacementRow[]) {
      replacements.set(row.id, row);
    }
  }

  return Array.from(replacements.values());
}

export async function getLeadReplacementSummariesByLeadIds(
  leadIds: string[]
): Promise<Record<string, LeadReplacementSummary>> {
  const uniqueLeadIds = [...new Set(leadIds.filter(Boolean))];
  if (uniqueLeadIds.length === 0) return {};

  const replacements = await getLeadReplacementRowsByLeadIds(uniqueLeadIds);
  if (replacements.length === 0) return {};

  const counterpartIds = new Set<string>();
  for (const replacement of replacements) {
    counterpartIds.add(replacement.old_lead_id);
    counterpartIds.add(replacement.new_lead_id);
  }

  const counterpartLeads = await getLeadsByIds(Array.from(counterpartIds));
  const counterpartById = new Map(counterpartLeads.map((lead) => [lead.id, lead]));

  return buildLeadReplacementSummariesByLeadIds({
    leadIds: uniqueLeadIds,
    replacements,
    counterpartLeadsById: counterpartById,
  });
}

function buildCampaignLeadTableQuery(
  campaignId: string,
  query?: CampaignLeadTableQuery,
  includeCount = false,
  scopedLeadIds?: string[] | null,
) {
  const searchTerm = query?.search?.trim();
  let leadsQuery = supabase
    .from('leads')
    .select(CAMPAIGN_LEAD_TABLE_SELECT, includeCount ? { count: 'exact' } : undefined)
    .eq('campaign_id', campaignId)
    .is('deleted_at', null);

  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    leadsQuery = leadsQuery.or(
      `email.ilike.${pattern},name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},company_name.ilike.${pattern},phone_number.ilike.${pattern},website.ilike.${pattern},linkedin_url.ilike.${pattern}`,
    );
  }

  if (query?.statuses?.length) {
    leadsQuery = leadsQuery.in('status', query.statuses);
  }

  if (scopedLeadIds) {
    leadsQuery = leadsQuery.in('id', scopedLeadIds);
  }

  return leadsQuery;
}

async function fetchCampaignLeadEnrollmentMap(campaignId: string, leadIds: string[]) {
  const enrollmentByLeadId = new Map<
    string,
    {
      state: CampaignLeadTableRow['enrollment_state'];
      current_node_id: string | null;
      stopped_reason: CampaignLeadTableRow['enrollment_stopped_reason'];
      stopped_error_message: string | null;
    }
  >();

  if (leadIds.length === 0) return enrollmentByLeadId;

  const enrollments: {
    lead_id: string;
    state: string | null;
    current_node_id: string | null;
    stopped_reason: string | null;
    stopped_error_message: string | null;
  }[] = [];

  for (const idChunk of chunkIds(leadIds, POSTGREST_IN_CHUNK_SIZE)) {
    const { data: chunk, error: enrollmentsError } = await supabase
      .from('enrollments')
      .select('lead_id, state, current_node_id, stopped_reason, stopped_error_message')
      .eq('campaign_id', campaignId)
      .is('deleted_at', null)
      .in('lead_id', idChunk);

    if (enrollmentsError) {
      throw new Error(`Failed to fetch enrollments: ${enrollmentsError.message}`);
    }
    if (chunk?.length) enrollments.push(...chunk);
  }

  for (const enrollment of enrollments) {
    enrollmentByLeadId.set(enrollment.lead_id, {
      state: enrollment.state as CampaignLeadTableRow['enrollment_state'],
      current_node_id: enrollment.current_node_id,
      stopped_reason: enrollment.stopped_reason as CampaignLeadTableRow['enrollment_stopped_reason'],
      stopped_error_message: enrollment.stopped_error_message,
    });
  }

  return enrollmentByLeadId;
}

async function fetchCampaignLeadIds(campaignId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_RANGE_SIZE) {
    const to = from + SUPABASE_PAGE_RANGE_SIZE - 1;
    const { data, error } = await supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', campaignId)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch lead ids: ${error.message}`);
    }
    const chunk = data ?? [];
    if (chunk.length === 0) break;
    for (const row of chunk) {
      ids.push(row.id);
    }
    if (chunk.length < SUPABASE_PAGE_RANGE_SIZE) break;
  }
  return ids;
}

function intersectLeadIdSets(baseLeadIds: Set<string> | null, nextLeadIds: Set<string>): Set<string> {
  if (baseLeadIds === null) return new Set(nextLeadIds);
  return new Set([...baseLeadIds].filter((leadId) => nextLeadIds.has(leadId)));
}

async function resolveCampaignLeadScopeIds(
  campaignId: string,
  query?: CampaignLeadTableQuery,
): Promise<string[] | null> {
  let scopedLeadIds: Set<string> | null = query?.leadIds ? new Set(query.leadIds.filter(Boolean)) : null;

  if (query?.leadIds && scopedLeadIds?.size === 0) {
    return [];
  }

  const hasEnrollmentFilter = !!query?.enrollmentStates?.length;
  const hasReplyCategoryFilter = !!query?.replyCategories?.length;

  if (!hasEnrollmentFilter && !hasReplyCategoryFilter) {
    return scopedLeadIds ? Array.from(scopedLeadIds) : null;
  }

  let campaignLeadIds: string[] | null = null;

  if (hasEnrollmentFilter) {
    const includeNotStarted = query!.enrollmentStates!.includes('not_started');
    const matchedEnrollmentStates = new Set(
      query!.enrollmentStates!.filter(
      (state): state is NonNullable<CampaignLeadTableRow['enrollment_state']> => state !== 'not_started',
      ),
    );

    const enrollments: { lead_id: string | null; state: string | null }[] = [];
    for (let from = 0; ; from += SUPABASE_PAGE_RANGE_SIZE) {
      const to = from + SUPABASE_PAGE_RANGE_SIZE - 1;
      const { data: chunk, error: enrollmentsError } = await supabase
        .from('enrollments')
        .select('lead_id, state')
        .eq('campaign_id', campaignId)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to);

      if (enrollmentsError) {
        throw new Error(`Failed to fetch enrollments: ${enrollmentsError.message}`);
      }
      if (!chunk?.length) break;
      enrollments.push(...chunk);
      if (chunk.length < SUPABASE_PAGE_RANGE_SIZE) break;
    }

    const enrolledLeadIds = new Set<string>();
    const matchedLeadIds = new Set<string>();

    for (const enrollment of enrollments) {
      if (!enrollment.lead_id) continue;
      enrolledLeadIds.add(enrollment.lead_id);
      if (matchedEnrollmentStates.has(enrollment.state as NonNullable<CampaignLeadTableRow['enrollment_state']>)) {
        matchedLeadIds.add(enrollment.lead_id);
      }
    }

    if (includeNotStarted) {
      campaignLeadIds ??= await fetchCampaignLeadIds(campaignId);
      for (const leadId of campaignLeadIds) {
        if (!enrolledLeadIds.has(leadId)) {
          matchedLeadIds.add(leadId);
        }
      }
    }

    scopedLeadIds = intersectLeadIdSets(scopedLeadIds, matchedLeadIds);
  }

  if (hasReplyCategoryFilter) {
    campaignLeadIds ??= await fetchCampaignLeadIds(campaignId);
    const replyCategoryByLeadId = await fetchCampaignLeadReplyCategoryMap(campaignId, campaignLeadIds);
    const includeNotCategorized = query!.replyCategories!.includes('not_categorized');
    const matchedReplyCategories = new Set(
      query!.replyCategories!.filter(
        (category): category is NonNullable<CampaignLeadTableRow['reply_category']> => category !== 'not_categorized',
      ),
    );
    const matchedLeadIds = new Set<string>();

    for (const leadId of campaignLeadIds) {
      const replyCategory = replyCategoryByLeadId.get(leadId) ?? null;
      if (replyCategory === null) {
        if (includeNotCategorized) matchedLeadIds.add(leadId);
        continue;
      }
      if (matchedReplyCategories.has(replyCategory)) {
        matchedLeadIds.add(leadId);
      }
    }

    scopedLeadIds = intersectLeadIdSets(scopedLeadIds, matchedLeadIds);
  }

  return Array.from(scopedLeadIds ?? new Set<string>());
}

async function fetchCampaignLeadReplyCategoryMap(campaignId: string, leadIds: string[]) {
  const replyCategoryByLeadId = new Map<string, CampaignLeadTableRow['reply_category']>();

  if (leadIds.length === 0) return replyCategoryByLeadId;

  if (leadIds.length > POSTGREST_IN_CHUNK_SIZE) {
    const { data, error } = await supabase.rpc('latest_reply_category_by_campaign', {
      p_campaign_id: campaignId,
    });
    if (error) {
      throw new Error(`Failed to fetch reply categories: ${error.message}`);
    }
    for (const row of data ?? []) {
      if (!row.lead_id) continue;
      const cat = row.reply_category;
      replyCategoryByLeadId.set(
        row.lead_id,
        cat === 'Interested' || cat === 'Neutral' || cat === 'Not Interested' ? cat : null,
      );
    }
    return replyCategoryByLeadId;
  }

  const threads: {
    lead_id: string | null;
    category: string | null;
    last_message_at: string;
  }[] = [];

  for (const idChunk of chunkIds(leadIds, POSTGREST_IN_CHUNK_SIZE)) {
    const { data: chunk, error: threadsError } = await supabase
      .from('email_threads')
      .select('lead_id, category, last_message_at')
      .eq('campaign_id', campaignId)
      .eq('has_reply', true)
      .in('lead_id', idChunk);

    if (threadsError) {
      throw new Error(`Failed to fetch reply categories: ${threadsError.message}`);
    }
    if (chunk?.length) threads.push(...chunk);
  }

  const latestThreadByLeadId = new Map<string, { lastMessageAt: string; category: CampaignLeadTableRow['reply_category'] }>();

  for (const thread of threads) {
    if (!thread.lead_id) continue;
    const existing = latestThreadByLeadId.get(thread.lead_id);
    if (!existing || thread.last_message_at > existing.lastMessageAt) {
      latestThreadByLeadId.set(thread.lead_id, {
        lastMessageAt: thread.last_message_at,
        category:
          thread.category === 'Interested' ||
          thread.category === 'Neutral' ||
          thread.category === 'Not Interested'
            ? (thread.category as CampaignLeadTableRow['reply_category'])
            : null,
      });
    }
  }

  for (const [leadId, value] of latestThreadByLeadId.entries()) {
    replyCategoryByLeadId.set(leadId, value.category);
  }

  return replyCategoryByLeadId;
}

function mapCampaignLeadTableRows(
  leadRows: CampaignLeadBaseRow[],
  enrollmentByLeadId: Map<
    string,
    {
      state: CampaignLeadTableRow['enrollment_state'];
      current_node_id: string | null;
      stopped_reason: CampaignLeadTableRow['enrollment_stopped_reason'];
      stopped_error_message: string | null;
    }
  >,
  replyCategoryByLeadId: Map<string, CampaignLeadTableRow['reply_category']>,
  replacementSummaryByLeadId: Record<string, LeadReplacementSummary>,
): CampaignLeadTableRow[] {
  return leadRows.map((lead) => {
    const enrollment = enrollmentByLeadId.get(lead.id);
    return {
      ...lead,
      enrollment_state: enrollment?.state ?? null,
      enrollment_current_node_id: enrollment?.current_node_id ?? null,
      enrollment_stopped_reason: enrollment?.stopped_reason ?? null,
      enrollment_stopped_error_message: enrollment?.stopped_error_message ?? null,
      reply_category: replyCategoryByLeadId.get(lead.id) ?? null,
      ...applyLeadReplacementSummary(replacementSummaryByLeadId[lead.id]),
    };
  });
}

async function fetchCampaignLeadsTablePageRpc(
  campaignId: string,
  query: CampaignLeadTableQuery | undefined,
  scopedLeadIds: string[],
  sortBy: keyof CampaignLeadBaseRow,
  ascending: boolean,
  limit: number,
  offset: number,
): Promise<{ rows: CampaignLeadBaseRow[]; totalCount: number }> {
  const search = query?.search?.trim();
  const statuses = query?.statuses?.length ? query.statuses.map(String) : null;

  const { data, error } = await supabase.rpc('campaign_leads_table_page', {
    p_campaign_id: campaignId,
    p_scoped_ids: scopedLeadIds,
    p_statuses: statuses,
    p_search: search && search.length > 0 ? search : null,
    p_sort: String(sortBy),
    p_asc: ascending,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  const rowsRaw = data ?? [];
  const totalCount =
    rowsRaw.length > 0 && rowsRaw[0].total_count != null ? Number(rowsRaw[0].total_count) : 0;

  const rows: CampaignLeadBaseRow[] = rowsRaw.map((r: any) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    first_name: r.first_name,
    last_name: r.last_name,
    company_name: r.company_name,
    website: r.website,
    linkedin_url: r.linkedin_url,
    company_linkedin_url: r.company_linkedin_url,
    phone_number: r.phone_number,
    source: r.source,
    custom_lead_data: r.custom_lead_data as Record<string, unknown> | null,
    status: r.status as CampaignLeadBaseRow['status'],
    created_at: r.created_at,
  }));

  return { rows, totalCount };
}

/**
 * Get all leads with optional filters
 */
export async function getLeads(filters?: LeadFilters): Promise<Lead[]> {
  let query = supabase
    .from('leads')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false }) as any;

  if (filters?.campaignId) {
    query = query.eq('campaign_id', filters.campaignId);
  }

  if (filters?.bucketId) {
    query = query.eq('bucket_id', filters.bucketId);
  }

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const searchTerm = filters?.search?.trim();
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    query = query.or(`email.ilike.${pattern},name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`);
  }

  if (filters?.missingFields?.length) {
    const conditions: string[] = [];
    for (const field of filters.missingFields) {
      if (field.startsWith('custom.')) {
        const jsonKey = field.slice(7);
        conditions.push(`custom_lead_data->>${jsonKey}.is.null`);
        conditions.push(`custom_lead_data->>${jsonKey}.eq.`);
      } else {
        conditions.push(`${field}.is.null`);
        conditions.push(`${field}.eq.`);
      }
    }
    query = query.or(conditions.join(','));
  }

  if (typeof filters?.offset === 'number') {
    const limit = filters.limit ?? 50;
    query = query.range(filters.offset, filters.offset + limit - 1);
  } else if (typeof filters?.limit === 'number') {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  return data || [];
}

export async function getCampaignLeadTablePage(
  campaignId: string,
  query?: CampaignLeadTableQuery,
): Promise<CampaignLeadTableResult> {
  const sortBy = getCampaignLeadTableSortBy(query?.sortBy);
  const ascending = query?.sortDirection === 'asc';
  const limit = query?.limit ?? 20;
  const offset = query?.offset ?? 0;
  const scopedLeadIds = await resolveCampaignLeadScopeIds(campaignId, query);
  const scopedLeadIdsForQuery = scopedLeadIds ?? null;
  if (scopedLeadIds?.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  let leadRows: CampaignLeadBaseRow[];
  let totalCount: number;

  if (campaignScopedLeadIdsNeedRpc(scopedLeadIdsForQuery)) {
    const r = await fetchCampaignLeadsTablePageRpc(
      campaignId,
      query,
      scopedLeadIdsForQuery ?? [],
      sortBy,
      ascending,
      limit,
      offset,
    );
    leadRows = r.rows;
    totalCount = r.totalCount;
  } else {
    const leadsQuery = buildCampaignLeadTableQuery(campaignId, query, true, scopedLeadIdsForQuery);
    const { data, error, count } = await leadsQuery
      .order(sortBy, { ascending, nullsFirst: !ascending })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to fetch leads: ${error.message}`);
    }

    leadRows = (data ?? []) as CampaignLeadBaseRow[];
    totalCount = count ?? 0;
  }

  const leadIds = leadRows.map((lead) => lead.id);
  const enrollmentByLeadId = await fetchCampaignLeadEnrollmentMap(
    campaignId,
    leadIds,
  );
  const replyCategoryByLeadId = await fetchCampaignLeadReplyCategoryMap(campaignId, leadIds);
  const replacementSummaryByLeadId = await getLeadReplacementSummariesByLeadIds(leadIds);

  return {
    rows: mapCampaignLeadTableRows(
      leadRows,
      enrollmentByLeadId,
      replyCategoryByLeadId,
      replacementSummaryByLeadId,
    ),
    totalCount,
  };
}

export async function getCampaignLeadTableExportRows(
  campaignId: string,
  query?: Omit<CampaignLeadTableQuery, 'limit' | 'offset'>,
): Promise<CampaignLeadTableRow[]> {
  const sortBy = getCampaignLeadTableSortBy(query?.sortBy);
  const ascending = query?.sortDirection === 'asc';
  const pageSize = 500;
  const rows: CampaignLeadTableRow[] = [];
  const scopedLeadIds = await resolveCampaignLeadScopeIds(campaignId, query);
  const scopedLeadIdsForQuery = scopedLeadIds ?? null;

  if (scopedLeadIds?.length === 0) {
    return rows;
  }

  if (campaignScopedLeadIdsNeedRpc(scopedLeadIdsForQuery)) {
    for (let offset = 0; ; offset += pageSize) {
      const { rows: leadRows } = await fetchCampaignLeadsTablePageRpc(
        campaignId,
        query,
        scopedLeadIdsForQuery ?? [],
        sortBy,
        ascending,
        pageSize,
        offset,
      );
      if (leadRows.length === 0) break;
      const leadIds = leadRows.map((lead) => lead.id);
      const enrollmentByLeadId = await fetchCampaignLeadEnrollmentMap(campaignId, leadIds);
      const replyCategoryByLeadId = await fetchCampaignLeadReplyCategoryMap(campaignId, leadIds);
      const replacementSummaryByLeadId = await getLeadReplacementSummariesByLeadIds(leadIds);
      rows.push(
        ...mapCampaignLeadTableRows(
          leadRows,
          enrollmentByLeadId,
          replyCategoryByLeadId,
          replacementSummaryByLeadId,
        )
      );
      if (leadRows.length < pageSize) break;
    }
    return rows;
  }

  for (let offset = 0; ; offset += pageSize) {
    const leadsQuery = buildCampaignLeadTableQuery(campaignId, query, false, scopedLeadIdsForQuery);
    const { data, error } = await leadsQuery
      .order(sortBy, { ascending, nullsFirst: !ascending })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch leads: ${error.message}`);
    }

    const leadRows = (data ?? []) as CampaignLeadBaseRow[];
    if (leadRows.length === 0) break;
    const leadIds = leadRows.map((lead) => lead.id);

    const enrollmentByLeadId = await fetchCampaignLeadEnrollmentMap(
      campaignId,
      leadIds,
    );
    const replyCategoryByLeadId = await fetchCampaignLeadReplyCategoryMap(campaignId, leadIds);
    const replacementSummaryByLeadId = await getLeadReplacementSummariesByLeadIds(leadIds);
    rows.push(
      ...mapCampaignLeadTableRows(
        leadRows,
        enrollmentByLeadId,
        replyCategoryByLeadId,
        replacementSummaryByLeadId,
      )
    );

    if (leadRows.length < pageSize) break;
  }

  return rows;
}

export interface LeadCountFilters {
  campaignId?: string;
  bucketId?: string;
  /** Count only leads where any of these fields is null or empty. Prefix custom fields with "custom." */
  missingFields?: string[];
}

/**
 * Get total lead count with optional filters (count-only query, no row limit).
 */
export async function getLeadCount(filters?: LeadCountFilters): Promise<number> {
  let query = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null) as any;

  if (filters?.campaignId) {
    query = query.eq('campaign_id', filters.campaignId);
  }

  if (filters?.bucketId) {
    query = query.eq('bucket_id', filters.bucketId);
  }

  if (filters?.missingFields?.length) {
    const conditions: string[] = [];
    for (const field of filters.missingFields) {
      if (field.startsWith('custom.')) {
        const jsonKey = field.slice(7);
        conditions.push(`custom_lead_data->>${jsonKey}.is.null`);
        conditions.push(`custom_lead_data->>${jsonKey}.eq.`);
      } else {
        conditions.push(`${field}.is.null`);
        conditions.push(`${field}.eq.`);
      }
    }
    query = query.or(conditions.join(','));
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch lead count: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Get a single lead by ID
 */
export async function getLeadById(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch lead: ${error.message}`);
  }

  return data;
}

/**
 * Get leads by IDs (batch). Returns empty array if ids is empty.
 */
export async function getLeadsByIds(ids: string[]): Promise<Lead[]> {
  if (ids.length === 0) return [];
  const out: Lead[] = [];
  for (const chunk of chunkIds(ids, POSTGREST_IN_CHUNK_SIZE)) {
    const { data, error } = await supabase.from('leads').select('*').in('id', chunk);
    if (error) {
      throw new Error(`Failed to fetch leads: ${error.message}`);
    }
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * Create a new lead
 */
export async function createLead(lead: LeadInsert): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      ...lead,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create lead: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to create lead: No data returned');
  }

  return data;
}

/**
 * Create multiple leads (bulk insert)
 */
export async function createLeads(leads: LeadInsert[]): Promise<Lead[]> {
  if (leads.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const leadsWithTimestamps = leads.map(lead => ({
    ...lead,
    created_at: now,
    updated_at: now,
  }));

  const { data, error } = await supabase
    .from('leads')
    .insert(leadsWithTimestamps)
    .select();

  if (error) {
    throw new Error(`Failed to create leads: ${error.message}`);
  }

  return data || [];
}

/**
 * Update a lead
 */
export async function updateLead(id: string, updates: LeadUpdate): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update lead: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to update lead: No data returned');
  }

  return data;
}

/**
 * Delete a lead (soft delete - sets status to 'removed')
 */
export async function deleteLead(id: string): Promise<void> {
  const now = new Date().toISOString();
  const [leadResult, enrollmentsResult, jobsResult] = await Promise.all([
    supabase
      .from('leads')
      .update({
        status: 'removed',
        deleted_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .is('deleted_at', null),
    supabase
      .from('enrollments')
      .update({
        deleted_at: now,
        state: 'stopped',
        next_run_at: null,
        updated_at: now,
      })
      .eq('lead_id', id)
      .is('deleted_at', null),
    supabase
      .from('message_jobs')
      .update({
        status: 'cancelled',
        status_reason: 'lead_deleted',
        error_message: 'Lead deleted',
        updated_at: now,
      })
      .eq('lead_id', id)
      .in('status', ['queued', 'reserved'])
      .or('message_type.eq.campaign,message_type.is.null'),
  ]);

  if (leadResult.error) {
    throw new Error(`Failed to delete lead: ${leadResult.error.message}`);
  }
  if (enrollmentsResult.error) {
    throw new Error(`Failed to delete lead enrollments: ${enrollmentsResult.error.message}`);
  }
  if (jobsResult.error) {
    throw new Error(`Failed to cancel deleted lead jobs: ${jobsResult.error.message}`);
  }
}

export interface DeleteLeadAttemptFailure {
  id: string;
  error: string;
}

/**
 * Remove multiple leads using the same semantics as {@link deleteLead}, one at a time.
 * Best-effort: failures do not roll back other leads; callers should surface partial results.
 */
export async function deleteLeadsBestEffort(ids: string[]): Promise<{
  succeeded: string[];
  failed: DeleteLeadAttemptFailure[];
}> {
  const unique = [...new Set(ids.filter(Boolean))];
  const succeeded: string[] = [];
  const failed: DeleteLeadAttemptFailure[] = [];
  for (const id of unique) {
    try {
      await deleteLead(id);
      succeeded.push(id);
    } catch (err) {
      failed.push({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { succeeded, failed };
}

/**
 * Hard delete a lead (permanent removal)
 */
export async function hardDeleteLead(id: string): Promise<void> {
  throw new Error('Hard lead delete is disabled. Use deleteLead() to soft delete the lead.');
}

export async function replaceLeadWithNewContact(
  input: ReplaceLeadWithNewContactInput
): Promise<ReplaceLeadWithNewContactResult> {
  const newEmail = input.newEmail.trim().toLowerCase();
  if (!newEmail) {
    throw new Error('Replacement email is required.');
  }

  const { data, error } = await supabase.rpc('replace_lead_with_new_contact', {
    p_old_lead_id: input.oldLeadId,
    p_new_email: newEmail,
    p_new_name: input.newName?.trim() || null,
    p_new_first_name: input.newFirstName?.trim() || null,
    p_new_last_name: input.newLastName?.trim() || null,
    p_new_phone_number: input.newPhoneNumber?.trim() || null,
    p_reason: input.reason ?? 'manual_referral',
    p_reason_note: input.reasonNote?.trim() || null,
    p_source_message_id: input.sourceMessageId ?? null,
  });

  if (error) {
    throw new Error(`Failed to replace lead: ${error.message}`);
  }

  const result = Array.isArray(data) ? data[0] : null;
  if (!result?.new_lead_id || !result?.replacement_id) {
    throw new Error('Failed to replace lead: no replacement result returned.');
  }

  const newLead = await getLeadById(result.new_lead_id);
  if (!newLead) {
    throw new Error('Failed to load replacement lead after creation.');
  }

  return {
    replacementId: result.replacement_id,
    newLeadId: result.new_lead_id,
    enrollmentId: result.enrollment_id ?? null,
    newLead,
  };
}

/**
 * Apply optional profile-field overrides to a lead row. Used by the replace-lead
 * flow to push the user's edits to fields the RPC already inherited from the old
 * lead (`company_name`, `website`, the LinkedIn URLs, and `custom_lead_data`).
 *
 * Only properties explicitly present on `input` are sent; `undefined` means
 * "leave the existing column alone". Returns early when there is nothing to patch
 * so callers can pass an unconditional diff without worrying about no-op updates.
 */
export async function updateLeadProfileFields(input: UpdateLeadProfileFieldsInput): Promise<void> {
  const patch: LeadUpdate = {};
  if (input.companyName !== undefined) patch.company_name = input.companyName;
  if (input.website !== undefined) patch.website = input.website;
  if (input.linkedinUrl !== undefined) patch.linkedin_url = input.linkedinUrl;
  if (input.companyLinkedinUrl !== undefined) patch.company_linkedin_url = input.companyLinkedinUrl;
  if (input.customLeadData !== undefined) {
    patch.custom_lead_data = input.customLeadData as LeadUpdate['custom_lead_data'];
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('leads').update(patch).eq('id', input.leadId);
  if (error) {
    throw new Error(`Failed to update lead profile fields: ${error.message}`);
  }
}

