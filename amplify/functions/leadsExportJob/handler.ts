import type { SupabaseClient } from '@supabase/supabase-js';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  buildExplorerExportRows,
  buildSavedListExportRows,
  columnsNeedWorkbenchDataset,
  mapAccountSummaryToSavedListPeopleRow,
} from '../../../lib/leads/export-server/buildRows.js';
import { exportLeadsWorkbenchToCsv } from '../../../lib/leads/export-server/csv.js';
import {
  layoutNeedsReplyActivity,
  parseColumnLayout,
  type LeadsColumnDef,
} from '../../../lib/leads/export-server/parseColumnLayout.js';
import type {
  AccountLeadExplorerQuery,
  AccountLeadPersonSummary,
  MockMembership,
  MockPerson,
  MockReplyCategory,
  SavedLeadListPeoplePageRow,
  SavedLeadListPeopleQuery,
} from '../../../lib/leads/export-server/types.js';
import { LEADS_EXPORT_CHUNK_SIZE, SAVED_LIST_PAGE_MAX } from '../../../lib/leads/export/constants.js';
import { formatLeadsExportFilename } from '../../../lib/leads/export/formatLeadsExportFilename.js';
import { shouldContinueSavedListExportPagination } from '../../../lib/leads/export/pagination.js';
import { createServiceRoleClient } from '../../../lib/client-api/service-role.js';
import type { Json } from '../../../lib/supabase/types/database.js';
import { fetchLeadsByGlobalLeadIdsWithClient } from '../../../lib/supabase/services/leads/fetch-leads-by-global-ids-with-client.js';

const EXPORT_PAGE_SIZE = 1000;
const s3 = new S3Client({});

type RunEvent = { jobId: string };
type FailEvent = { action: 'fail'; jobId: string; message?: string };

type ImportJobRow = {
  id: string;
  account_id: string;
  status: string;
  progress: number;
  cursor: number;
  input: Json;
  result: Json;
  errors: Json;
};

type ExportJobInput = {
  operation: 'export_leads';
  source: 'explorer' | 'saved_list';
  list_id?: string | null;
  global_lead_ids?: string[];
  query?: Record<string, unknown>;
  column_layout?: unknown;
  total_count?: number;
  filename_base?: string | null;
};

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

type ThreadRowForWorkbench = {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  category: string | null;
  last_message_at: string;
  has_reply: boolean;
};

type EnrollmentRowForWorkbench = {
  id: string;
  lead_id: string | null;
  state: string | null;
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function chunk<T>(values: T[], chunkSize = LEADS_EXPORT_CHUNK_SIZE): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function toSortDirection(value: unknown): 'asc' | 'desc' | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

function normalizeExplorerQuery(value: Record<string, unknown> | undefined): Omit<AccountLeadExplorerQuery, 'limit' | 'offset'> {
  return {
    searchQuery: typeof value?.searchQuery === 'string' ? value.searchQuery : undefined,
    campaignIds: toStringArray(value?.campaignIds),
    campaignTagIds: toStringArray(value?.campaignTagIds),
    replyStatuses: toStringArray(value?.replyStatuses) as AccountLeadExplorerQuery['replyStatuses'],
    enrollmentStates: toStringArray(value?.enrollmentStates) as AccountLeadExplorerQuery['enrollmentStates'],
    replyCategories: toStringArray(value?.replyCategories) as AccountLeadExplorerQuery['replyCategories'],
    sortColumn: typeof value?.sortColumn === 'string' ? value.sortColumn : undefined,
    sortDirection: toSortDirection(value?.sortDirection),
  };
}

function normalizeSavedListQuery(value: Record<string, unknown> | undefined): Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'> {
  return {
    searchQuery: typeof value?.searchQuery === 'string' ? value.searchQuery : undefined,
    campaignIds: toStringArray(value?.campaignIds),
    campaignTagIds: toStringArray(value?.campaignTagIds),
    replyStatuses: toStringArray(value?.replyStatuses) as SavedLeadListPeopleQuery['replyStatuses'],
    enrollmentStates: toStringArray(value?.enrollmentStates) as SavedLeadListPeopleQuery['enrollmentStates'],
    replyCategories: toStringArray(value?.replyCategories) as SavedLeadListPeopleQuery['replyCategories'],
    sortColumn: typeof value?.sortColumn === 'string' ? value.sortColumn : undefined,
    sortDirection: toSortDirection(value?.sortDirection),
  };
}

