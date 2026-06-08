import { supabase } from '../../client';
import { getCampaignIdsForTags } from '../campaign-tags';
import { getCampaignsListSummary } from '../campaigns/campaign-list-summary';
import {
  fetchLeadsByGlobalLeadIds,
  type LeadRowByGlobalId,
} from './fetch-leads-by-global-ids';
import { resolvePersonSummaryCellValue } from '@/lib/leads/columns/resolveCellValue';
import type { LeadsColumnDef } from '@/lib/leads/columns/types';
import { EXPLORER_COLUMNS, type LeadsTableRow } from '@/lib/leads/columns';
import { buildExplorerExportRows } from '@/lib/leads/export/buildExportRows';
import { LEADS_EXPORT_CHUNK_SIZE } from '@/lib/leads/export/constants';
import type {
  LeadsCellValue,
  LeadsListDefinition,
  LeadsPeopleRow,
  LeadsReplyStatusFilter,
  LeadsWorkbenchDataset,
  MockCampaign,
  MockEnrollmentState,
  MockMembership,
  MockPerson,
  MockReplyCategory,
} from '@/lib/devtools/leads-workbench/types';

const POSTGREST_IN_CHUNK_SIZE = 100;
const POSTGREST_RANGE_PAGE_SIZE = 500;

function chunk<T>(values: T[], chunkSize = POSTGREST_IN_CHUNK_SIZE): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function coerceMockReplyCategory(value: string | null | undefined): MockReplyCategory {
  return value === 'Interested' || value === 'Neutral' || value === 'Not Interested' ? value : null;
}

type AccountLeadPeopleRpcRow = {
  global_lead_id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  campaign_count: number;
  company_list: string | null;
  has_reply: boolean;
  latest_activity: string | null;
  newest_membership_created_at: string | null;
  total_count: number;
};

export interface AccountLeadExplorerQuery {
  searchQuery?: string;
  campaignIds?: string[];
  campaignTagIds?: string[];
  replyStatuses?: LeadsReplyStatusFilter[];
  enrollmentStates?: MockEnrollmentState[];
  replyCategories?: Array<NonNullable<MockReplyCategory> | 'not_categorized'>;
  globalLeadIds?: string[];
  limit?: number;
  offset?: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface AccountLeadPersonSummary {
  globalLeadId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  campaignCount: number;
  companyList: string | null;
  hasReply: boolean;
  latestActivity: string | null;
  newestMembershipCreatedAt: string | null;
}

export interface AccountLeadPeoplePageResult {
  rows: AccountLeadPersonSummary[];
  totalCount: number;
}

export type LeadsRowForWorkbench = LeadRowByGlobalId;
export { fetchLeadsByGlobalLeadIds };

type EnrollmentRowForWorkbench = {
  id: string;
  lead_id: string | null;
  state: string | null;
};

type ThreadRowForWorkbench = {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  category: string | null;
  last_message_at: string;
  has_reply: boolean;
};

/**
 * Resolves campaign tag filters to campaign ids. When both campaign and tag filters are set,
 * returns the intersection. Returns `[]` when tags match no campaigns (caller should short-circuit).
 * Returns `undefined` when no campaign/tag filter is active.
 */
export async function resolveExplorerCampaignIds(
  accountId: string,
  query: Pick<AccountLeadExplorerQuery, 'campaignIds' | 'campaignTagIds'>,
): Promise<string[] | undefined> {
  const campaignIds = query.campaignIds?.length ? [...new Set(query.campaignIds)] : [];
  const tagCampaignIds = query.campaignTagIds?.length
    ? await getCampaignIdsForTags(accountId, query.campaignTagIds)
    : [];

  if (campaignIds.length > 0 && tagCampaignIds.length > 0) {
    const tagSet = new Set(tagCampaignIds);
    return campaignIds.filter((id) => tagSet.has(id));
  }
  if (campaignIds.length > 0) return campaignIds;
  if (tagCampaignIds.length > 0) return tagCampaignIds;
  return undefined;
}

export async function getAccountLeadCampaigns(accountId: string): Promise<MockCampaign[]> {
  const campaigns = await getCampaignsListSummary(accountId);
  return campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    isSmartlead: campaign.source === 'smartlead',
  }));
}

