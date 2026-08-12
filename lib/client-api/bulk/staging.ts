import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Database } from '../../supabase/types/supabase-client-database.js';
import { invalidRequest, notFound } from '../errors.js';
import { STAGED_IMPORT_APPEND_LIMIT } from '../openapi/constants.js';

type Supabase = SupabaseClient<Database>;

const UPLOAD_TTL_MS = 60 * 60 * 1000;

function getExportBucket(): string | null {
  return process.env.LEADS_EXPORT_BUCKET?.trim() || null;
}

export async function createStagedImportJob(
  supabase: Supabase,
  accountId: string,
  campaignId: string,
  apiKeyId: string | null,
) {
  const { data, error } = await supabase.rpc('create_csv_lead_import_job', {
    p_account_id: accountId,
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(error.message);
  const jobId = data ? String(data) : null;
  if (!jobId) throw new Error('Failed to create staged import job.');
  if (apiKeyId) {
    await supabase
      .from('api_import_jobs')
      .update({ created_by_api_key_id: apiKeyId } as never)
      .eq('id', jobId)
      .eq('account_id', accountId);
  }
  const { data: job, error: loadError } = await supabase
    .from('api_import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('account_id', accountId)
    .single();
  if (loadError) throw new Error(loadError.message);
  return job!;
}

export async function appendStagedImportRows(
  supabase: Supabase,
  accountId: string,
  jobId: string,
  leads: Record<string, unknown>[],
) {
  if (!Array.isArray(leads) || leads.length === 0) {
    invalidRequest('missing_leads', 'leads must be a non-empty array', 'leads');
  }
  if (leads.length > STAGED_IMPORT_APPEND_LIMIT) {
    invalidRequest(
      'too_many_leads',
      `Staged append is limited to ${STAGED_IMPORT_APPEND_LIMIT} rows per call`,
      'leads',
    );
  }
  const { data: job, error: jobError } = await supabase
    .from('api_import_jobs')
    .select('id, account_id, status')
    .eq('id', jobId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) notFound('job_not_found', 'Import job not found');
  if (job.status !== 'uploading') {
    invalidRequest('job_not_uploading', 'Import job is not accepting uploads', 'id');
  }

  const { data, error } = await supabase.rpc('append_csv_import_staging_rows', {
    p_job_id: jobId,
    p_rows: leads as never,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { uploadedCount?: number; totalCount?: number };
  return {
    uploaded_count: result.uploadedCount ?? leads.length,
    total_count: result.totalCount ?? leads.length,
  };
}

export async function finalizeStagedImportJob(
  supabase: Supabase,
  accountId: string,
  jobId: string,
) {
  const { data: job, error: jobError } = await supabase
    .from('api_import_jobs')
    .select('id, account_id, status, input')
    .eq('id', jobId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) notFound('job_not_found', 'Import job not found');
  if (job.status === 'queued' || job.status === 'running' || job.status === 'completed') {
    return job;
  }
  if (job.status !== 'uploading') {
    invalidRequest('invalid_job_status', `Cannot finalize job in status ${job.status}`, 'id');
  }
  const { data, error } = await supabase.rpc('finalize_csv_lead_import_job', {
    p_job_id: jobId,
  });
  if (error) throw new Error(error.message);
  const finalizedId = String(data ?? jobId);
  const { data: updated, error: loadError } = await supabase
    .from('api_import_jobs')
    .select('*')
    .eq('id', finalizedId)
    .eq('account_id', accountId)
    .single();
  if (loadError) throw new Error(loadError.message);
  return updated!;
}

export async function createPresignedBulkUpload(
  supabase: Supabase,
  accountId: string,
  apiKeyId: string | null,
  params: { campaign_id: string; filename?: string | null; content_type?: string | null },
) {
  const bucket = getExportBucket();
  if (!bucket) {
    invalidRequest(
      'object_upload_unavailable',
      'Presigned object upload is not configured in this environment; use staged JSON append instead',
    );
  }
  const uploadId = randomUUID();
  const filename = params.filename?.trim() || `leads-${uploadId}.csv`;
  const contentType = params.content_type?.trim() || 'text/csv';
  const key = `bulk-uploads/${accountId}/${uploadId}/${filename}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();

  const { error } = await supabase.from('api_bulk_uploads' as never).insert({
    id: uploadId,
    account_id: accountId,
    created_by_api_key_id: apiKeyId,
    status: 'pending',
    filename,
    content_type: contentType,
    s3_bucket: bucket,
    s3_key: key,
    campaign_id: params.campaign_id,
    expires_at: expiresAt,
  } as never);
  if (error) throw new Error(`Failed to create bulk upload: ${error.message}`);

  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: Math.floor(UPLOAD_TTL_MS / 1000) },
  );

  return {
    upload_id: uploadId,
    upload_url: uploadUrl,
    expires_at: expiresAt,
    filename,
    content_type: contentType,
  };
}