async function getCampaignIdsForTagsWithClient(
  db: SupabaseClient,
  accountId: string,
  tagIds: string[],
): Promise<string[]> {
  if (tagIds.length === 0) return [];

  const { data, error } = await db
    .from('campaign_tag_assignments')
    .select('campaign_id')
    .eq('account_id', accountId)
    .in('tag_id', tagIds);

  if (error) {
    throw new Error(`Failed to fetch campaigns for tags: ${error.message}`);
  }

  return unique((data ?? []).map((row) => row.campaign_id));
}

async function resolveExplorerCampaignIdsWithClient(
  db: SupabaseClient,
  accountId: string,
  query: Pick<AccountLeadExplorerQuery, 'campaignIds' | 'campaignTagIds'>,
): Promise<string[] | undefined> {
  const campaignIds = query.campaignIds?.length ? unique(query.campaignIds) : [];
  const tagCampaignIds = query.campaignTagIds?.length
    ? await getCampaignIdsForTagsWithClient(db, accountId, query.campaignTagIds)
    : [];

  if (campaignIds.length > 0 && tagCampaignIds.length > 0) {
    const tagSet = new Set(tagCampaignIds);
    return campaignIds.filter((id) => tagSet.has(id));
  }
  if (campaignIds.length > 0) return campaignIds;
  if (tagCampaignIds.length > 0) return tagCampaignIds;
  return undefined;
}