export async function getAccountLeadPersonSummaryFromRollup(
  accountId: string,
  globalLeadId: string,
): Promise<AccountLeadPersonSummary | null> {
  const { data, error } = await supabase
    .from('account_lead_people')
    .select(
      'global_lead_id, email, display_name, first_name, last_name, campaign_count, company_list, has_reply, latest_activity_at, newest_membership_created_at',
    )
    .eq('account_id', accountId)
    .eq('global_lead_id', globalLeadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load account lead person: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const row = data as {
    global_lead_id: string;
    email: string | null;
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    campaign_count: number | null;
    company_list: string | null;
    has_reply: boolean | null;
    latest_activity_at: string | null;
    newest_membership_created_at: string | null;
  };

  return {
    globalLeadId: row.global_lead_id,
    email: row.email ?? '',
    displayName: row.display_name,
    firstName: row.first_name,
    lastName: row.last_name,
    campaignCount: row.campaign_count ?? 0,
    companyList: row.company_list,
    hasReply: row.has_reply ?? false,
    latestActivity: row.latest_activity_at,
    newestMembershipCreatedAt: row.newest_membership_created_at,
  };
}

export function buildMockPersonFromSummary(summary: AccountLeadPersonSummary): MockPerson {
  return {
    id: summary.globalLeadId,
    globalLeadId: summary.globalLeadId,
    email: summary.email,
    displayName: summary.displayName,
    firstName: summary.firstName,
    lastName: summary.lastName,
    memberships: [],
  };
}

export async function getAccountLeadPeoplePage(
  accountId: string,
  query: AccountLeadExplorerQuery = {},
): Promise<AccountLeadPeoplePageResult> {
  const effectiveCampaignIds = await resolveExplorerCampaignIds(accountId, query);
  if (effectiveCampaignIds !== undefined && effectiveCampaignIds.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  const { data, error } = await supabase.rpc('account_lead_people_page', {
    p_account_id: accountId,
    p_global_lead_ids: query.globalLeadIds?.length ? query.globalLeadIds : null,
    p_campaign_ids: effectiveCampaignIds?.length ? effectiveCampaignIds : null,
    p_reply_statuses: query.replyStatuses?.length ? query.replyStatuses : null,
    p_enrollment_states: query.enrollmentStates?.length ? query.enrollmentStates : null,
    p_reply_categories: query.replyCategories?.length ? query.replyCategories : null,
    p_search: query.searchQuery?.trim() ? query.searchQuery.trim() : null,
    p_limit: query.limit ?? 100,
    p_offset: query.offset ?? 0,
    p_sort_column: query.sortColumn ?? null,
    p_sort_direction: query.sortDirection ?? null,
  });

  if (error) {
    throw new Error(`Failed to load account leads: ${error.message}`);
  }

  const rows = (data ?? []) as AccountLeadPeopleRpcRow[];
  return {
    rows: rows.map((row) => ({
      globalLeadId: row.global_lead_id,
      email: row.email ?? '',
      displayName: row.display_name,
      firstName: row.first_name,
      lastName: row.last_name,
      campaignCount: row.campaign_count ?? 0,
      companyList: row.company_list,
      hasReply: row.has_reply ?? false,
      latestActivity: row.latest_activity,
      newestMembershipCreatedAt: row.newest_membership_created_at,
    })),
    totalCount: rows[0]?.total_count ?? 0,
  };
}

const EXPLORER_PAGE_MAX = 1000;

export async function fetchAllAccountLeadGlobalLeadIds(
  accountId: string,
  query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>,
): Promise<{ globalLeadIds: string[]; totalCount: number }> {
  const globalLeadIds: string[] = [];
  let totalCount = 0;
  let offset = 0;

  for (;;) {
    const page = await getAccountLeadPeoplePage(accountId, {
      ...query,
      limit: EXPLORER_PAGE_MAX,
      offset,
    });

    if (offset === 0) {
      totalCount = page.totalCount;
    }

    for (const row of page.rows) {
      globalLeadIds.push(row.globalLeadId);
    }

    if (page.rows.length < EXPLORER_PAGE_MAX) {
      break;
    }
    offset += EXPLORER_PAGE_MAX;
  }

  return { globalLeadIds, totalCount };
}

async function fetchAccountLeadPeopleForExportSelection(
  accountId: string,
  query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>,
  globalLeadIds: string[],
): Promise<AccountLeadPersonSummary[]> {
  const rows: AccountLeadPersonSummary[] = [];

  for (const idChunk of chunk(unique(globalLeadIds.filter(Boolean)), LEADS_EXPORT_CHUNK_SIZE)) {
    const page = await getAccountLeadPeoplePage(accountId, {
      ...query,
      globalLeadIds: idChunk,
      limit: idChunk.length,
      offset: 0,
    });
    rows.push(...page.rows);
  }

  return rows;
}

export async function getAccountLeadExplorerExportRows(
  accountId: string,
  params: {
    query?: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
    columns?: LeadsColumnDef[];
    globalLeadIds?: string[];
  } = {},
): Promise<LeadsTableRow[]> {
  const query = params.query ?? {};
  const columns = params.columns ?? EXPLORER_COLUMNS;

  if (params.globalLeadIds?.length) {
    const people = await fetchAccountLeadPeopleForExportSelection(accountId, query, params.globalLeadIds);
    return buildExplorerExportRows(people, columns);
  }

  const rows: LeadsTableRow[] = [];
  for (let offset = 0; ; offset += EXPLORER_PAGE_MAX) {
    const page = await getAccountLeadPeoplePage(accountId, {
      ...query,
      limit: EXPLORER_PAGE_MAX,
      offset,
    });
    rows.push(...buildExplorerExportRows(page.rows, columns));
    if (page.rows.length < EXPLORER_PAGE_MAX) break;
  }

  return rows;
}

export function buildExplorerRows(
  people: AccountLeadPersonSummary[],
  list: LeadsListDefinition,
): LeadsPeopleRow[] {
  return people.map((person) => {
    const emptyPerson: MockPerson = {
      id: person.globalLeadId,
      globalLeadId: person.globalLeadId,
      email: person.email,
      displayName: person.displayName,
      firstName: person.firstName,
      lastName: person.lastName,
      memberships: [],
    };

    const cells: Record<string, LeadsCellValue> = {};
    for (const column of list.columns) {
      cells[column.id] = resolvePersonSummaryCellValue(person, column.fieldKey);
    }

    return {
      person: emptyPerson,
      globalLeadId: person.globalLeadId,
      cells,
    };
  });
}

async function fetchEnrollmentsForLeadIds(accountId: string, leadIds: string[]): Promise<EnrollmentRowForWorkbench[]> {
  const rows: EnrollmentRowForWorkbench[] = [];
  for (const idChunk of chunk(unique(leadIds))) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('enrollments')
        .select('id, lead_id, state')
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .in('lead_id', idChunk)
        .order('id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch enrollments for leads: ${error.message}`);
      }

      const pageRows = (data ?? []) as EnrollmentRowForWorkbench[];
      rows.push(...pageRows);
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }
  return rows;
}

async function fetchThreadsForLeadIds(accountId: string, leadIds: string[]): Promise<ThreadRowForWorkbench[]> {
  const rows: ThreadRowForWorkbench[] = [];
  for (const idChunk of chunk(unique(leadIds))) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('email_threads')
        .select('id, lead_id, campaign_id, category, last_message_at, has_reply')
        .eq('account_id', accountId)
        .in('lead_id', idChunk)
        .order('id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch lead threads: ${error.message}`);
      }

      const pageRows = (data ?? []) as ThreadRowForWorkbench[];
      rows.push(...pageRows);
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }
  return rows;
}

