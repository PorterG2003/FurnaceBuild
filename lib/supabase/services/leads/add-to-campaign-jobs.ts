import { supabase } from '../../client';
import { getClientApiBaseUrl } from '@/lib/client-api/client';
import type { Json } from '../../types/database';

export type AccountImportJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AccountImportJobSnapshot {
  id: string;
  accountId: string;
  campaignId: string;
  status: AccountImportJobStatus;
  progress: number;
  cursor: number;
  input: Json;
  result: Json;
  errors: Json;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapJob(data: Record<string, unknown> | null): AccountImportJobSnapshot | null {
  if (!data?.id) return null;
  return {
    id: String(data.id),
    accountId: String(data.account_id),
    campaignId: String(data.campaign_id),
    status: (data.status as AccountImportJobStatus) ?? 'queued',
    progress: typeof data.progress === 'number' ? data.progress : 0,
    cursor: typeof data.cursor === 'number' ? data.cursor : 0,
    input: (data.input ?? {}) as Json,
    result: (data.result ?? {}) as Json,
    errors: (data.errors ?? []) as Json,
    startedAt: (data.started_at as string | null) ?? null,
    completedAt: (data.completed_at as string | null) ?? null,
    createdAt: String(data.created_at ?? ''),
    updatedAt: String(data.updated_at ?? ''),
  };
}

export async function startAddToCampaignJobForList(
  accountId: string,
  campaignId: string,
  listId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('start_add_to_campaign_job_for_list', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_list_id: listId,
  });

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error('Failed to create import job.');
  }
  return String(data);
}

export async function startAddToCampaignJob(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<string> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('start_add_to_campaign_job', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_global_lead_ids: uniqueIds,
  });

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error('Failed to create import job.');
  }
  return String(data);
}

export async function getAccountImportJob(jobId: string): Promise<AccountImportJobSnapshot | null> {
  const { data, error } = await supabase.rpc('get_account_import_job', {
    p_job_id: jobId,
  });

  if (error) {
    throw new Error(error.message);
  }
  return mapJob((data ?? null) as Record<string, unknown> | null);
}

export async function enqueueAccountImportJob(jobId: string, accessToken: string): Promise<void> {
  const baseUrl = getClientApiBaseUrl();
  if (!baseUrl) {
    throw new Error('Client API URL is not configured.');
  }

  const response = await fetch(`${baseUrl}/internal/import-jobs/${jobId}/enqueue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Failed to enqueue import job (${response.status}).`);
  }
}

export function mapImportJobToAddResult(job: AccountImportJobSnapshot): {
  created: number;
  updated: number;
  enrolled: number;
  skipped: number;
  failed: number;
  errors: Array<{ globalLeadId: string; message: string }>;
} {
  const result = (job.result && typeof job.result === 'object' ? job.result : {}) as Record<string, unknown>;
  const errors = Array.isArray(job.errors) ? job.errors : [];
  return {
    created: typeof result.created === 'number' ? result.created : 0,
    updated: typeof result.updated === 'number' ? result.updated : 0,
    enrolled: typeof result.enrolled === 'number' ? result.enrolled : 0,
    skipped: typeof result.skipped === 'number' ? result.skipped : 0,
    failed: typeof result.failed === 'number' ? result.failed : 0,
    errors: errors.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        globalLeadId: String(row.globalLeadId ?? row.global_lead_id ?? ''),
        message: String(row.message ?? 'Unknown error'),
      };
    }),
  };
}