async function getAccountLeadPeoplePageWithClient(
  db: SupabaseClient,
  accountId: string,
  query: AccountLeadExplorerQuery = {},
): Promise<{ rows: AccountLeadPersonSummary[]; totalCount: number }> {
  const effectiveCampaignIds = await resolveExplorerCampaignIdsWithClient(db, accountId, query);
  if (effectiveCampaignIds !== undefined && effectiveCampaignIds.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  const { data, error } = await db.rpc('account_lead_people_page', {
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

async function getSavedLeadListPeoplePageWithClient(
  db: SupabaseClient,
  accountId: string,
  listId: string,
  query: SavedLeadListPeopleQuery = {},
): Promise<{ rows: SavedLeadListPeoplePageRow[]; totalCount: number }> {
  const effectiveCampaignIds = await resolveExplorerCampaignIdsWithClient(db, accountId, query);
  if (effectiveCampaignIds !== undefined && effectiveCampaignIds.length === 0) {
    return { rows: [], totalCount: 0 };
  }

  const { data, error } = await db.rpc('saved_lead_list_people_page', {
    p_account_id: accountId,
    p_list_id: listId,
    p_campaign_ids: effectiveCampaignIds?.length ? effectiveCampaignIds : null,
    p_reply_statuses: query.replyStatuses?.length ? query.replyStatuses : null,
    p_enrollment_states: query.enrollmentStates?.length ? query.enrollmentStates : null,
    p_reply_categories: query.replyCategories?.length ? query.replyCategories : null,
    p_search: query.searchQuery?.trim() ? query.searchQuery.trim() : null,
    p_limit: query.limit ?? 50,
    p_offset: query.offset ?? 0,
    p_sort_column: query.sortColumn ?? null,
    p_sort_direction: query.sortDirection ?? null,
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

function coerceMockReplyCategory(value: string | null | undefined): MockReplyCategory {
  return value === 'Interested' || value === 'Neutral' || value === 'Not Interested' ? value : null;
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

async function fetchEnrollmentsForLeadIds(
  db: SupabaseClient,
  accountId: string,
  leadIds: string[],
): Promise<EnrollmentRowForWorkbench[]> {
  const rows: EnrollmentRowForWorkbench[] = [];

  for (const idChunk of chunk(unique(leadIds.filter(Boolean)), 100)) {
    for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
      const { data, error } = await db
        .from('enrollments')
        .select('id, lead_id, state')
        .eq('account_id', accountId)
        .is('deleted_at', null)
        .in('lead_id', idChunk)
        .order('id', { ascending: true })
        .range(offset, offset + EXPORT_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch enrollments for leads: ${error.message}`);
      }

      const pageRows = (data ?? []) as EnrollmentRowForWorkbench[];
      rows.push(...pageRows);
      if (pageRows.length < EXPORT_PAGE_SIZE) break;
    }
  }

  return rows;
}

async function fetchThreadsForLeadIds(
  db: SupabaseClient,
  accountId: string,
  leadIds: string[],
): Promise<ThreadRowForWorkbench[]> {
  const rows: ThreadRowForWorkbench[] = [];

  for (const idChunk of chunk(unique(leadIds.filter(Boolean)), 100)) {
    for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
      const { data, error } = await db
        .from('email_threads')
        .select('id, lead_id, campaign_id, category, last_message_at, has_reply')
        .eq('account_id', accountId)
        .in('lead_id', idChunk)
        .order('id', { ascending: true })
        .range(offset, offset + EXPORT_PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch lead threads: ${error.message}`);
      }

      const pageRows = (data ?? []) as ThreadRowForWorkbench[];
      rows.push(...pageRows);
      if (pageRows.length < EXPORT_PAGE_SIZE) break;
    }
  }

  return rows;
}

async function fetchWorkbenchPeopleForExport(
  db: SupabaseClient,
  accountId: string,
  globalLeadIds: string[],
  includeReplyActivity: boolean,
): Promise<MockPerson[]> {
  if (globalLeadIds.length === 0) return [];

  const leads = await fetchLeadsByGlobalLeadIdsWithClient(db, accountId, globalLeadIds);
  const leadIds = leads.map((lead) => lead.id);
  const [enrollments, threads] =
    includeReplyActivity && leadIds.length > 0
      ? await Promise.all([
          fetchEnrollmentsForLeadIds(db, accountId, leadIds),
          fetchThreadsForLeadIds(db, accountId, leadIds),
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
      mobilePhone: lead.mobile_phone_number,
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

  return Array.from(peopleByGlobalId.values());
}

async function updateJob(
  db: SupabaseClient,
  jobId: string,
  patch: Partial<ImportJobRow> & { result?: Record<string, unknown>; errors?: unknown[] },
): Promise<void> {
  await db
    .from('api_import_jobs')
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(typeof patch.progress === 'number' ? { progress: patch.progress } : {}),
      ...(typeof patch.cursor === 'number' ? { cursor: patch.cursor } : {}),
      ...(patch.result ? { result: patch.result as never } : {}),
      ...(patch.errors ? { errors: patch.errors as never } : {}),
      ...(patch.status === 'completed' || patch.status === 'failed'
        ? { completed_at: new Date().toISOString() }
        : {}),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', jobId);
}

async function loadJob(db: SupabaseClient, jobId: string): Promise<ImportJobRow> {
  const { data, error } = await db
    .from('api_import_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load export job: ${error.message}`);
  }
  if (!data) {
    throw new Error('Export job not found.');
  }

  return data as ImportJobRow;
}

async function buildExplorerRowsForJob(
  db: SupabaseClient,
  accountId: string,
  columns: LeadsColumnDef[],
  query: Omit<AccountLeadExplorerQuery, 'limit' | 'offset'>,
  globalLeadIds: string[],
  totalCountHint: number,
  onProgress: (processed: number, total: number) => Promise<void>,
) {
  if (globalLeadIds.length > 0) {
    const rows = [];
    let processed = 0;
    for (const idChunk of chunk(globalLeadIds, LEADS_EXPORT_CHUNK_SIZE)) {
      const page = await getAccountLeadPeoplePageWithClient(db, accountId, {
        ...query,
        globalLeadIds: idChunk,
        limit: idChunk.length,
        offset: 0,
      });
      rows.push(...buildExplorerExportRows(page.rows, columns));
      processed += page.rows.length;
      await onProgress(processed, totalCountHint || globalLeadIds.length);
    }
    return rows;
  }

  const rows = [];
  let processed = 0;
  let total = totalCountHint;

  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const page = await getAccountLeadPeoplePageWithClient(db, accountId, {
      ...query,
      limit: EXPORT_PAGE_SIZE,
      offset,
    });
    if (offset === 0) total = total || page.totalCount;
    rows.push(...buildExplorerExportRows(page.rows, columns));
    processed += page.rows.length;
    await onProgress(processed, total);
    if (page.rows.length < EXPORT_PAGE_SIZE) break;
  }

  return rows;
}

async function buildSavedListRowsForJob(
  db: SupabaseClient,
  accountId: string,
  listId: string,
  columns: LeadsColumnDef[],
  query: Omit<SavedLeadListPeopleQuery, 'limit' | 'offset'>,
  globalLeadIds: string[],
  totalCountHint: number,
  onProgress: (processed: number, total: number) => Promise<void>,
) {
  const needsWorkbench = columnsNeedWorkbenchDataset(columns);
  const includeReplyActivity = layoutNeedsReplyActivity(columns);

  if (globalLeadIds.length > 0) {
    const rows = [];
    let processed = 0;
    for (const idChunk of chunk(globalLeadIds, LEADS_EXPORT_CHUNK_SIZE)) {
      const page = await getAccountLeadPeoplePageWithClient(db, accountId, {
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
      const workbenchPeople =
        needsWorkbench && pageRows.length > 0
          ? await fetchWorkbenchPeopleForExport(
              db,
              accountId,
              pageRows.map((row) => row.globalLeadId),
              includeReplyActivity,
            )
          : [];
      rows.push(
        ...buildSavedListExportRows({
          columns,
          pageRows,
          workbenchPeople,
        }),
      );
      processed += pageRows.length;
      await onProgress(processed, totalCountHint || globalLeadIds.length);
    }
    return rows;
  }

  const rows = [];
  let processed = 0;
  let total = totalCountHint;

  for (let offset = 0; ; offset += SAVED_LIST_PAGE_MAX) {
    const page = await getSavedLeadListPeoplePageWithClient(db, accountId, listId, {
      ...query,
      limit: SAVED_LIST_PAGE_MAX,
      offset,
    });
    if (offset === 0) total = total || page.totalCount;
    const workbenchPeople =
      needsWorkbench && page.rows.length > 0
        ? await fetchWorkbenchPeopleForExport(
            db,
            accountId,
            page.rows.map((row) => row.globalLeadId),
            includeReplyActivity,
          )
        : [];
    rows.push(
      ...buildSavedListExportRows({
        columns,
        pageRows: page.rows,
        workbenchPeople,
      }),
    );
    processed += page.rows.length;
    await onProgress(processed, total);
    if (!shouldContinueSavedListExportPagination(page.rows.length)) break;
  }

  return rows;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export const handler = async (event: RunEvent | FailEvent): Promise<Record<string, unknown>> => {
  const db = createServiceRoleClient();

  if ('action' in event && event.action === 'fail') {
    await updateJob(db, event.jobId, {
      status: 'failed',
      result: {
        current_step: 'failed',
        message: event.message ?? 'Step Functions failure',
      },
      errors: [{ message: event.message ?? 'Step Functions failure' }],
    });
    return { ok: true };
  }

  const bucket = process.env.LEADS_EXPORT_BUCKET?.trim();
  if (!bucket) throw new Error('Missing LEADS_EXPORT_BUCKET');

  const job = await loadJob(db, event.jobId);
  const input = (job.input && typeof job.input === 'object' ? job.input : {}) as ExportJobInput;
  if (input.operation !== 'export_leads') {
    throw new Error('Unsupported export job operation.');
  }

  const columns = parseColumnLayout(input.column_layout);
  const globalLeadIds = unique((input.global_lead_ids ?? []).filter(Boolean));
  const totalCount = Math.max(
    typeof input.total_count === 'number' ? input.total_count : 0,
    globalLeadIds.length,
  );
  const filename = formatLeadsExportFilename(
    input.filename_base ?? (input.source === 'saved_list' ? 'saved-list-export' : 'leads-explorer'),
    event.jobId,
  );

  await updateJob(db, event.jobId, {
    status: 'running',
    progress: 0,
    result: {
      current_step: 'running',
      rows_processed: 0,
      total_rows: totalCount,
      filename,
    },
  });

  const onProgress = async (processed: number, total: number) => {
    const safeTotal = Math.max(total, processed, 1);
    await updateJob(db, event.jobId, {
      progress: Math.min(99, Math.round((processed / safeTotal) * 100)),
      cursor: processed,
      result: {
        current_step: 'running',
        rows_processed: processed,
        total_rows: safeTotal,
        filename,
      },
    });
  };

  const queryRecord =
    input.query && typeof input.query === 'object' && !Array.isArray(input.query)
      ? (input.query as Record<string, unknown>)
      : {};

  const rows =
    input.source === 'saved_list'
      ? await buildSavedListRowsForJob(
          db,
          job.account_id,
          input.list_id ?? '',
          columns,
          normalizeSavedListQuery(queryRecord),
          globalLeadIds,
          totalCount,
          onProgress,
        )
      : await buildExplorerRowsForJob(
          db,
          job.account_id,
          columns,
          normalizeExplorerQuery(queryRecord),
          globalLeadIds,
          totalCount,
          onProgress,
        );

  const csv = `${exportLeadsWorkbenchToCsv(rows, columns)}\n`;
  const objectKey = `leads-exports/${job.account_id}/${event.jobId}.csv`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: csv,
      ContentType: 'text/csv; charset=utf-8',
    }),
  );

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ResponseContentType: 'text/csv; charset=utf-8',
      ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"`,
    }),
    { expiresIn: 60 * 15 },
  );

  await updateJob(db, event.jobId, {
    status: 'completed',
    progress: 100,
    cursor: rows.length,
    result: {
      current_step: 'done',
      rows_processed: rows.length,
      total_rows: Math.max(totalCount, rows.length),
      rows_exported: rows.length,
      download_url: downloadUrl,
      object_key: objectKey,
      filename,
    },
  });

  return { ok: true, objectKey, rowsExported: rows.length };
};