function buildThreadMap(threads: ThreadRowForWorkbench[]) {
  const byLeadId = new Map<
    string,
    {
      hasReply: boolean;
      latestActivityAt: string | null;
      replyCategory: MockReplyCategory;
    }
  >();

  for (const thread of threads) {
    if (!thread.lead_id) continue;
    const current = byLeadId.get(thread.lead_id);
    const replyCategory = coerceMockReplyCategory(thread.category);
    if (!current) {
      byLeadId.set(thread.lead_id, {
        hasReply: thread.has_reply,
        latestActivityAt: thread.last_message_at,
        replyCategory,
      });
      continue;
    }
    const latestActivityAt =
      current.latestActivityAt && current.latestActivityAt > thread.last_message_at
        ? current.latestActivityAt
        : thread.last_message_at;
    byLeadId.set(thread.lead_id, {
      hasReply: current.hasReply || thread.has_reply,
      latestActivityAt,
      replyCategory: latestActivityAt === thread.last_message_at ? replyCategory : current.replyCategory,
    });
  }

  return byLeadId;
}

export type AccountLeadWorkbenchDatasetOptions = {
  /** When false, skips inbox thread fetches (faster review for large selections). */
  includeReplyActivity?: boolean;
};

export async function getAccountLeadWorkbenchDataset(
  accountId: string,
  globalLeadIds: string[],
  options: AccountLeadWorkbenchDatasetOptions = {},
): Promise<LeadsWorkbenchDataset> {
  const includeReplyActivity = options.includeReplyActivity !== false;

  if (globalLeadIds.length === 0) {
    return {
      campaigns: await getAccountLeadCampaigns(accountId),
      people: [],
    };
  }

  const [campaigns, leads] = await Promise.all([
    getAccountLeadCampaigns(accountId),
    fetchLeadsByGlobalLeadIds(accountId, globalLeadIds),
  ]);

  const leadIds = leads.map((lead) => lead.id);
  const [enrollments, threads] =
    includeReplyActivity && leadIds.length
      ? await Promise.all([
          fetchEnrollmentsForLeadIds(accountId, leadIds),
          fetchThreadsForLeadIds(accountId, leadIds),
        ])
      : [[], []];

  const enrollmentStateByLeadId = new Map<string, MockMembership['enrollmentState']>();
  for (const enrollment of enrollments) {
    if (!enrollment.lead_id) continue;
    const state = enrollment.state;
    const normalized =
      state === 'active' || state === 'paused' || state === 'completed' || state === 'stopped'
        ? state
        : 'not_started';
    enrollmentStateByLeadId.set(enrollment.lead_id, normalized);
  }

  const threadByLeadId = includeReplyActivity ? buildThreadMap(threads) : new Map();
  const peopleByGlobalId = new Map<string, MockPerson>();

  for (const lead of leads) {
    if (!lead.global_lead_id || !lead.email) continue;
    const existing = peopleByGlobalId.get(lead.global_lead_id);
    const thread = threadByLeadId.get(lead.id);
    const membership: MockMembership = {
      id: lead.id,
      globalLeadId: lead.global_lead_id,
      campaignId: lead.campaign_id,
      companyName: lead.company_name,
      title: null,
      enrollmentState: enrollmentStateByLeadId.get(lead.id) ?? 'not_started',
      replyCategory: thread?.replyCategory ?? null,
      createdAt: lead.created_at,
      lastActivityAt: thread?.latestActivityAt ?? lead.created_at,
      hasReply: thread?.hasReply ?? false,
      phone: lead.phone_number,
      website: lead.website,
      linkedinUrl: lead.linkedin_url,
      customLeadData: (lead.custom_lead_data ?? {}) as Record<string, string | number | null>,
    };

    if (!existing) {
      peopleByGlobalId.set(lead.global_lead_id, {
        id: lead.global_lead_id,
        globalLeadId: lead.global_lead_id,
        email: lead.email,
        displayName: lead.name ?? ([lead.first_name, lead.last_name].filter(Boolean).join(' ') || null),
        firstName: lead.first_name,
        lastName: lead.last_name,
        memberships: [membership],
      });
      continue;
    }

    existing.displayName =
      existing.displayName ??
      lead.name ??
      ([lead.first_name, lead.last_name].filter(Boolean).join(' ') || null);
    existing.firstName = existing.firstName ?? lead.first_name;
    existing.lastName = existing.lastName ?? lead.last_name;
    existing.memberships.push(membership);
  }

  return {
    campaigns,
    people: Array.from(peopleByGlobalId.values()).sort((left, right) => {
      const leftNewest = [...left.memberships].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? '';
      const rightNewest = [...right.memberships].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? '';
      return rightNewest.localeCompare(leftNewest);
    }),
  };
}
