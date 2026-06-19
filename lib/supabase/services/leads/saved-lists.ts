import { supabase } from '../../client';
import { generateGlobalLeadId } from '@/lib/leads';
import { buildSavedListExportRows, mapAccountSummaryToSavedListPeopleRow } from '@/lib/leads/export/buildExportRows';
import { shouldContinueSavedListExportPagination } from '@/lib/leads/export/pagination';
import { LEADS_EXPORT_CHUNK_SIZE, SAVED_LIST_PAGE_MAX } from '@/lib/leads/export/constants';
import { columnsNeedWorkbenchDataset } from '@/lib/leads/columns/buildSavedListRows';
import type { LeadsTableRow } from '@/lib/leads/columns/buildTableColumns';
import { DEFAULT_SAVED_LIST_COLUMNS } from '@/lib/leads/columns/defaults';
import {
  assertColumnLayoutWritable,
  layoutNeedsReplyActivity,
  parseColumnLayout,
} from '@/lib/leads/columns/parseColumnLayout';
import type { LeadsColumnDef } from '@/lib/leads/columns/types';
import {
  getAccountLeadPeoplePage,
  getAccountLeadWorkbenchDataset,
  fetchAllAccountLeadGlobalLeadIds,
  resolveExplorerCampaignIds,
  type AccountLeadExplorerQuery,
} from './account-leads';
import { applyListMembershipForScope } from './list-membership-scoped';
import type {
  LeadsReplyStatusFilter,
  MockEnrollmentState,
  MockReplyCategory,
} from '@/lib/devtools/leads-workbench/types';

const POSTGREST_IN_CHUNK_SIZE = 100;
const POSTGREST_RANGE_PAGE_SIZE = 500;

export interface AddMembersToSavedLeadListResult {
  added: number;
  skippedAlreadyMember: number;
  skippedInvalid: number;
}

export interface RemoveMembersFromSavedLeadListResult {
  removed: number;
  skippedNotMember: number;
}

export type ListMembershipMutationResult =
  | AddMembersToSavedLeadListResult
  | RemoveMembersFromSavedLeadListResult;

export interface SavedLeadListSummary {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  leadCount: number;
}

export interface SavedLeadListMetadata extends SavedLeadListSummary {
  columnLayout: LeadsColumnDef[];
}

export interface SavedLeadListDetail extends SavedLeadListMetadata {
  memberGlobalLeadIds: string[];
}

type SavedLeadListRow = {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  column_layout: unknown;
  created_at: string;
  updated_at: string;
};

type SavedLeadListMemberRow = {
  list_id: string;
  account_id: string;
  global_lead_id: string;
  source: 'selection' | 'csv' | 'manual';
  created_at: string;
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function chunk<T>(values: T[], chunkSize = POSTGREST_IN_CHUNK_SIZE): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('List name cannot be empty.');
  return trimmed;
}

export function normalizeImportedEmails(emails: string[]): string[] {
  return unique(
    emails
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

async function getSavedLeadListMemberCounts(accountId: string, listIds: string[]) {
  const counts = new Map<string, number>();
  if (listIds.length === 0) return counts;

  const { data, error } = await supabase.rpc('lead_saved_list_member_counts', {
    p_account_id: accountId,
    p_list_ids: unique(listIds),
  });

  if (error) {
    throw new Error(`Failed to count saved lead list members: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<{ list_id: string; lead_count: number }>) {
    counts.set(row.list_id, row.lead_count ?? 0);
  }

  return counts;
}

/** Loads all member global_lead_ids — use only when a caller truly needs the full set. */
async function getSavedLeadListMembersMap(accountId: string, listIds: string[]) {
  if (listIds.length === 0) return new Map<string, SavedLeadListMemberRow[]>();

  const rows: SavedLeadListMemberRow[] = [];
  for (const listIdChunk of chunk(unique(listIds))) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('lead_saved_list_members')
        .select('list_id, account_id, global_lead_id, source, created_at')
        .eq('account_id', accountId)
        .in('list_id', listIdChunk)
        .order('list_id', { ascending: true })
        .order('global_lead_id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch saved lead list members: ${error.message}`);
      }

      const pageRows = (data ?? []) as SavedLeadListMemberRow[];
      rows.push(...pageRows);
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }

  const byListId = new Map<string, SavedLeadListMemberRow[]>();
  for (const row of rows) {
    const current = byListId.get(row.list_id) ?? [];
    current.push(row);
    byListId.set(row.list_id, current);
  }
  return byListId;
}

function mapSummary(row: SavedLeadListRow, leadCount: number): SavedLeadListSummary {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leadCount,
  };
}

