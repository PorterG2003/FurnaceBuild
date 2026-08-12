import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '../supabase/types/database.js';
import type { Database } from '../supabase/types/supabase-client-database.js';
import { invalidRequest, rateLimited } from './errors.js';
import {
  BULK_ASYNC_LIMIT,
  MAX_ASYNC_JOBS_PER_ACCOUNT,
  MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT,
} from './openapi/constants.js';
import { isImportJobOperation } from './webhooks/batchCompletion.js';
import {
  normalizeStringIds,
  parseApiBulkExclusions,
  parseApiBulkScope,
  scopeFromLegacyJobFields,
  type ApiBulkExclusions,
  type ApiBulkScope,
} from './bulk/scope.js';
import { assertPreviewBinding } from './bulk/previewService.js';

type Supabase = SupabaseClient<Database>;

export async function assertQueuedJobCapacity(supabase: Supabase, accountId: string): Promise<void> {
  const { count, error } = await supabase
    .from('api_import_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('status', 'queued');
  if (error) throw new Error(`Failed to count queued async jobs: ${error.message}`);
  if ((count ?? 0) >= MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT) {
    rateLimited(
      'too_many_queued_async_jobs',
      `Only ${MAX_QUEUED_ASYNC_JOBS_PER_ACCOUNT} queued async jobs are allowed per account`,
    );
  }
}

/** @deprecated Prefer assertQueuedJobCapacity — running slots are claimed by workers. */
export async function assertAsyncJobCapacity(supabase: Supabase, accountId: string): Promise<void> {
  await assertQueuedJobCapacity(supabase, accountId);
}

export type CreateJobBody = {
  operation?: string;
  campaign_id?: string | null;
  global_lead_ids?: string[];
  list_id?: string;
  leads?: Record<string, unknown>[];
  scope?: unknown;
  exclusions?: unknown;
  preview_id?: string;
  expected_count?: number;
  upload_id?: string;
  source_campaign_id?: string;
  target_list_id?: string;
  column_layout?: unknown;
  filename_base?: string;
  projection?: 'full' | 'compact';
};

function exclusionsFromBody(body: CreateJobBody): ApiBulkExclusions | null {
  return parseApiBulkExclusions(body.exclusions);
}

function resolveScope(body: CreateJobBody): ApiBulkScope | null {
  const explicit = parseApiBulkScope(body.scope);
  if (explicit) return explicit;
  return scopeFromLegacyJobFields({
    global_lead_ids: body.global_lead_ids,
    list_id: body.list_id,
    leads: body.leads,
    upload_id: body.upload_id,
    source_campaign_id: body.source_campaign_id,
  });
}

async function attachApiKey(
  supabase: Supabase,
  accountId: string,
  jobId: string,
  apiKeyId: string | null,
): Promise<Database['public']['Tables']['api_import_jobs']['Row']> {
  const { data: job, error: loadError } = await supabase
    .from('api_import_jobs')
    .update({ created_by_api_key_id: apiKeyId } as never)
    .eq('id', jobId)
    .eq('account_id', accountId)
    .select('*')
    .single();
  if (loadError) throw new Error(loadError.message);
  return job!;
}

function buildScopedInput(params: {
  operation: string;
  scope: ApiBulkScope | null;
  exclusions: ApiBulkExclusions | null;
  leads?: Record<string, unknown>[];
  previewId?: string | null;
  expectedCount?: number | null;
  extra?: Record<string, unknown>;
}): Json {
  const scope = params.scope;
  const input: Record<string, unknown> = {
    operation: params.operation,
    ...(params.extra ?? {}),
  };
  if (params.previewId) input.preview_id = params.previewId;
  if (typeof params.expectedCount === 'number') input.expected_count = params.expectedCount;
  if (params.exclusions) input.exclusions = params.exclusions;
  if (params.leads?.length) input.leads = params.leads;

  if (scope?.kind === 'selection') {
    input.global_lead_ids = scope.global_lead_ids;
    input.total_count = scope.global_lead_ids.length;
  } else if (scope?.kind === 'saved_list' || scope?.kind === 'saved_list_filtered') {
    input.saved_list_id = scope.list_id;
    if (scope.kind === 'saved_list_filtered') input.query = scope.query;
  } else if (scope?.kind === 'campaign') {
    input.source_campaign_id = scope.campaign_id;
  } else if (scope?.kind === 'explorer_view') {
    input.source = 'explorer';
    input.query = scope.query;
  } else if (scope?.kind === 'staged_upload') {
    input.upload_id = scope.upload_id;
  }

  return input as Json;
}

export async function startApiImportJob(
  supabase: Supabase,
  accountId: string,
  apiKeyId: string | null,
  body: CreateJobBody,
): Promise<Database['public']['Tables']['api_import_jobs']['Row']> {
  const operation = body.operation?.trim();
  if (!isImportJobOperation(operation)) {
    invalidRequest('invalid_operation', 'Invalid job operation', 'operation');
  }

  await assertQueuedJobCapacity(supabase, accountId);

  const scope = resolveScope(body);
  const exclusions = exclusionsFromBody(body);
  const previewId = typeof body.preview_id === 'string' ? body.preview_id.trim() : null;
  const expectedCount = typeof body.expected_count === 'number' ? body.expected_count : null;

  const target: Record<string, unknown> = {};
  if (body.campaign_id) target.campaign_id = body.campaign_id;
  if (body.target_list_id || body.list_id) {
    target.list_id = body.target_list_id ?? body.list_id;
  }
  await assertPreviewBinding(supabase, accountId, previewId, {
    operation,
    scope,
    exclusions,
    target,
  });

  if (operation === 'api_lead_import') {
    const rows = Array.isArray(body.leads) ? body.leads : [];
    if (rows.length === 0) invalidRequest('missing_leads', 'api_lead_import requires a non-empty leads array', 'leads');
    if (rows.length > BULK_ASYNC_LIMIT) {
      invalidRequest(
        'too_many_leads',
        `Inline api_lead_import is limited to ${BULK_ASYNC_LIMIT} rows; use staged import for larger sets`,
        'leads',
      );
    }
    if (!body.campaign_id) invalidRequest('missing_campaign_id', 'campaign_id is required', 'campaign_id');
    const { data, error } = await supabase
      .from('api_import_jobs')
      .insert({
        account_id: accountId,
        campaign_id: body.campaign_id,
        created_by_api_key_id: apiKeyId,
        status: 'queued',
        input: buildScopedInput({
          operation,
          scope,
          exclusions,
          leads: rows,
          previewId,
          expectedCount,
        }),
        result: {},
        errors: [],
      } as never)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data!;
  }

  if (operation === 'csv_lead_import_staged') {
    invalidRequest(
      'use_staged_import_endpoints',
      'Use POST /v1/campaigns/{id}/imports/staged to create a staged import job',
      'operation',
    );
  }

  if (operation === 'export_leads') {
    const exportScope = scope;
    if (!exportScope) {
      invalidRequest('missing_scope', 'export_leads requires scope, list_id, or global_lead_ids', 'scope');
    }
    const source =
      exportScope.kind === 'saved_list' || exportScope.kind === 'saved_list_filtered'
        ? 'saved_list'
        : exportScope.kind === 'campaign'
          ? 'campaign'
          : 'explorer';
    const listId =
      exportScope.kind === 'saved_list' || exportScope.kind === 'saved_list_filtered'
        ? exportScope.list_id
        : null;
    const globalLeadIds = exportScope.kind === 'selection' ? exportScope.global_lead_ids : [];
    const query =
      exportScope.kind === 'explorer_view' || exportScope.kind === 'saved_list_filtered'
        ? exportScope.query
        : {};
    const projection = body.projection === 'compact' ? 'compact' : 'full';
    const compactLayout =
      projection === 'compact'
        ? [
            { sourceType: 'standard', fieldKey: 'email', label: 'Email', visible: true },
            { sourceType: 'standard', fieldKey: 'global_lead_id', label: 'Global Lead ID', visible: true },
          ]
        : Array.isArray(body.column_layout)
          ? body.column_layout
          : [];

    const { data, error } = await supabase.rpc('start_leads_export_job', {
      p_account_id: accountId,
      p_source: source === 'campaign' ? 'explorer' : source,
      p_global_lead_ids: globalLeadIds,
      p_list_id: listId,
      p_query:
        exportScope.kind === 'campaign'
          ? ({ campaign_ids: [exportScope.campaign_id] } as unknown as Json)
          : (query as unknown as Json),
      p_column_layout: compactLayout as unknown as Json,
      p_total_count: expectedCount ?? globalLeadIds.length,
      p_filename_base: body.filename_base ?? null,
    });
    if (error) throw new Error(error.message);
    const jobId = data ? String(data) : null;
    if (!jobId) throw new Error('Failed to create export job.');
    // Persist projection hint on the job input for compact exports.
    if (projection === 'compact' || exportScope.kind === 'campaign') {
      await supabase
        .from('api_import_jobs')
        .update({
          input: {
            operation: 'export_leads',
            source: source === 'campaign' ? 'explorer' : source,
            list_id: listId,
            global_lead_ids: globalLeadIds,
            query:
              exportScope.kind === 'campaign'
                ? { campaign_ids: [exportScope.campaign_id] }
                : query,
            column_layout: compactLayout,
            projection,
            source_campaign_id: exportScope.kind === 'campaign' ? exportScope.campaign_id : null,
            exclusions,
            preview_id: previewId,
            expected_count: expectedCount,
          } as Json,
        } as never)
        .eq('id', jobId)
        .eq('account_id', accountId);
    }
    return attachApiKey(supabase, accountId, jobId, apiKeyId);
  }

  if (operation === 'add_to_lead_list' || operation === 'remove_from_lead_list') {
    const targetListId = body.target_list_id?.trim() || body.list_id?.trim() || null;
    if (!targetListId) {
      invalidRequest('missing_list_id', 'target_list_id (or list_id) is required', 'target_list_id');
    }
    const sourceListId =
      scope?.kind === 'saved_list' || scope?.kind === 'saved_list_filtered' ? scope.list_id : null;
    const sourceCampaignId = scope?.kind === 'campaign' ? scope.campaign_id : body.source_campaign_id ?? null;
    const globalLeadIds = scope?.kind === 'selection' ? scope.global_lead_ids : normalizeStringIds(body.global_lead_ids);

    if (operation === 'add_to_lead_list') {
      const { data, error } = await supabase.rpc('start_add_to_lead_list_job' as never, {
        p_account_id: accountId,
        p_list_id: targetListId,
        p_global_lead_ids: globalLeadIds,
        p_source_list_id: sourceListId && sourceListId !== targetListId ? sourceListId : null,
        p_source_campaign_id: sourceCampaignId,
        p_exclude_list_id: exclusions?.list_id ?? null,
        p_exclude_global_lead_ids: exclusions?.global_lead_ids ?? [],
        p_exclude_emails: exclusions?.emails ?? [],
      } as never);
      if (error) {
        const { data: inserted, error: insertError } = await supabase
          .from('api_import_jobs')
          .insert({
            account_id: accountId,
            campaign_id: null,
            created_by_api_key_id: apiKeyId,
            status: 'queued',
            input: buildScopedInput({
              operation,
              scope,
              exclusions,
              previewId,
              expectedCount,
              extra: {
                target_list_id: targetListId,
                saved_list_id: sourceListId && sourceListId !== targetListId ? sourceListId : null,
                source_campaign_id: sourceCampaignId,
                global_lead_ids: globalLeadIds,
              },
            }),
            result: {},
            errors: [],
          } as never)
          .select('*')
          .single();
        if (insertError) throw new Error(error.message);
        return inserted!;
      }
      const jobId = data ? String(data) : null;
      if (!jobId) throw new Error('Failed to create async job.');
      return attachApiKey(supabase, accountId, jobId, apiKeyId);
    }

    const { data, error } = await supabase.rpc('start_remove_from_lead_list_job' as never, {
      p_account_id: accountId,
      p_list_id: targetListId,
      p_global_lead_ids: globalLeadIds,
      p_source_list_id: sourceListId && sourceListId !== targetListId ? sourceListId : null,
      p_source_campaign_id: sourceCampaignId,
    } as never);
    if (error) {
      const { data: inserted, error: insertError } = await supabase
        .from('api_import_jobs')
        .insert({
          account_id: accountId,
          campaign_id: null,
          created_by_api_key_id: apiKeyId,
          status: 'queued',
          input: buildScopedInput({
            operation,
            scope,
            exclusions,
            previewId,
            expectedCount,
            extra: {
              target_list_id: targetListId,
              saved_list_id: sourceListId && sourceListId !== targetListId ? sourceListId : null,
              source_campaign_id: sourceCampaignId,
              global_lead_ids: globalLeadIds,
            },
          }),
          result: {},
          errors: [],
        } as never)
        .select('*')
        .single();
      if (insertError) throw new Error(error.message);
      return inserted!;
    }
    const jobId = data ? String(data) : null;
    if (!jobId) throw new Error('Failed to create async job.');
    return attachApiKey(supabase, accountId, jobId, apiKeyId);
  }

  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  const listId =
    scope?.kind === 'saved_list' || scope?.kind === 'saved_list_filtered'
      ? scope.list_id
      : body.list_id?.trim() || null;
  const sourceCampaignId =
    scope?.kind === 'campaign' ? scope.campaign_id : body.source_campaign_id?.trim() || null;
  let jobId: string | null = null;

  const hasExclusions = Boolean(
    exclusions?.list_id ||
      exclusions?.campaign_id ||
      exclusions?.global_lead_ids?.length ||
      exclusions?.emails?.length,
  );

  if (operation === 'add_to_campaign') {
    if (!body.campaign_id) invalidRequest('missing_campaign_id', 'campaign_id is required', 'campaign_id');

    if (hasExclusions || sourceCampaignId || (scope && scope.kind !== 'saved_list' && scope.kind !== 'selection')) {
      const { data, error } = await supabase.rpc('start_add_to_campaign_job_scoped' as never, {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_source_list_id: listId,
        p_source_campaign_id: sourceCampaignId,
        p_global_lead_ids: scope?.kind === 'selection' ? scope.global_lead_ids : globalLeadIds,
        p_exclude_list_id: exclusions?.list_id ?? null,
        p_exclude_campaign_id: exclusions?.campaign_id ?? null,
        p_exclude_global_lead_ids: exclusions?.global_lead_ids ?? [],
        p_exclude_emails: exclusions?.emails ?? [],
      } as never);
      if (error) {
        const { data: inserted, error: insertError } = await supabase
          .from('api_import_jobs')
          .insert({
            account_id: accountId,
            campaign_id: body.campaign_id,
            created_by_api_key_id: apiKeyId,
            status: 'queued',
            input: buildScopedInput({
              operation,
              scope,
              exclusions,
              previewId,
              expectedCount,
              extra: {
                saved_list_id: listId,
                source_campaign_id: sourceCampaignId,
                global_lead_ids: scope?.kind === 'selection' ? scope.global_lead_ids : globalLeadIds,
              },
            }),
            result: {},
            errors: [],
          } as never)
          .select('*')
          .single();
        if (insertError) throw new Error(error.message);
        return inserted!;
      }
      jobId = data ? String(data) : null;
    } else if (listId) {
      const { data, error } = await supabase.rpc('start_add_to_campaign_job_for_list', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_list_id: listId,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    } else {
      if (globalLeadIds.length === 0) {
        invalidRequest('missing_global_lead_ids', 'global_lead_ids, list_id, or scope is required', 'global_lead_ids');
      }
      const { data, error } = await supabase.rpc('start_add_to_campaign_job', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_global_lead_ids: globalLeadIds,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    }
  } else if (operation === 'remove_from_campaign') {
    if (!body.campaign_id) invalidRequest('missing_campaign_id', 'campaign_id is required', 'campaign_id');
    if (listId) {
      const { data, error } = await supabase.rpc('start_remove_from_campaign_job_for_list', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_list_id: listId,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    } else if (sourceCampaignId) {
      const { data: inserted, error: insertError } = await supabase
        .from('api_import_jobs')
        .insert({
          account_id: accountId,
          campaign_id: body.campaign_id,
          created_by_api_key_id: apiKeyId,
          status: 'queued',
          input: buildScopedInput({
            operation,
            scope,
            exclusions,
            previewId,
            expectedCount,
          }),
          result: {},
          errors: [],
        } as never)
        .select('*')
        .single();
      if (insertError) throw new Error(insertError.message);
      return inserted!;
    } else {
      if (globalLeadIds.length === 0) {
        invalidRequest('missing_global_lead_ids', 'global_lead_ids or list_id is required', 'global_lead_ids');
      }
      const { data, error } = await supabase.rpc('start_remove_from_campaign_job', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_global_lead_ids: globalLeadIds,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    }
  } else if (operation === 'remove_from_all_campaigns') {
    if (listId) {
      const { data, error } = await supabase.rpc('start_remove_from_all_campaigns_job_for_list', {
        p_account_id: accountId,
        p_list_id: listId,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    } else {
      if (globalLeadIds.length === 0) {
        invalidRequest('missing_global_lead_ids', 'global_lead_ids or list_id is required', 'global_lead_ids');
      }
      const { data, error } = await supabase.rpc('start_remove_from_all_campaigns_job', {
        p_account_id: accountId,
        p_global_lead_ids: globalLeadIds,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    }
  } else if (operation === 'pause_enrollments') {
    if (!body.campaign_id) invalidRequest('missing_campaign_id', 'campaign_id is required', 'campaign_id');
    if (listId) {
      const { data, error } = await supabase.rpc('start_pause_enrollments_job_for_list', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_list_id: listId,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    } else {
      if (globalLeadIds.length === 0) {
        invalidRequest('missing_global_lead_ids', 'global_lead_ids or list_id is required', 'global_lead_ids');
      }
      const { data, error } = await supabase.rpc('start_pause_enrollments_job', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_global_lead_ids: globalLeadIds,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    }
  } else if (operation === 'resume_enrollments') {
    if (!body.campaign_id) invalidRequest('missing_campaign_id', 'campaign_id is required', 'campaign_id');
    if (listId) {
      const { data, error } = await supabase.rpc('start_resume_enrollments_job_for_list', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_list_id: listId,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    } else {
      if (globalLeadIds.length === 0) {
        invalidRequest('missing_global_lead_ids', 'global_lead_ids or list_id is required', 'global_lead_ids');
      }
      const { data, error } = await supabase.rpc('start_resume_enrollments_job', {
        p_account_id: accountId,
        p_campaign_id: body.campaign_id,
        p_global_lead_ids: globalLeadIds,
      });
      if (error) throw new Error(error.message);
      jobId = data ? String(data) : null;
    }
  }

  if (!jobId) throw new Error('Failed to create async job.');
  return attachApiKey(supabase, accountId, jobId, apiKeyId);
}

export { MAX_ASYNC_JOBS_PER_ACCOUNT };
