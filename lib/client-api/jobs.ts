import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '../supabase/types/database.js';
import type { Database } from '../supabase/types/supabase-client-database.js';
import { invalidRequest, rateLimited } from './errors.js';
import { MAX_ASYNC_JOBS_PER_ACCOUNT } from './openapi/constants.js';
import { isImportJobOperation } from './webhooks/batchCompletion.js';

type Supabase = SupabaseClient<Database>;

export async function assertAsyncJobCapacity(supabase: Supabase, accountId: string): Promise<void> {
  const { count, error } = await supabase
    .from('api_import_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('status', ['queued', 'running']);
  if (error) throw new Error(`Failed to count async jobs: ${error.message}`);
  if ((count ?? 0) >= MAX_ASYNC_JOBS_PER_ACCOUNT) {
    rateLimited('too_many_async_jobs', `Only ${MAX_ASYNC_JOBS_PER_ACCOUNT} concurrent async jobs are allowed`);
  }
}

export type CreateJobBody = {
  operation?: string;
  campaign_id?: string | null;
  global_lead_ids?: string[];
  list_id?: string;
  leads?: Record<string, unknown>[];
};

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

  await assertAsyncJobCapacity(supabase, accountId);

  if (operation === 'api_lead_import') {
    const rows = Array.isArray(body.leads) ? body.leads : [];
    if (rows.length === 0) invalidRequest('missing_leads', 'api_lead_import requires a non-empty leads array', 'leads');
    if (!body.campaign_id) invalidRequest('missing_campaign_id', 'campaign_id is required', 'campaign_id');
    const { data, error } = await supabase
      .from('api_import_jobs')
      .insert({
        account_id: accountId,
        campaign_id: body.campaign_id,
        created_by_api_key_id: apiKeyId,
        status: 'queued',
        input: { operation, leads: rows } as Json,
        result: {},
        errors: [],
      } as never)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data!;
  }

  const globalLeadIds = [...new Set((body.global_lead_ids ?? []).filter(Boolean))];
  const listId = body.list_id?.trim() || null;
  let jobId: string | null = null;

  if (operation === 'add_to_campaign') {
    if (!body.campaign_id) invalidRequest('missing_campaign_id', 'campaign_id is required', 'campaign_id');
    if (listId) {
      const { data, error } = await supabase.rpc('start_add_to_campaign_job_for_list', {
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