function mapMetadata(row: SavedLeadListRow, leadCount: number): SavedLeadListMetadata {
  return {
    ...mapSummary(row, leadCount),
    columnLayout: parseColumnLayout(row.column_layout),
  };
}

export async function getSavedLeadLists(accountId: string): Promise<SavedLeadListSummary[]> {
  const rows: SavedLeadListRow[] = [];
  for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('lead_saved_lists')
      .select('id, account_id, name, description, column_layout, created_at, updated_at')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch saved lead lists: ${error.message}`);
    }

    const pageRows = (data ?? []) as SavedLeadListRow[];
    rows.push(...pageRows);
    if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
  }

  const counts = await getSavedLeadListMemberCounts(
    accountId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => mapSummary(row, counts.get(row.id) ?? 0));
}

export async function getSavedLeadListMetadata(
  accountId: string,
  listId: string,
): Promise<SavedLeadListMetadata | null> {
  const { data, error } = await supabase
    .from('lead_saved_lists')
    .select('id, account_id, name, description, column_layout, created_at, updated_at')
    .eq('account_id', accountId)
    .eq('id', listId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch saved lead list: ${error.message}`);
  }
  if (!data) return null;

  const { count, error: countError } = await supabase
    .from('lead_saved_list_members')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('list_id', listId);

  if (countError) {
    throw new Error(`Failed to count saved lead list members: ${countError.message}`);
  }

  return mapMetadata(data as SavedLeadListRow, count ?? 0);
}

export async function getSavedLeadList(accountId: string, listId: string): Promise<SavedLeadListDetail | null> {
  const metadata = await getSavedLeadListMetadata(accountId, listId);
  if (!metadata) return null;

  const membersByListId = await getSavedLeadListMembersMap(accountId, [listId]);
  const members = membersByListId.get(listId) ?? [];

  return {
    ...metadata,
    memberGlobalLeadIds: members.map((member) => member.global_lead_id),
  };
}

async function insertSavedLeadListWithMembers(
  accountId: string,
  params: {
    name: string;
    description?: string | null;
    memberGlobalLeadIds: string[];
    source: 'selection' | 'csv' | 'manual';
    columnLayout?: LeadsColumnDef[];
  },
): Promise<SavedLeadListDetail> {
  const memberGlobalLeadIds = unique(params.memberGlobalLeadIds.filter(Boolean));
  if (memberGlobalLeadIds.length === 0) {
    throw new Error('A saved list needs at least one lead.');
  }

  const columnLayout = assertColumnLayoutWritable(params.columnLayout ?? DEFAULT_SAVED_LIST_COLUMNS);

  const { data: listRow, error: listError } = await supabase
    .from('lead_saved_lists')
    .insert({
      account_id: accountId,
      name: normalizeName(params.name),
      description: params.description?.trim() || null,
      column_layout: columnLayout as never,
    })
    .select('id, account_id, name, description, column_layout, created_at, updated_at')
    .single();

  if (listError) {
    throw new Error(`Failed to create saved lead list: ${listError.message}`);
  }

  for (const memberChunk of chunk(memberGlobalLeadIds, POSTGREST_RANGE_PAGE_SIZE)) {
    const { error: membersError } = await supabase
      .from('lead_saved_list_members')
      .insert(
        memberChunk.map((globalLeadId) => ({
          list_id: listRow.id,
          account_id: accountId,
          global_lead_id: globalLeadId,
          source: params.source,
        })),
      );

    if (membersError) {
      throw new Error(`Failed to save list members: ${membersError.message}`);
    }
  }

  return {
    ...mapMetadata(listRow as SavedLeadListRow, memberGlobalLeadIds.length),
    memberGlobalLeadIds,
  };
}

export async function createSavedLeadListFromGlobalLeadIds(
  accountId: string,
  params: {
    name: string;
    description?: string | null;
    globalLeadIds: string[];
  },
): Promise<SavedLeadListDetail> {
  return insertSavedLeadListWithMembers(accountId, {
    name: params.name,
    description: params.description,
    memberGlobalLeadIds: params.globalLeadIds,
    source: 'selection',
  });
}

