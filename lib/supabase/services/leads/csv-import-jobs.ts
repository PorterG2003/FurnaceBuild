import { supabase } from '../../client';
import { getAccessToken } from '../../client';
import { getClientApiBaseUrl } from '@/lib/client-api/client';
import {
  CSV_IMPORT_STAGING_UPLOAD_CHUNK,
  CSV_IMPORT_SYNC_RPC_CHUNK,
  CSV_IMPORT_SYNC_THRESHOLD,
} from '@/lib/leads/csv-import-constants';
import type { CsvImportLeadPayload } from '@/lib/leads/csv-dedupe';
import { getAccountImportJob, type AccountImportJobSnapshot } from './add-to-campaign-jobs';

export type CsvImportStats = {
  created: number;
  updated: number;
  enrolled: number;
  skipped: number;
  failed: number;
  errors: Array<{ index?: number; message: string }>;
};

function emptyStats(): CsvImportStats {
  return { created: 0, updated: 0, enrolled: 0, skipped: 0, failed: 0, errors: [] };
}

function mergeStats(existing: CsvImportStats, chunk: CsvImportStats): CsvImportStats {
  return {
    created: existing.created + chunk.created,
    updated: existing.updated + chunk.updated,
    enrolled: existing.enrolled + chunk.enrolled,
    skipped: existing.skipped + chunk.skipped,
    failed: existing.failed + chunk.failed,
    errors: [...existing.errors, ...chunk.errors].slice(0, 100),
  };
}

function parseRpcStats(data: unknown): CsvImportStats {
  const row = (data ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(row.errors)
    ? row.errors.map((entry, index) => {
        const item = entry as Record<string, unknown>;
        return {
          index,
          message: String(item.message ?? 'Import failed'),
        };
      })
    : [];
  return {
    created: typeof row.created === 'number' ? row.created : 0,
    updated: typeof row.updated === 'number' ? row.updated : 0,
    enrolled: typeof row.enrolled === 'number' ? row.enrolled : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    failed: typeof row.failed === 'number' ? row.failed : 0,
    errors,
  };
}

function chunk<T>(values: T[], chunkSize: number): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

export function shouldUseAsyncCsvImport(rowCount: number): boolean {
  return rowCount > CSV_IMPORT_SYNC_THRESHOLD;
}

export async function importCsvLeadsSync(
  accountId: string,
  campaignId: string,
  leads: CsvImportLeadPayload[],
  onProgress?: (processed: number, total: number) => void,
): Promise<CsvImportStats> {
  let stats = emptyStats();
  const total = leads.length;
  let processed = 0;

  for (const leadChunk of chunk(leads, CSV_IMPORT_SYNC_RPC_CHUNK)) {
    const { data, error } = await supabase.rpc('import_api_leads_to_campaign', {
      p_account_id: accountId,
      p_campaign_id: campaignId,
      p_leads: leadChunk,
      p_options: { emit_row_webhooks: false },
    });

    if (error) {
      throw new Error(error.message);
    }

    stats = mergeStats(stats, parseRpcStats(data));
    processed += leadChunk.length;
    onProgress?.(processed, total);
  }

  return stats;
}

export async function createCsvLeadImportJob(
  accountId: string,
  campaignId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_csv_lead_import_job', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Failed to create CSV import job.');
  return String(data);
}

export async function appendCsvImportStagingRows(
  jobId: string,
  rows: CsvImportLeadPayload[],
): Promise<{ uploadedCount: number; totalCount: number }> {
  const { data, error } = await supabase.rpc('append_csv_import_staging_rows', {
    p_job_id: jobId,
    p_rows: rows,
  });

  if (error) throw new Error(error.message);

  const result = (data ?? {}) as { uploadedCount?: number; totalCount?: number };
  return {
    uploadedCount: result.uploadedCount ?? rows.length,
    totalCount: result.totalCount ?? rows.length,
  };
}

export async function finalizeCsvLeadImportJob(jobId: string): Promise<string> {
  const { data, error } = await supabase.rpc('finalize_csv_lead_import_job', {
    p_job_id: jobId,
  });

  if (error) throw new Error(error.message);
  return String(data ?? jobId);
}

export async function enqueueCsvImportJob(jobId: string): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Sign in required to run CSV import jobs.');
  }
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
    throw new Error(body || `Failed to enqueue CSV import job (${response.status}).`);
  }
}

export async function uploadCsvLeadsToStagingJob(
  jobId: string,
  leads: CsvImportLeadPayload[],
  onProgress?: (processed: number, total: number) => void,
): Promise<void> {
  const total = leads.length;
  let processed = 0;

  for (const leadChunk of chunk(leads, CSV_IMPORT_STAGING_UPLOAD_CHUNK)) {
    await appendCsvImportStagingRows(jobId, leadChunk);
    processed += leadChunk.length;
    onProgress?.(processed, total);
  }
}

export function mapImportJobToCsvResult(job: AccountImportJobSnapshot): CsvImportStats {
  const result = (job.result && typeof job.result === 'object' ? job.result : {}) as Record<
    string,
    unknown
  >;
  const errors = Array.isArray(job.errors) ? job.errors : [];
  return {
    created: typeof result.created === 'number' ? result.created : 0,
    updated: typeof result.updated === 'number' ? result.updated : 0,
    enrolled: typeof result.enrolled === 'number' ? result.enrolled : 0,
    skipped: typeof result.skipped === 'number' ? result.skipped : 0,
    failed: typeof result.failed === 'number' ? result.failed : 0,
    errors: errors.map((entry, index) => {
      const row = entry as Record<string, unknown>;
      return {
        index: typeof row.index === 'number' ? row.index : index,
        message: String(row.message ?? 'Unknown error'),
      };
    }),
  };
}

export async function pollCsvImportJobUntilDone(
  jobId: string,
  options: { onProgress?: (progress: number) => void } = {},
): Promise<AccountImportJobSnapshot> {
  for (;;) {
    const job = await getAccountImportJob(jobId);
    if (!job) {
      throw new Error('Import job not found.');
    }
    if (typeof job.progress === 'number') {
      options.onProgress?.(job.progress);
    }
    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export { getAccountImportJob };
