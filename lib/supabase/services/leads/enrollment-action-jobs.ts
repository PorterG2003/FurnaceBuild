import { supabase } from '../../client';
import { getClientApiBaseUrl } from '@/lib/client-api/client';
import {
  getAccountImportJob,
  enqueueAccountImportJob,
  type AccountImportJobSnapshot,
} from './add-to-campaign-jobs';

export type EnrollmentActionKind = 'pause' | 'resume';

export async function startPauseEnrollmentsJobForList(
  accountId: string,
  campaignId: string,
  listId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('start_pause_enrollments_job_for_list', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_list_id: listId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Failed to create pause enrollments job.');
  return String(data);
}

export async function startResumeEnrollmentsJobForList(
  accountId: string,
  campaignId: string,
  listId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('start_resume_enrollments_job_for_list', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_list_id: listId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Failed to create resume enrollments job.');
  return String(data);
}

export async function startPauseEnrollmentsJob(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<string> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('start_pause_enrollments_job', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_global_lead_ids: uniqueIds,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Failed to create pause enrollments job.');
  return String(data);
}

export async function startResumeEnrollmentsJob(
  accountId: string,
  campaignId: string,
  globalLeadIds: string[],
): Promise<string> {
  const uniqueIds = [...new Set(globalLeadIds.filter(Boolean))];
  const { data, error } = await supabase.rpc('start_resume_enrollments_job', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
    p_global_lead_ids: uniqueIds,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Failed to create resume enrollments job.');
  return String(data);
}

export { getAccountImportJob, enqueueAccountImportJob };

export function mapImportJobToEnrollmentActionResult(
  job: AccountImportJobSnapshot,
  kind: EnrollmentActionKind,
): { affected: number; skipped: number; failed: number; errors: Array<{ globalLeadId: string; message: string }> } {
  const result = (job.result && typeof job.result === 'object' ? job.result : {}) as Record<string, unknown>;
  const errors = Array.isArray(job.errors) ? job.errors : [];
  const affectedKey = kind === 'pause' ? 'paused' : 'resumed';
  return {
    affected: typeof result[affectedKey] === 'number' ? (result[affectedKey] as number) : 0,
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

export async function pollImportJobUntilDone(jobId: string): Promise<AccountImportJobSnapshot> {
  for (;;) {
    const job = await getAccountImportJob(jobId);
    if (!job) {
      throw new Error('Import job not found.');
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export async function enqueueEnrollmentActionJob(jobId: string, accessToken: string): Promise<void> {
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