export async function createSavedLeadListFromExplorerView(
  accountId: string,
  params: {
    name: string;
    description?: string | null;
    query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
  },
): Promise<SavedLeadListDetail> {
  const { globalLeadIds } = await fetchAllAccountLeadGlobalLeadIds(accountId, params.query);
  if (globalLeadIds.length === 0) {
    throw new Error('No leads match the current view.');
  }

  return insertSavedLeadListWithMembers(accountId, {
    name: params.name,
    description: params.description,
    memberGlobalLeadIds: globalLeadIds,
    source: 'selection',
  });
}

export interface ResolvedCsvLeadListEmails {
  normalizedEmails: string[];
  matchedGlobalLeadIds: string[];
  matchedEmailCount: number;
  unmatchedEmails: string[];
}

export async function resolveLeadListCsvEmails(
  accountId: string,
  emails: string[],
): Promise<ResolvedCsvLeadListEmails> {
  const normalizedEmails = normalizeImportedEmails(emails);
  if (normalizedEmails.length === 0) {
    return {
      normalizedEmails: [],
      matchedGlobalLeadIds: [],
      matchedEmailCount: 0,
      unmatchedEmails: [],
    };
  }

  const hashes = (
    await Promise.all(normalizedEmails.map((email) => generateGlobalLeadId(email)))
  ).filter((value): value is string => Boolean(value));

  if (hashes.length === 0) {
    return {
      normalizedEmails,
      matchedGlobalLeadIds: [],
      matchedEmailCount: 0,
      unmatchedEmails: normalizedEmails,
    };
  }

  const matchedRows: Array<{ email: string | null; global_lead_id: string | null }> = [];
  for (const hashChunk of chunk(unique(hashes))) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('leads')
        .select('email, global_lead_id')
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .in('global_lead_id', hashChunk)
        .order('global_lead_id', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to resolve CSV emails against leads: ${error.message}`);
      }

      const pageRows = (data ?? []) as Array<{ email: string | null; global_lead_id: string | null }>;
      matchedRows.push(...pageRows);
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }
  const matchedGlobalLeadIds = unique(
    matchedRows.map((row) => row.global_lead_id).filter((value): value is string => Boolean(value)),
  );
  const matchedEmails = new Set(
    matchedRows.map((row) => row.email?.trim().toLowerCase()).filter((value): value is string => Boolean(value)),
  );

  return {
    normalizedEmails,
    matchedGlobalLeadIds,
    matchedEmailCount: matchedEmails.size,
    unmatchedEmails: normalizedEmails.filter((email) => !matchedEmails.has(email)),
  };
}

export async function createSavedLeadListFromCsvEmails(
  accountId: string,
  params: {
    name: string;
    description?: string | null;
    emails: string[];
  },
): Promise<SavedLeadListDetail> {
  const resolved = await resolveLeadListCsvEmails(accountId, params.emails);
  if (resolved.matchedGlobalLeadIds.length === 0) {
    throw new Error('No matching leads were found for the imported CSV.');
  }

  return insertSavedLeadListWithMembers(accountId, {
    name: params.name,
    description: params.description,
    memberGlobalLeadIds: resolved.matchedGlobalLeadIds,
    source: 'csv',
  });
}

export async function updateSavedLeadList(
  accountId: string,
  listId: string,
  params: { name?: string; description?: string | null; columnLayout?: LeadsColumnDef[] },
): Promise<SavedLeadListSummary> {
  const updates: {
    name?: string;
    description?: string | null;
    column_layout?: LeadsColumnDef[];
  } = {};
  if (params.name !== undefined) updates.name = normalizeName(params.name);
  if (params.description !== undefined) updates.description = params.description?.trim() || null;
  if (params.columnLayout !== undefined) {
    updates.column_layout = assertColumnLayoutWritable(params.columnLayout);
  }

  const { data, error } = await supabase
    .from('lead_saved_lists')
    .update(updates as never)
    .eq('account_id', accountId)
    .eq('id', listId)
    .select('id, account_id, name, description, column_layout, created_at, updated_at')
    .single();

  if (error) {
    throw new Error(`Failed to update saved lead list: ${error.message}`);
  }

  const { count, error: countError } = await supabase
    .from('lead_saved_list_members')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('list_id', listId);

  if (countError) {
    throw new Error(`Failed to count saved lead list members: ${countError.message}`);
  }

  return mapSummary(data as SavedLeadListRow, count ?? 0);
}

export async function updateSavedLeadListColumnLayout(
  accountId: string,
  listId: string,
  columnLayout: LeadsColumnDef[],
): Promise<void> {
  await updateSavedLeadList(accountId, listId, { columnLayout });
}

export async function deleteSavedLeadList(accountId: string, listId: string): Promise<void> {
  const { error } = await supabase
    .from('lead_saved_lists')
    .delete()
    .eq('account_id', accountId)
    .eq('id', listId);

  if (error) {
    throw new Error(`Failed to delete saved lead list: ${error.message}`);
  }
}

export interface SavedLeadListPeoplePageRow {
  globalLeadId: string;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  campaignCount: number;
  companyList: string | null;
  hasReply: boolean;
  latestActivity: string | null;
  newestMembershipCreatedAt: string | null;
}

export interface SavedLeadListPeoplePageResult {
  rows: SavedLeadListPeoplePageRow[];
  totalCount: number;
}

export interface SavedLeadListPeopleQuery {
  searchQuery?: string;
  campaignIds?: string[];
  campaignTagIds?: string[];
  replyStatuses?: LeadsReplyStatusFilter[];
  enrollmentStates?: MockEnrollmentState[];
  replyCategories?: Array<NonNullable<MockReplyCategory> | 'not_categorized'>;
  limit?: number;
  offset?: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export async function getSavedLeadListPeoplePage(
  accountId: string,
  listId: string,
  params: SavedLeadListPeopleQuery = {},
): Promise<SavedLeadListPeoplePageResult> {
  const effectiveCampaignIds = await resolveExplorerCampaignIds(accountId, params);
  if (effectiveCampaignIds !== undefined && effectiveCampaignIds.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  const { data, error } = await supabase.rpc('saved_lead_list_people_page', {
    p_account_id: accountId,
    p_list_id: listId,
    p_campaign_ids: effectiveCampaignIds?.length ? effectiveCampaignIds : null,
    p_reply_statuses: params.replyStatuses?.length ? params.replyStatuses : null,
    p_enrollment_states: params.enrollmentStates?.length ? params.enrollmentStates : null,
    p_reply_categories: params.replyCategories?.length ? params.replyCategories : null,
    p_search: params.searchQuery?.trim() ? params.searchQuery.trim() : null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
    p_sort_column: params.sortColumn ?? null,
    p_sort_direction: params.sortDirection ?? null,
  });

  if (error) {
    throw new Error(`Failed to fetch saved list people page: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
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
  }>;

  return {
    rows: rows.map((row) => ({
      globalLeadId: row.global_lead_id,
      email: row.email,
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

async function assertSavedLeadListExists(accountId: string, listId: string): Promise<void> {
  const { data, error } = await supabase
    .from('lead_saved_lists')
    .select('id')
    .eq('account_id', accountId)
    .eq('id', listId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify saved lead list: ${error.message}`);
  }
  if (!data) {
    throw new Error('Saved list not found.');
  }
}

async function filterToAccountGlobalLeadIds(
  accountId: string,
  globalLeadIds: string[],
): Promise<Set<string>> {
  const valid = new Set<string>();
  const ids = unique(globalLeadIds.filter(Boolean));
  if (ids.length === 0) return valid;

  for (const idChunk of chunk(ids)) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('account_lead_people')
        .select('global_lead_id')
        .eq('account_id', accountId)
        .in('global_lead_id', idChunk)
        .order('global_lead_id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to resolve account leads: ${error.message}`);
      }

      const pageRows = (data ?? []) as Array<{ global_lead_id: string }>;
      for (const row of pageRows) {
        valid.add(row.global_lead_id);
      }
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }

  return valid;
}

async function getExistingListMemberIds(
  accountId: string,
  listId: string,
  globalLeadIds: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  const ids = unique(globalLeadIds.filter(Boolean));
  if (ids.length === 0) return existing;

  for (const idChunk of chunk(ids)) {
    for (let offset = 0; ; offset += POSTGREST_RANGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('lead_saved_list_members')
        .select('global_lead_id')
        .eq('account_id', accountId)
        .eq('list_id', listId)
        .in('global_lead_id', idChunk)
        .order('global_lead_id', { ascending: true })
        .range(offset, offset + POSTGREST_RANGE_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch list members: ${error.message}`);
      }

      const pageRows = (data ?? []) as Array<{ global_lead_id: string }>;
      for (const row of pageRows) {
        existing.add(row.global_lead_id);
      }
      if (pageRows.length < POSTGREST_RANGE_PAGE_SIZE) break;
    }
  }

  return existing;
}

export async function addMembersToSavedLeadList(
  accountId: string,
  params: {
    listId: string;
    globalLeadIds: string[];
    source?: 'selection' | 'manual';
  },
): Promise<AddMembersToSavedLeadListResult> {
  await assertSavedLeadListExists(accountId, params.listId);

  const requested = unique(params.globalLeadIds.filter(Boolean));
  if (requested.length === 0) {
    return { added: 0, skippedAlreadyMember: 0, skippedInvalid: 0 };
  }

  const validInAccount = await filterToAccountGlobalLeadIds(accountId, requested);
  const existingMembers = await getExistingListMemberIds(accountId, params.listId, requested);

  const toAdd = requested.filter((id) => validInAccount.has(id) && !existingMembers.has(id));
  const skippedAlreadyMember = requested.filter((id) => existingMembers.has(id)).length;
  const skippedInvalid = requested.filter((id) => !validInAccount.has(id)).length;

  const source = params.source ?? 'manual';

  for (const memberChunk of chunk(toAdd, POSTGREST_RANGE_PAGE_SIZE)) {
    const { error: membersError } = await supabase.from('lead_saved_list_members').insert(
      memberChunk.map((globalLeadId) => ({
        list_id: params.listId,
        account_id: accountId,
        global_lead_id: globalLeadId,
        source,
      })),
    );

    if (membersError) {
      throw new Error(`Failed to add list members: ${membersError.message}`);
    }
  }

  return {
    added: toAdd.length,
    skippedAlreadyMember,
    skippedInvalid,
  };
}

export async function removeMembersFromSavedLeadList(
  accountId: string,
  params: {
    listId: string;
    globalLeadIds: string[];
  },
): Promise<RemoveMembersFromSavedLeadListResult> {
  await assertSavedLeadListExists(accountId, params.listId);

  const requested = unique(params.globalLeadIds.filter(Boolean));
  if (requested.length === 0) {
    return { removed: 0, skippedNotMember: 0 };
  }

  const existingMembers = await getExistingListMemberIds(accountId, params.listId, requested);
  const toRemove = requested.filter((id) => existingMembers.has(id));
  const skippedNotMember = requested.length - toRemove.length;

  for (const idChunk of chunk(toRemove, POSTGREST_IN_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('lead_saved_list_members')
      .delete()
      .eq('account_id', accountId)
      .eq('list_id', params.listId)
      .in('global_lead_id', idChunk);

    if (error) {
      throw new Error(`Failed to remove list members: ${error.message}`);
    }
  }

  return {
    removed: toRemove.length,
    skippedNotMember,
  };
}

export async function fetchAllSavedLeadListGlobalLeadIds(
  accountId: string,
  listId: string,
  query: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>,
): Promise<{ globalLeadIds: string[]; totalCount: number }> {
  const globalLeadIds: string[] = [];
  let totalCount = 0;
  let offset = 0;

  for (;;) {
    const page = await getSavedLeadListPeoplePage(accountId, listId, {
      ...query,
      limit: SAVED_LIST_PAGE_MAX,
      offset,
    });

    if (offset === 0) {
      totalCount = page.totalCount;
    }

    for (const row of page.rows) {
      globalLeadIds.push(row.globalLeadId);
    }

    if (!shouldContinueSavedListExportPagination(page.rows.length)) {
      break;
    }
    offset += SAVED_LIST_PAGE_MAX;
  }

  return { globalLeadIds, totalCount };
}

async function fetchSavedLeadListSelectionRows(
  accountId: string,
  columns: LeadsColumnDef[],
  query: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>,
  globalLeadIds: string[],
): Promise<LeadsTableRow[]> {
  const rows: LeadsTableRow[] = [];
  const needsWorkbench = columnsNeedWorkbenchDataset(columns);

  for (const idChunk of chunk(unique(globalLeadIds.filter(Boolean)), LEADS_EXPORT_CHUNK_SIZE)) {
    const page = await getAccountLeadPeoplePage(accountId, {
      searchQuery: query.searchQuery,
      campaignIds: query.campaignIds,
      campaignTagIds: query.campaignTagIds,
      replyStatuses: query.replyStatuses,
      enrollmentStates: query.enrollmentStates,
      replyCategories: query.replyCategories,
      sortColumn: query.sortColumn,
      sortDirection: query.sortDirection,
      globalLeadIds: idChunk,
      limit: idChunk.length,
      offset: 0,
    });

    const pageRows = page.rows.map(mapAccountSummaryToSavedListPeopleRow);
    const nextDataset =
      needsWorkbench && pageRows.length > 0
        ? await getAccountLeadWorkbenchDataset(accountId, pageRows.map((row) => row.globalLeadId), {
            includeReplyActivity: layoutNeedsReplyActivity(columns),
          })
        : { campaigns: [], people: [] };

    rows.push(
      ...buildSavedListExportRows({
        columns,
        pageRows,
        workbenchPeople: nextDataset.people,
      }),
    );
  }

  return rows;
}

export async function getSavedLeadListExportRows(
  accountId: string,
  listId: string,
  params: {
    columns: LeadsColumnDef[];
    query?: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>;
    globalLeadIds?: string[];
  },
): Promise<LeadsTableRow[]> {
  const query = params.query ?? {};
  const columns = params.columns;

  if (params.globalLeadIds?.length) {
    return fetchSavedLeadListSelectionRows(accountId, columns, query, params.globalLeadIds);
  }

  const rows: LeadsTableRow[] = [];
  const needsWorkbench = columnsNeedWorkbenchDataset(columns);
  for (let offset = 0; ; offset += SAVED_LIST_PAGE_MAX) {
    const page = await getSavedLeadListPeoplePage(accountId, listId, {
      ...query,
      limit: SAVED_LIST_PAGE_MAX,
      offset,
    });
    const nextDataset =
      needsWorkbench && page.rows.length > 0
        ? await getAccountLeadWorkbenchDataset(accountId, page.rows.map((row) => row.globalLeadId), {
            includeReplyActivity: layoutNeedsReplyActivity(columns),
          })
        : { campaigns: [], people: [] };

    rows.push(
      ...buildSavedListExportRows({
        columns,
        pageRows: page.rows,
        workbenchPeople: nextDataset.people,
      }),
    );
    if (!shouldContinueSavedListExportPagination(page.rows.length)) break;
  }

  return rows;
}

export async function addExplorerViewToSavedLeadList(
  accountId: string,
  params: {
    listId: string;
    query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
    source?: 'selection' | 'manual';
  },
): Promise<AddMembersToSavedLeadListResult> {
  const result = await applyListMembershipForScope(
    accountId,
    params.listId,
    { kind: 'explorerView', query: params.query },
    'add',
    { source: params.source },
  );
  return result as AddMembersToSavedLeadListResult;
}

export async function removeExplorerViewFromSavedLeadList(
  accountId: string,
  params: {
    listId: string;
    query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>;
  },
): Promise<RemoveMembersFromSavedLeadListResult> {
  const result = await applyListMembershipForScope(
    accountId,
    params.listId,
    { kind: 'explorerView', query: params.query },
    'remove',
  );
  return result as RemoveMembersFromSavedLeadListResult;
}

export async function removeAllFromSavedLeadList(
  accountId: string,
  listId: string,
): Promise<{ removed: number }> {
  return applyListMembershipForScope(
    accountId,
    listId,
    { kind: 'savedListAll', listId },
    'remove',
  );
}

export async function removeSavedListPeopleView(
  accountId: string,
  params: {
    listId: string;
    query: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>;
  },
): Promise<RemoveMembersFromSavedLeadListResult> {
  const result = await applyListMembershipForScope(
    accountId,
    params.listId,
    { kind: 'savedListFiltered', listId: params.listId, query: params.query },
    'remove',
  );
  return result as RemoveMembersFromSavedLeadListResult;
}
